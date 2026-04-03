import path from "path";
import { createScheduledJsonStore } from "../../lib/json-store.js";

const STORE_FILE = path.join(process.cwd(), "database", "sorteos.json");
const store = createScheduledJsonStore(STORE_FILE, () => ({
  trackedSince: new Date().toISOString(),
  groups: {},
}));

const SWEEP_INTERVAL_MS = 15_000;
let lastSweepAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }
  return String(settings?.prefix || ".").trim() || ".";
}

function formatDuration(ms = 0) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parseDurationToMs(raw = "") {
  const value = cleanText(raw).toLowerCase();
  if (!value) return null;

  const match = value.match(/^(\d+)\s*(s|seg|segs|m|min|mins|h|hr|hrs|d|dia|dias)?$/i);
  if (!match) return null;

  const amount = Number.parseInt(match[1], 10);
  const unit = String(match[2] || "m").toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (["s", "seg", "segs"].includes(unit)) return amount * 1000;
  if (["m", "min", "mins"].includes(unit)) return amount * 60 * 1000;
  if (["h", "hr", "hrs"].includes(unit)) return amount * 60 * 60 * 1000;
  if (["d", "dia", "dias"].includes(unit)) return amount * 24 * 60 * 60 * 1000;
  return null;
}

function splitPipe(text = "") {
  return String(text || "")
    .split("|")
    .map((part) => cleanText(part))
    .filter(Boolean);
}

function ensureGroupState(groupId = "") {
  const key = cleanText(groupId);
  const groups = store.state.groups || (store.state.groups = {});
  if (!groups[key]) {
    groups[key] = {
      active: null,
      history: [],
    };
  }
  if (!Array.isArray(groups[key].history)) groups[key].history = [];
  return groups[key];
}

function activeSorteo(groupId = "") {
  const state = ensureGroupState(groupId);
  const active = state.active;
  if (!active || typeof active !== "object") return null;
  if (String(active.status || "open") !== "open") return null;
  return active;
}

function mentionFromJid(jid = "") {
  const normalized = cleanText(jid);
  if (!normalized) return "";
  if (normalized.includes("@")) return normalized;
  return `${normalized}@s.whatsapp.net`;
}

function displayUser(jid = "") {
  const raw = String(jid || "").split("@")[0];
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : raw || "Desconocido";
}

function participantsText(participants = []) {
  if (!participants.length) return "Sin participantes todavia.";
  return participants
    .slice(0, 80)
    .map((jid, i) => `${i + 1}. ${displayUser(jid)}`)
    .join("\n");
}

function parseCreateInput(rawText = "") {
  const parts = splitPipe(rawText);
  if (!parts.length) return null;

  const firstTokens = parts[0].split(/\s+/).filter(Boolean);
  const maybeDuration = parseDurationToMs(firstTokens[0] || "");

  if (maybeDuration) {
    const prizeFromFirst = cleanText(firstTokens.slice(1).join(" "));
    const prize = cleanText(parts[1] || prizeFromFirst);
    const note = cleanText(parts[2] || "");
    if (!prize) return null;
    return { durationMs: maybeDuration, prize, note };
  }

  const durationFromSecond = parseDurationToMs(parts[1] || "");
  if (durationFromSecond) {
    const prize = cleanText(parts[0]);
    const note = cleanText(parts[2] || "");
    if (!prize) return null;
    return { durationMs: durationFromSecond, prize, note };
  }

  return null;
}

function createSorteo(groupId, payload = {}, sender = "") {
  const state = ensureGroupState(groupId);
  const id = `srt-${Date.now()}`;
  const now = Date.now();
  const durationMs = Math.max(30_000, Math.min(7 * 24 * 60 * 60 * 1000, Number(payload.durationMs || 600_000)));
  state.active = {
    id,
    prize: cleanText(payload.prize) || "Premio sorpresa",
    note: cleanText(payload.note),
    status: "open",
    createdBy: cleanText(sender),
    createdAt: nowIso(),
    createdAtMs: now,
    endAtMs: now + durationMs,
    participants: [],
    winner: "",
    closedAt: "",
    closeReason: "",
  };
  store.scheduleSave();
  return state.active;
}

function closeSorteo(groupId, reason = "auto") {
  const state = ensureGroupState(groupId);
  const active = activeSorteo(groupId);
  if (!active) return null;

  const participants = Array.isArray(active.participants) ? active.participants : [];
  const winner = participants.length
    ? participants[Math.floor(Math.random() * participants.length)]
    : "";

  active.status = "closed";
  active.winner = winner;
  active.closeReason = reason;
  active.closedAt = nowIso();

  state.history.unshift({
    id: active.id,
    prize: active.prize,
    note: active.note,
    participantsCount: participants.length,
    winner,
    createdAt: active.createdAt,
    closedAt: active.closedAt,
    closeReason: reason,
  });
  state.history = state.history.slice(0, 40);
  state.active = null;
  store.scheduleSave();
  return { ...active };
}

async function announceClose(sock, groupId, closed) {
  if (!closed) return;
  const winnerMention = mentionFromJid(closed.winner);
  const mentions = winnerMention ? [winnerMention] : [];
  const winnerLine = winnerMention
    ? `🥇 Ganador: @${winnerMention.split("@")[0]}`
    : "⚠️ No hubo participantes, sin ganador.";

  await sock.sendMessage(
    groupId,
    {
      text:
        `╭━━━〔 🎉 SORTEO FINALIZADO 〕━━━⬣\n` +
        `┃ Premio: *${closed.prize}*\n` +
        `┃ Participantes: *${Array.isArray(closed.participants) ? closed.participants.length : 0}*\n` +
        `┃ ${winnerLine}\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━⬣`,
      mentions,
      ...global.channelInfo,
    }
  );
}

async function sweepExpiredSorteos(sock) {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  const groups = store.state.groups && typeof store.state.groups === "object" ? store.state.groups : {};
  for (const [groupId, state] of Object.entries(groups)) {
    const active = state?.active;
    if (!active || active.status !== "open") continue;
    if (Number(active.endAtMs || 0) > now) continue;
    const closed = closeSorteo(groupId, "auto");
    await announceClose(sock, groupId, closed);
  }
}

export default {
  name: "sorteo",
  command: ["sorteo", "giveaway", "rifa"],
  category: "grupo",
  description: "Sorteos en grupo con inscripcion y cierre automatico",
  groupOnly: true,

  run: async ({ sock, msg, from, sender, args = [], settings, esAdmin = false, esOwner = false, commandName = "" }) => {
    await sweepExpiredSorteos(sock);

    const prefix = getPrefix(settings);
    const command = cleanText(commandName).toLowerCase();
    const aliasAction = {
      giveaway: "menu",
      rifa: "menu",
    };

    let action = aliasAction[command] || cleanText(args[0]).toLowerCase();
    let payload = aliasAction[command] ? args : args.slice(1);
    if (!action || ["menu", "help", "ayuda"].includes(action)) {
      const active = activeSorteo(from);
      const statusText = active
        ? `Sorteo activo: *${active.prize}*\nTiempo restante: *${formatDuration(Math.max(0, Number(active.endAtMs || 0) - Date.now()))}*`
        : "No hay sorteo activo en este grupo.";
      return sock.sendMessage(
        from,
        {
          text:
            `*SORTEOS FSOCIETY*\n\n` +
            `${statusText}\n\n` +
            `Comandos:\n` +
            `- ${prefix}sorteo crear 10m | Premio\n` +
            `- ${prefix}sorteo unirme\n` +
            `- ${prefix}sorteo salir\n` +
            `- ${prefix}sorteo estado\n` +
            `- ${prefix}sorteo cerrar (admin)\n` +
            `- ${prefix}sorteo cancelar (admin)`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "crear") {
      if (!(esAdmin || esOwner)) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede crear sorteos.", ...global.channelInfo }, { quoted: msg });
      }
      if (activeSorteo(from)) {
        return sock.sendMessage(from, { text: "Ya hay un sorteo activo en este grupo.", ...global.channelInfo }, { quoted: msg });
      }

      const input = parseCreateInput(payload.join(" "));
      if (!input) {
        return sock.sendMessage(
          from,
          {
            text:
              `Uso:\n` +
              `- ${prefix}sorteo crear 10m | Nitro Discord\n` +
              `- ${prefix}sorteo crear Premio sorpresa | 30m`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      const created = createSorteo(from, input, sender);
      return sock.sendMessage(
        from,
        {
          text:
            `╭━━━〔 🎁 SORTEO CREADO 〕━━━⬣\n` +
            `┃ Premio: *${created.prize}*\n` +
            `┃ Duracion: *${formatDuration(Number(created.endAtMs || 0) - Date.now())}*\n` +
            `${created.note ? `┃ Nota: *${created.note}*\n` : ""}` +
            `┃ Unete con: *${prefix}sorteo unirme*\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━⬣`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const active = activeSorteo(from);
    if (!active) {
      return sock.sendMessage(from, { text: "No hay sorteo activo en este grupo.", ...global.channelInfo }, { quoted: msg });
    }

    if (action === "unirme" || action === "join" || action === "entrar") {
      const participant = cleanText(sender);
      if (!participant) {
        return sock.sendMessage(from, { text: "No pude detectar tu usuario.", ...global.channelInfo }, { quoted: msg });
      }
      if (!Array.isArray(active.participants)) active.participants = [];
      if (active.participants.includes(participant)) {
        return sock.sendMessage(from, { text: "Ya estas inscrito en este sorteo.", ...global.channelInfo }, { quoted: msg });
      }
      active.participants.push(participant);
      store.scheduleSave();
      return sock.sendMessage(
        from,
        {
          text: `✅ Inscripcion confirmada.\nParticipantes: *${active.participants.length}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "salir" || action === "leave") {
      const participant = cleanText(sender);
      const before = Array.isArray(active.participants) ? active.participants.length : 0;
      active.participants = (active.participants || []).filter((jid) => jid !== participant);
      if (active.participants.length === before) {
        return sock.sendMessage(from, { text: "No estabas inscrito en este sorteo.", ...global.channelInfo }, { quoted: msg });
      }
      store.scheduleSave();
      return sock.sendMessage(
        from,
        {
          text: `Listo, saliste del sorteo.\nParticipantes: *${active.participants.length}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "estado" || action === "lista") {
      const remaining = Math.max(0, Number(active.endAtMs || 0) - Date.now());
      return sock.sendMessage(
        from,
        {
          text:
            `*ESTADO DEL SORTEO*\n\n` +
            `Premio: *${active.prize}*\n` +
            `${active.note ? `Nota: *${active.note}*\n` : ""}` +
            `Participantes: *${active.participants.length}*\n` +
            `Tiempo restante: *${formatDuration(remaining)}*\n\n` +
            `${participantsText(active.participants || [])}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "cerrar") {
      if (!(esAdmin || esOwner)) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede cerrar sorteos.", ...global.channelInfo }, { quoted: msg });
      }
      const closed = closeSorteo(from, "manual");
      await announceClose(sock, from, closed);
      return;
    }

    if (action === "cancelar") {
      if (!(esAdmin || esOwner)) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede cancelar sorteos.", ...global.channelInfo }, { quoted: msg });
      }
      const state = ensureGroupState(from);
      state.active = null;
      store.scheduleSave();
      return sock.sendMessage(
        from,
        {
          text: "Sorteo cancelado.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return sock.sendMessage(
      from,
      { text: `Accion invalida. Usa *${prefix}sorteo*`, ...global.channelInfo },
      { quoted: msg }
    );
  },

  onMessage: async ({ sock, esGrupo }) => {
    if (!esGrupo) return;
    await sweepExpiredSorteos(sock);
  },
};
