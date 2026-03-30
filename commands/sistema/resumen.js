import { getPrimaryPrefix } from "../../lib/json-store.js";

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractTextFromMessage(message) {
  return (
    message?.text ||
    message?.caption ||
    message?.body ||
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.message?.videoMessage?.caption ||
    message?.message?.documentMessage?.caption ||
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    ""
  );
}

function getQuotedMessage(ctx, msg) {
  return (
    ctx?.quoted ||
    msg?.quoted ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    null
  );
}

function getQuotedMedia(message = {}) {
  if (!message || typeof message !== "object") return null;
  const audio = message?.audioMessage || message?.message?.audioMessage;
  if (audio) return { type: "audio", media: audio };

  const video = message?.videoMessage || message?.message?.videoMessage;
  if (video) return { type: "video", media: video };

  const document = message?.documentMessage || message?.message?.documentMessage;
  if (document) return { type: "document", media: document };

  return null;
}

function formatDuration(value = 0) {
  const total = Math.max(0, Math.floor(Number(value || 0)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(value = 0) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "N/D";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.floor(bytes)} B`;
}

function summarizeText(text = "") {
  const normalized = cleanText(text);
  if (!normalized) return null;

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
  const words = normalized.split(/\s+/).filter(Boolean);
  const readingMinutes = Math.max(1, Math.ceil(words.length / 180));

  const summary = sentences.slice(0, 3).join(" ");

  return {
    summary: summary || normalized.slice(0, 380),
    words: words.length,
    sentences: sentences.length,
    readingMinutes,
  };
}

export default {
  name: "resumen",
  command: ["resumen", "sumario", "brief"],
  category: "sistema",
  description: "Resumen rapido sin IA: texto o metadatos de audio/video",

  run: async (ctx) => {
    const { sock, from, args = [], settings } = ctx;
    const msg = ctx.msg || ctx.m || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const prefix = getPrimaryPrefix(settings);

    const quotedMessage = getQuotedMessage(ctx, msg);
    const quotedMedia = getQuotedMedia(quotedMessage);
    const argsText = cleanText(Array.isArray(args) ? args.join(" ") : "");
    const quotedText = cleanText(extractTextFromMessage(quotedMessage));
    const ownText = cleanText(extractTextFromMessage(msg));
    const targetText = cleanText(argsText || quotedText || ownText);

    if (quotedMedia) {
      const durationSeconds = Number(quotedMedia.media?.seconds || quotedMedia.media?.duration || 0);
      const fileSize = Number(quotedMedia.media?.fileLength || quotedMedia.media?.fileSize || 0);
      const mime = String(quotedMedia.media?.mimetype || "N/D").trim();

      return sock.sendMessage(
        from,
        {
          text:
            `📌 *RESUMEN DE MEDIA (SIN IA)*\n` +
            `Tipo: *${quotedMedia.type.toUpperCase()}*\n` +
            `Duracion: *${durationSeconds > 0 ? formatDuration(durationSeconds) : "N/D"}*\n` +
            `Tamano: *${formatBytes(fileSize)}*\n` +
            `MIME: *${mime}*\n\n` +
            `Nota: para resumen por contenido de audio se necesita transcripcion (API/STT).`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (!targetText) {
      return sock.sendMessage(
        from,
        {
          text:
            `Uso:\n` +
            `• ${prefix}resumen <texto largo>\n` +
            `• O responde un texto y usa: ${prefix}resumen\n` +
            `• O responde un audio/video para resumen de metadatos`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    const data = summarizeText(targetText);
    if (!data) {
      return sock.sendMessage(
        from,
        {
          text: "No pude generar resumen de ese texto.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    return sock.sendMessage(
      from,
      {
        text:
          `📝 *RESUMEN RAPIDO (SIN IA)*\n` +
          `${data.summary}\n\n` +
          `Palabras: *${data.words}*\n` +
          `Oraciones: *${data.sentences}*\n` +
          `Lectura aprox: *${data.readingMinutes} min*`,
        ...global.channelInfo,
      },
      quoted
    );
  },
};
