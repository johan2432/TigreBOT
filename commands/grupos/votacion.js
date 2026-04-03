import path from "path";
import { createScheduledJsonStore } from "../../lib/json-store.js";

const STORE_FILE = path.join(process.cwd(), "database", "votaciones.json");
const store = createScheduledJsonStore(STORE_FILE, () => ({
  trackedSince: new Date().toISOString(),
  groups: {},
}));

const SWEEP_INTERVAL_MS = 15_000;
let lastSweepAt = 0;

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

function splitPipe(raw = "") {
  return String(raw || "")
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

function activePoll(groupId = "") {
  const state = ensureGroupState(groupId);
  const active = state.active;
  if (!active || typeof active !== "object") return null;
  if (String(active.status || "open") !== "open") return null;
  return active;
}

function createPoll(groupId, payload = {}, sender = "") {
  const state = ensureGroupState(groupId);
  const id = `vot-${Date.now()}`;
  const now = Date.now();
  const durationMs = Math.max(30_000, Math.min(7 * 24 * 60 * 60 * 1000, Number(payload.durationMs || 600_000)));

  state.active = {
    id,
    question: cleanText(payload.question) || "Votacion",
    options: Array.isArray(payload.options) ? payload.options.map((o) => cleanText(o)).filter(Boolean) : [],
    votes: {},
    createdBy: cleanText(sender),
    createdAt: new Date().toISOString(),
    createdAtMs: now,
    endAtMs: now + durationMs,
    status: "open",
    closeReason: "",
    closedAt: "",
  };
  store.scheduleSave();
  return state.active;
}

function parseCreateInput(rawText = "") {
  const parts = splitPipe(rawText);
  if (parts.length < 3) return null;

  const firstDuration = parseDurationToMs(parts[0]);
  if (firstDuration) {
    const question = parts[1];
    const options = parts.slice(2);
    if (!question || options.length < 2) return null;
    return { durationMs: firstDuration, question, options };
  }

  const secondDuration = parseDurationToMs(parts[1]);
  if (secondDuration) {
    const question = parts[0];
    const options = parts.slice(2);
    if (!question || options.length < 2) return null;
    return { durationMs: secondDuration, question, options };
  }

  return null;
}

function computeCounts(poll) {
  const options = Array.isArray(poll?.options) ? poll.options : [];
  const counts = new Array(options.length).fill(0);
  const votes = poll?.votes && typeof poll.votes === "object" ? poll.votes : {};
  for (const value of Object.values(votes)) {
    const idx = Number(value);
    if (Number.isFinite(idx) && idx >= 0 && idx < counts.length) {
      counts[idx] += 1;
    }
  }
  const totalVotes = Object.keys(votes).length;
  return { counts, totalVotes };
}

function resolveOptionIndex(poll, rawOption = "") {
  const value = cleanText(rawOption).toLowerCase();
  if (!value) return -1;

  const byNumber = Number.parseInt(value, 10);
  if (Number.isFinite(byNumber)) {
    const index = byNumber - 1;
    if (index >= 0 && index < poll.options.length) return index;
  }

  const exact = poll.options.findIndex((option) => cleanText(option).toLowerCase() === value);
  if (exact >= 0) return exact;

  return poll.options.findIndex((option) => cleanText(option).toLowerCase().startsWith(value));
}

function pollResultText(poll) {
  const { counts, totalVotes } = computeCounts(poll);
  const lines = counts.map((count, index) => {
    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const option = poll.options[index];
    return `${index + 1}. ${option}\n   Votos: ${count} (${percentage}%)`;
  });

  let winnerLine = "Sin votos todavia.";
  if (counts.some((count) => count > 0)) {
    const max = Math.max(...counts);
    const winners = counts
      .map((count, index) => ({ count, index }))
      .filter((row) => row.count === max && row.count > 0)
      .map((row) => `${row.index + 1}. ${poll.options[row.index]}`);
    winnerLine = winners.length > 1
      ? `Empate: ${winners.join(" | ")}`
      : `Ganador: ${winners[0]}`;
  }

  return {
    lines: lines.join("\n\n"),
    totalVotes,
    winnerLine,
  };
}

function closePoll(groupId, reason = "auto") {
  const state = ensureGroupState(groupId);
  const poll = activePoll(groupId);
  if (!poll) return null;

  poll.status = "closed";
  poll.closeReason = reason;
  poll.closedAt = new Date().toISOString();
  const result = pollResultText(poll);

  state.history.unshift({
    id: poll.id,
    question: poll.question,
    options: poll.options,
    totalVotes: result.totalVotes,
    winnerLine: result.winnerLine,
    createdAt: poll.createdAt,
    closedAt: poll.closedAt,
    closeReason: reason,
  });
  state.history = state.history.slice(0, 40);
  state.active = null;
  store.scheduleSave();

  return {
    ...poll,
    result,
  };
}

async function announceClose(sock, groupId, closed) {
  if (!closed) return;
  await sock.sendMessage(groupId, {
    text:
      `╭━━━〔 🗳️ VOTACION FINALIZADA 〕━━━⬣\n` +
      `┃ Pregunta: *${closed.question}*\n` +
      `┃ Votos totales: *${closed.result.totalVotes}*\n` +
      `┃ ${closed.result.winnerLine}\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
      `${closed.result.lines}`,
    ...global.channelInfo,
  });
}

async function sweepExpiredPolls(sock) {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  const groups = store.state.groups && typeof store.state.groups === "object" ? store.state.groups : {};
  for (const [groupId, state] of Object.entries(groups)) {
    const active = state?.active;
    if (!active || active.status !== "open") continue;
    if (Number(active.endAtMs || 0) > now) continue;
    const closed = closePoll(groupId, "auto");
    await announceClose(sock, groupId, closed);
  }
}

export default {
  name: "votacion",
  command: ["votacion", "encuesta", "votar"],
  category: "grupo",
  description: "Votaciones de grupo con cierre automatico",
  groupOnly: true,

  run: async ({ sock, msg, from, sender, args = [], settings, esAdmin = false, esOwner = false, commandName = "" }) => {
    await sweepExpiredPolls(sock);

    const prefix = getPrefix(settings);
    const command = cleanText(commandName).toLowerCase();
    const aliasAction = {
      votar: "votar",
      encuesta: "menu",
    };

    let action = aliasAction[command] || cleanText(args[0]).toLowerCase();
    let payload = aliasAction[command] ? args : args.slice(1);
    if (!action || ["menu", "help", "ayuda"].includes(action)) {
      const active = activePoll(from);
      const statusText = active
        ? `Votacion activa: *${active.question}*\nTiempo restante: *${formatDuration(Math.max(0, Number(active.endAtMs || 0) - Date.now()))}*`
        : "No hay votacion activa en este grupo.";
      return sock.sendMessage(
        from,
        {
          text:
            `*VOTACIONES FSOCIETY*\n\n` +
            `${statusText}\n\n` +
            `Comandos:\n` +
            `- ${prefix}votacion crear 10m | Pregunta | Opcion 1 | Opcion 2\n` +
            `- ${prefix}votar 1\n` +
            `- ${prefix}votacion estado\n` +
            `- ${prefix}votacion cerrar (admin)\n` +
            `- ${prefix}votacion cancelar (admin)`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "crear") {
      if (!(esAdmin || esOwner)) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede crear votaciones.", ...global.channelInfo }, { quoted: msg });
      }
      if (activePoll(from)) {
        return sock.sendMessage(from, { text: "Ya hay una votacion activa en este grupo.", ...global.channelInfo }, { quoted: msg });
      }

      const input = parseCreateInput(payload.join(" "));
      if (!input) {
        return sock.sendMessage(
          from,
          {
            text:
              `Uso:\n` +
              `- ${prefix}votacion crear 10m | Elegimos hora | 8PM | 9PM\n` +
              `- ${prefix}votacion crear Reunion | 30m | Hoy | Manana`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      input.options = input.options.slice(0, 8);
      const created = createPoll(from, input, sender);
      return sock.sendMessage(
        from,
        {
          text:
            `╭━━━〔 🗳️ VOTACION CREADA 〕━━━⬣\n` +
            `┃ Pregunta: *${created.question}*\n` +
            `┃ Duracion: *${formatDuration(Number(created.endAtMs || 0) - Date.now())}*\n` +
            `┃ Vota con: *${prefix}votar <numero>*\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `${created.options.map((option, index) => `${index + 1}. ${option}`).join("\n")}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const poll = activePoll(from);
    if (!poll) {
      return sock.sendMessage(from, { text: "No hay votacion activa en este grupo.", ...global.channelInfo }, { quoted: msg });
    }

    if (action === "votar" || action === "vote") {
      const optionRaw = cleanText(payload.join(" "));
      if (!optionRaw) {
        return sock.sendMessage(from, { text: `Usa: *${prefix}votar <numero>*`, ...global.channelInfo }, { quoted: msg });
      }
      const index = resolveOptionIndex(poll, optionRaw);
      if (index < 0) {
        return sock.sendMessage(from, { text: "Opcion invalida para esta votacion.", ...global.channelInfo }, { quoted: msg });
      }
      if (!poll.votes || typeof poll.votes !== "object") poll.votes = {};
      poll.votes[cleanText(sender)] = index;
      store.scheduleSave();

      return sock.sendMessage(
        from,
        {
          text: `✅ Voto registrado: *${index + 1}. ${poll.options[index]}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "estado" || action === "resultados" || action === "resumen") {
      const remaining = Math.max(0, Number(poll.endAtMs || 0) - Date.now());
      const result = pollResultText(poll);
      return sock.sendMessage(
        from,
        {
          text:
            `*ESTADO DE VOTACION*\n\n` +
            `Pregunta: *${poll.question}*\n` +
            `Votos: *${result.totalVotes}*\n` +
            `Tiempo restante: *${formatDuration(remaining)}*\n\n` +
            `${result.lines}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "cerrar") {
      if (!(esAdmin || esOwner)) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede cerrar votaciones.", ...global.channelInfo }, { quoted: msg });
      }
      const closed = closePoll(from, "manual");
      await announceClose(sock, from, closed);
      return;
    }

    if (action === "cancelar") {
      if (!(esAdmin || esOwner)) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede cancelar votaciones.", ...global.channelInfo }, { quoted: msg });
      }
      const state = ensureGroupState(from);
      state.active = null;
      store.scheduleSave();
      return sock.sendMessage(
        from,
        {
          text: "Votacion cancelada.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return sock.sendMessage(
      from,
      { text: `Accion invalida. Usa *${prefix}votacion*`, ...global.channelInfo },
      { quoted: msg }
    );
  },

  onMessage: async ({ sock, esGrupo }) => {
    if (!esGrupo) return;
    await sweepExpiredPolls(sock);
  },
};
