import path from "path";
import { createScheduledJsonStore, getPrimaryPrefix } from "../../lib/json-store.js";

const STORE_FILE = path.join(process.cwd(), "database", "eventos.json");
const store = createScheduledJsonStore(STORE_FILE, () => ({
  trackedSince: new Date().toISOString(),
  groups: {},
}));

const TEMPLATE_MAP = Object.freeze({
  ff: {
    title: "Torneo Free Fire",
    game: "Free Fire",
    format: "4v4",
    slots: 16,
    mode: "clash_squad",
  },
  freefire: {
    title: "Torneo Free Fire",
    game: "Free Fire",
    format: "4v4",
    slots: 16,
    mode: "clash_squad",
  },
  codm: {
    title: "Torneo COD Mobile",
    game: "COD Mobile",
    format: "5v5",
    slots: 20,
    mode: "multijugador",
  },
  pubg: {
    title: "Evento PUBG Mobile",
    game: "PUBG Mobile",
    format: "4v4",
    slots: 16,
    mode: "tdm",
  },
  ml: {
    title: "Evento Mobile Legends",
    game: "Mobile Legends",
    format: "5v5",
    slots: 20,
    mode: "clasificatoria",
  },
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeJid(value = "") {
  return normalizeText(value).toLowerCase();
}

function normalizeName(value = "") {
  return normalizeText(value).slice(0, 40);
}

function numberFromJid(jid = "") {
  const user = normalizeJid(jid).split("@")[0];
  return user.replace(/[^\d]/g, "");
}

function parsePipeParts(args = []) {
  return String(Array.isArray(args) ? args.join(" ") : "")
    .split("|")
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function parseSlots(value = "") {
  const match = String(value || "")
    .toLowerCase()
    .match(/(?:cupos?|slots?|players?|jugadores?)\s*:?\s*(\d{1,3})/i);

  if (match?.[1]) {
    return Number.parseInt(match[1], 10);
  }

  const direct = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isFinite(direct)) return direct;
  return null;
}

function parseFormat(value = "") {
  const text = normalizeText(value).toLowerCase();
  const match = text.match(/(\d{1,2})\s*v\s*(\d{1,2})/i);
  if (!match) return "";
  return `${Number.parseInt(match[1], 10)}v${Number.parseInt(match[2], 10)}`;
}

function parseTeamSize(format = "4v4") {
  const match = String(format || "").match(/(\d{1,2})\s*v\s*(\d{1,2})/i);
  if (!match) return 4;
  const left = Number.parseInt(match[1], 10);
  const right = Number.parseInt(match[2], 10);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return 4;
  }
  return Math.max(left, right);
}

function getGroupState(groupId) {
  const groups = store.state.groups || (store.state.groups = {});
  if (!groups[groupId]) {
    groups[groupId] = {
      activeEventId: "",
      events: {},
    };
  }
  if (!groups[groupId].events || typeof groups[groupId].events !== "object") {
    groups[groupId].events = {};
  }
  return groups[groupId];
}

function getActiveEvent(groupId) {
  const groupState = getGroupState(groupId);
  const id = normalizeText(groupState.activeEventId);
  if (!id) return null;
  return groupState.events[id] || null;
}

function statusLabel(value = "") {
  const status = normalizeText(value).toLowerCase();
  if (status === "cerrado") return "CERRADO 🔒";
  if (status === "finalizado") return "FINALIZADO 🏁";
  return "ABIERTO ✅";
}

function formatEventCard(event) {
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  const slots = Number(event?.slots || 0);
  return (
    `*${event.title || "Evento"}*\n` +
    `Juego: *${event.game || "General"}*\n` +
    `Formato: *${event.format || "Libre"}*\n` +
    `Modo: *${event.mode || "General"}*\n` +
    `Horario: *${event.schedule || "Por definir"}*\n` +
    `Estado: *${statusLabel(event.status)}*\n` +
    `Inscritos: *${participants.length}/${slots || "?"}*`
  );
}

function formatParticipants(event) {
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  if (!participants.length) return "Todavia no hay participantes inscritos.";

  return participants
    .map((player, idx) => {
      const number = normalizeText(player.number) || numberFromJid(player.jid);
      const nick = normalizeName(player.nick || "Jugador");
      return `${idx + 1}. ${nick} (${number ? `+${number}` : "sin numero"})`;
    })
    .join("\n");
}

function buildTeams(event) {
  const participants = Array.isArray(event?.participants) ? [...event.participants] : [];
  if (!participants.length) {
    return {
      ok: false,
      message: "Aun no hay inscritos para armar equipos.",
    };
  }

  const teamSize = parseTeamSize(event.format || "4v4");
  const teams = [];

  while (participants.length) {
    teams.push(participants.splice(0, teamSize));
  }

  return {
    ok: true,
    teamSize,
    teams,
  };
}

function buildTeamsText(event) {
  const result = buildTeams(event);
  if (!result.ok) return result.message;

  return result.teams
    .map((team, idx) => {
      const lines = team.length
        ? team
            .map((player, row) => {
              const number = normalizeText(player.number) || numberFromJid(player.jid);
              const nick = normalizeName(player.nick || "Jugador");
              return `   ${row + 1}. ${nick} (${number ? `+${number}` : "sin numero"})`;
            })
            .join("\n")
        : "   Sin jugadores";
      return `*Equipo ${idx + 1}*\n${lines}`;
    })
    .join("\n\n");
}

function resolveTemplate(parts = []) {
  const first = normalizeText(parts[0] || "").toLowerCase();
  const template = TEMPLATE_MAP[first] || null;
  const base = template || {
    title: normalizeText(parts[0]) || "Evento Comunidad",
    game: "Comunidad",
    format: "4v4",
    slots: 20,
    mode: "general",
  };

  let title = base.title;
  let game = base.game;
  let format = base.format;
  let slots = base.slots;
  let mode = base.mode;
  let schedule = "Por definir";

  for (const part of parts) {
    const parsedFormat = parseFormat(part);
    if (parsedFormat) {
      format = parsedFormat;
      continue;
    }

    const parsedSlots = parseSlots(part);
    if (Number.isFinite(parsedSlots) && parsedSlots > 0) {
      slots = Math.max(2, Math.min(200, parsedSlots));
      continue;
    }

    if (/^modo\s*:/i.test(part) || /^mode\s*:/i.test(part)) {
      mode = normalizeText(part.split(":").slice(1).join(":")) || mode;
      continue;
    }

    if (/^hora\s*:/i.test(part) || /^horario\s*:/i.test(part) || /^schedule\s*:/i.test(part)) {
      schedule = normalizeText(part.split(":").slice(1).join(":")) || schedule;
      continue;
    }
  }

  if (!template && parts.length > 1) {
    const maybeGame = normalizeText(parts[1]);
    if (maybeGame && !parseFormat(maybeGame) && !parseSlots(maybeGame)) {
      game = maybeGame;
    }
  }

  return {
    title,
    game,
    format,
    slots,
    mode,
    schedule,
  };
}

function createEvent(groupId, payload = {}, createdBy = "") {
  const groupState = getGroupState(groupId);
  const id = `evt-${Date.now()}`;
  const event = {
    id,
    title: normalizeText(payload.title) || "Evento Comunidad",
    game: normalizeText(payload.game) || "Comunidad",
    format: normalizeText(payload.format) || "4v4",
    slots: Math.max(2, Math.min(200, Number(payload.slots || 20))),
    mode: normalizeText(payload.mode) || "general",
    schedule: normalizeText(payload.schedule) || "Por definir",
    status: "abierto",
    createdAt: nowIso(),
    createdBy: normalizeJid(createdBy),
    participants: [],
  };

  groupState.events[id] = event;
  groupState.activeEventId = id;
  store.scheduleSave();
  return event;
}

function addParticipant(event, sender, pushName = "", preferredNick = "") {
  if (!event || !Array.isArray(event.participants)) {
    return { ok: false, message: "No hay evento activo para inscribirse." };
  }

  if (normalizeText(event.status).toLowerCase() !== "abierto") {
    return { ok: false, message: "Las inscripciones estan cerradas en este evento." };
  }

  const senderJid = normalizeJid(sender);
  if (!senderJid) {
    return { ok: false, message: "No pude detectar tu usuario para inscribirte." };
  }

  const exists = event.participants.find((item) => normalizeJid(item.jid) === senderJid);
  if (exists) {
    return { ok: false, message: "Ya estas inscrito en este evento." };
  }

  const slots = Math.max(2, Math.min(200, Number(event.slots || 20)));
  if (event.participants.length >= slots) {
    return { ok: false, message: "El evento ya llego al maximo de cupos." };
  }

  const number = numberFromJid(senderJid);
  const nick = normalizeName(preferredNick) || normalizeName(pushName) || (number ? `Jugador ${number.slice(-4)}` : "Jugador");
  const participant = {
    jid: senderJid,
    number,
    nick,
    joinedAt: nowIso(),
  };

  event.participants.push(participant);
  store.scheduleSave();
  return { ok: true, participant };
}

function removeParticipant(event, sender) {
  if (!event || !Array.isArray(event.participants)) {
    return { ok: false, message: "No hay evento activo." };
  }

  const senderJid = normalizeJid(sender);
  if (!senderJid) {
    return { ok: false, message: "No pude detectar tu usuario." };
  }

  const before = event.participants.length;
  event.participants = event.participants.filter((item) => normalizeJid(item.jid) !== senderJid);
  if (event.participants.length === before) {
    return { ok: false, message: "No estabas inscrito en este evento." };
  }

  store.scheduleSave();
  return { ok: true };
}

async function sendEventoPanel({ sock, from, msg, settings, event = null }) {
  const prefix = getPrimaryPrefix(settings);
  const summary = event
    ? formatEventCard(event)
    : "No hay evento activo en este grupo.\nCrea uno desde el panel.";

  const sections = [
    {
      title: "Inscripcion",
      rows: [
        {
          header: "EVENTO",
          title: "Inscribirme al evento",
          description: "Registro automatico con tu numero.",
          id: `${prefix}evento unir`,
        },
        {
          header: "EVENTO",
          title: "Salir del evento",
          description: "Quita tu inscripcion actual.",
          id: `${prefix}evento salir`,
        },
        {
          header: "EVENTO",
          title: "Ver inscritos",
          description: "Lista completa de participantes.",
          id: `${prefix}evento lista`,
        },
      ],
    },
    {
      title: "Torneo",
      rows: [
        {
          header: "PLANTILLA",
          title: "Crear plantilla Free Fire 4v4",
          description: "Cupos 16, modo Clash Squad.",
          id: `${prefix}evento crear ff`,
        },
        {
          header: "PLANTILLA",
          title: "Crear plantilla CODM 5v5",
          description: "Cupos 20, multijugador.",
          id: `${prefix}evento crear codm`,
        },
        {
          header: "EQUIPOS",
          title: "Auto-armar equipos",
          description: "Agrupa por formato del evento.",
          id: `${prefix}evento equipos`,
        },
      ],
    },
    {
      title: "Control admin",
      rows: [
        {
          header: "ESTADO",
          title: "Ver estado del evento",
          description: "Resumen del torneo activo.",
          id: `${prefix}evento estado`,
        },
        {
          header: "CONTROL",
          title: "Cerrar inscripciones",
          description: "No permite nuevos inscritos.",
          id: `${prefix}evento cerrar`,
        },
        {
          header: "CONTROL",
          title: "Abrir inscripciones",
          description: "Habilita nuevos inscritos.",
          id: `${prefix}evento abrir`,
        },
        {
          header: "CONTROL",
          title: "Finalizar evento",
          description: "Cierra y libera el evento actual.",
          id: `${prefix}evento finalizar`,
        },
      ],
    },
  ];

  try {
    return await sock.sendMessage(
      from,
      {
        text: `*MODO EVENTO / TORNEO*\n\n${summary}`,
        title: "FSOCIETY BOT",
        subtitle: "Evento con inscripcion por botones",
        footer: "Selecciona una accion",
        interactiveButtons: [
          {
            name: "single_select",
            buttonParamsJson: JSON.stringify({
              title: "Abrir panel de evento",
              sections,
            }),
          },
        ],
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  } catch {
    return sock.sendMessage(
      from,
      {
        text:
          `*MODO EVENTO / TORNEO*\n\n` +
          `${summary}\n\n` +
          `Comandos rapidos:\n` +
          `- ${prefix}evento crear ff\n` +
          `- ${prefix}evento unir\n` +
          `- ${prefix}evento salir\n` +
          `- ${prefix}evento lista\n` +
          `- ${prefix}evento equipos\n` +
          `- ${prefix}evento cerrar\n` +
          `- ${prefix}evento finalizar`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  }
}

export default {
  name: "evento",
  command: [
    "evento",
    "torneo",
    "eventomenu",
    "modoevento",
    "inscribirevento",
    "salirevento",
  ],
  category: "freefire",
  description: "Modo evento/torneo con plantillas e inscripcion por botones.",
  groupOnly: true,

  run: async ({
    sock,
    msg,
    from,
    sender,
    args = [],
    settings = {},
    esAdmin = false,
    esOwner = false,
    commandName = "",
  }) => {
    const normalizedCommand = normalizeText(commandName).toLowerCase();
    const aliasActionMap = {
      inscribirevento: "unir",
      salirevento: "salir",
    };

    let action = aliasActionMap[normalizedCommand] || normalizeText(args[0]).toLowerCase();
    let payload = aliasActionMap[normalizedCommand] ? args : args.slice(1);

    if (!action || ["evento", "torneo", "menu", "help"].includes(action)) {
      action = "menu";
      payload = [];
    }

    const event = getActiveEvent(from);
    const isAdminUser = Boolean(esOwner || esAdmin);

    if (action === "menu") {
      return sendEventoPanel({ sock, from, msg, settings, event });
    }

    if (action === "crear") {
      if (!isAdminUser) {
        return sock.sendMessage(
          from,
          { text: "Solo admin/owner puede crear eventos o torneos.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      if (event && normalizeText(event.status).toLowerCase() !== "finalizado") {
        return sock.sendMessage(
          from,
          {
            text:
              `Ya hay un evento activo.\n` +
              `Usa *${getPrimaryPrefix(settings)}evento finalizar* para cerrar el actual.`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      const parts = parsePipeParts(payload);
      const template = resolveTemplate(parts.length ? parts : ["ff"]);
      const created = createEvent(from, template, sender);

      return sock.sendMessage(
        from,
        {
          text:
            `*EVENTO CREADO*\n\n` +
            `${formatEventCard(created)}\n\n` +
            `Inscribete con *${getPrimaryPrefix(settings)}evento unir*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (!event) {
      return sock.sendMessage(
        from,
        {
          text:
            `No hay evento activo en este grupo.\n` +
            `Crea uno con *${getPrimaryPrefix(settings)}evento crear ff*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "estado" || action === "info") {
      return sock.sendMessage(
        from,
        {
          text:
            `*ESTADO DEL EVENTO*\n\n` +
            `${formatEventCard(event)}\n\n` +
            `Participantes:\n${formatParticipants(event).split("\n").slice(0, 8).join("\n")}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "lista" || action === "inscritos") {
      return sock.sendMessage(
        from,
        {
          text:
            `*INSCRITOS DEL EVENTO*\n\n` +
            `${formatEventCard(event)}\n\n` +
            `${formatParticipants(event)}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "unir" || action === "join" || action === "inscribir") {
      const nick = normalizeText(parsePipeParts(payload)[0] || payload.join(" "));
      const result = addParticipant(event, sender, msg?.pushName || "", nick);
      if (!result.ok) {
        return sock.sendMessage(from, { text: result.message, ...global.channelInfo }, { quoted: msg });
      }

      return sock.sendMessage(
        from,
        {
          text:
            `✅ Inscripcion completada.\n` +
            `Jugador: *${result.participant.nick}*\n` +
            `Cupos: *${event.participants.length}/${event.slots}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "salir" || action === "leave" || action === "baja") {
      const result = removeParticipant(event, sender);
      if (!result.ok) {
        return sock.sendMessage(from, { text: result.message, ...global.channelInfo }, { quoted: msg });
      }

      return sock.sendMessage(
        from,
        {
          text: `Listo, saliste del evento.\nCupos: *${event.participants.length}/${event.slots}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "equipos" || action === "autoequipos") {
      return sock.sendMessage(
        from,
        {
          text:
            `*AUTO-EQUIPOS*\n\n` +
            `${formatEventCard(event)}\n\n` +
            `${buildTeamsText(event)}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "cerrar") {
      if (!isAdminUser) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede cerrar inscripciones.", ...global.channelInfo }, { quoted: msg });
      }
      event.status = "cerrado";
      store.scheduleSave();
      return sock.sendMessage(
        from,
        {
          text: `🔒 Inscripciones cerradas para *${event.title}*.`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "abrir") {
      if (!isAdminUser) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede abrir inscripciones.", ...global.channelInfo }, { quoted: msg });
      }
      event.status = "abierto";
      store.scheduleSave();
      return sock.sendMessage(
        from,
        {
          text: `✅ Inscripciones abiertas para *${event.title}*.`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "finalizar" || action === "cerrarevento" || action === "reset") {
      if (!isAdminUser) {
        return sock.sendMessage(from, { text: "Solo admin/owner puede finalizar eventos.", ...global.channelInfo }, { quoted: msg });
      }

      event.status = "finalizado";
      event.closedAt = nowIso();
      const groupState = getGroupState(from);
      groupState.activeEventId = "";
      store.scheduleSave();

      return sock.sendMessage(
        from,
        {
          text: `🏁 Evento finalizado: *${event.title}*.\nPuedes crear uno nuevo con *${getPrimaryPrefix(settings)}evento crear ff*.`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return sock.sendMessage(
      from,
      {
        text:
          `No reconoci esa accion.\n` +
          `Usa *${getPrimaryPrefix(settings)}evento* para abrir el panel.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
