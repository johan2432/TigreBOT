import path from "path";
import { createScheduledJsonStore } from "../../lib/json-store.js";

const STORE_FILE = path.join(process.cwd(), "database", "resumirchat-buffer.json");
const store = createScheduledJsonStore(STORE_FILE, () => ({
  trackedSince: new Date().toISOString(),
  groups: {},
}));

const MAX_BUFFER_PER_GROUP = 260;
const DEFAULT_LIMIT = 40;

const STOPWORDS = new Set([
  "de", "la", "el", "los", "las", "y", "o", "u", "en", "por", "para", "con",
  "sin", "que", "se", "es", "un", "una", "unos", "unas", "lo", "al", "del",
  "a", "e", "i", "no", "si", "ya", "yo", "tu", "te", "mi", "me", "su", "sus",
  "le", "les", "como", "cuando", "donde", "porque", "pero", "mas", "muy",
  "the", "and", "for", "with", "you", "your", "this", "that", "from", "have",
  "has", "was", "were", "are", "they", "them", "just", "about", "hola", "jaja",
]);

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }
  return String(settings?.prefix || ".").trim() || ".";
}

function getPrefixes(settings) {
  if (Array.isArray(settings?.prefix)) {
    const values = settings.prefix.map((value) => String(value || "").trim()).filter(Boolean);
    return values.length ? values : ["."];
  }
  return [String(settings?.prefix || ".").trim() || "."];
}

function ensureGroup(groupId = "") {
  const groups = store.state.groups || (store.state.groups = {});
  const key = cleanText(groupId);
  if (!groups[key]) groups[key] = [];
  if (!Array.isArray(groups[key])) groups[key] = [];
  return groups[key];
}

function senderLabel(jid = "", pushName = "") {
  const name = cleanText(pushName);
  if (name) return name.slice(0, 40);
  const raw = String(jid || "").split("@")[0];
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : raw || "Desconocido";
}

function pushChatLine(groupId, line) {
  const rows = ensureGroup(groupId);
  rows.push(line);
  if (rows.length > MAX_BUFFER_PER_GROUP) {
    rows.splice(0, rows.length - MAX_BUFFER_PER_GROUP);
  }
  store.scheduleSave();
}

function parseLimit(raw = "") {
  const value = Number.parseInt(String(raw || "").trim(), 10);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(10, Math.min(120, value));
}

function topKeywords(lines = [], limit = 6) {
  const freq = new Map();
  for (const row of lines) {
    const words = cleanText(row?.text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));

    for (const word of words) {
      freq.set(word, Number(freq.get(word) || 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function topParticipants(lines = [], limit = 4) {
  const freq = new Map();
  for (const row of lines) {
    const key = cleanText(row?.sender || "Desconocido");
    if (!key) continue;
    freq.set(key, Number(freq.get(key) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function timelineLabel(iso = "") {
  try {
    return new Date(iso).toLocaleTimeString("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "--:--";
  }
}

function buildSummary(rows = []) {
  if (!rows.length) return null;

  const keywords = topKeywords(rows, 6);
  const participants = topParticipants(rows, 4);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const highlights = rows.slice(-6).map((row) => {
    const text = cleanText(row.text);
    return `- ${row.sender}: ${text.length > 80 ? `${text.slice(0, 77)}...` : text}`;
  });

  return {
    count: rows.length,
    range: `${timelineLabel(first.at)} - ${timelineLabel(last.at)}`,
    participants,
    keywords,
    highlights,
  };
}

export default {
  name: "resumirchat",
  command: ["resumirchat", "chatresumen", "resumenchat"],
  category: "ia",
  description: "Resume conversacion reciente del grupo con analisis rapido",
  groupOnly: true,

  run: async ({ sock, msg, from, args = [], settings }) => {
    const prefix = getPrefix(settings);
    const limit = parseLimit(args[0]);
    const rows = ensureGroup(from);
    const selected = rows.slice(-limit);
    const summary = buildSummary(selected);

    if (!summary) {
      return sock.sendMessage(
        from,
        {
          text:
            `Aun no tengo suficiente historial para resumir este chat.\n` +
            `Hablen un poco mas y vuelve a probar: *${prefix}resumirchat*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const participantText = summary.participants.length
      ? summary.participants.map(([name, count], index) => `${index + 1}. ${name} (${count})`).join("\n")
      : "Sin datos";
    const keywordText = summary.keywords.length
      ? summary.keywords.map(([word, count]) => `${word}(${count})`).join(", ")
      : "Sin temas claros";

    return sock.sendMessage(
      from,
      {
        text:
          `╭━━━〔 🧠 RESUMEN DE CHAT 〕━━━⬣\n` +
          `┃ Mensajes analizados: *${summary.count}*\n` +
          `┃ Rango: *${summary.range}*\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
          `👥 *Mas activos*\n${participantText}\n\n` +
          `🏷️ *Temas detectados*\n${keywordText}\n\n` +
          `📝 *Ultimos destacados*\n${summary.highlights.join("\n")}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },

  onMessage: async ({ from, esGrupo, msg, settings }) => {
    if (!esGrupo) return;
    const text = cleanText(msg?.text || msg?.body || "");
    if (!text) return;

    const prefixes = getPrefixes(settings);
    if (prefixes.some((prefix) => text.startsWith(prefix))) return;
    if (text.length < 2) return;

    const sender = senderLabel(msg?.sender || "", msg?.pushName || "");
    pushChatLine(from, {
      sender,
      text,
      at: new Date().toISOString(),
    });
  },
};
