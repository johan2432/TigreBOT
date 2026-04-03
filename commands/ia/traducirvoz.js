import axios from "axios";
import pino from "pino";
import { downloadMediaMessage } from "@dvyer/baileys";
import { getPrimaryPrefix } from "../../lib/json-store.js";
import {
  getChatLanguage,
  listSupportedChatLanguages,
} from "../../lib/chat-language.js";

const logger = pino({ level: "silent" });

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getQuotedMessage(ctx, msg) {
  return (
    ctx?.quoted ||
    msg?.quoted ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    null
  );
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

function getQuotedAudioMessage(quoted = null) {
  if (!quoted || typeof quoted !== "object") return null;
  const audio =
    quoted?.message?.audioMessage ||
    quoted?.audioMessage ||
    quoted?.message?.pttMessage ||
    null;
  if (!audio) return null;

  if (quoted?.key && quoted?.message) {
    return {
      key: quoted.key,
      message: quoted.message,
    };
  }

  return null;
}

function buildDefaultTarget(chatLang = "es") {
  const normalized = String(chatLang || "es").trim().toLowerCase();
  if (normalized === "es") return "en";
  if (normalized === "en") return "es";
  if (normalized === "pt") return "es";
  return "en";
}

function parseLanguageArgs(args = [], chatLang = "es") {
  const supported = listSupportedChatLanguages();
  const values = Array.isArray(args) ? args.map((item) => cleanText(item)) : [];
  const first = String(values[0] || "").toLowerCase();
  const second = String(values[1] || "").toLowerCase();

  let source = "auto";
  let target = buildDefaultTarget(chatLang);
  let offset = 0;

  if (first.includes(">") || first.includes("|")) {
    const [left, right] = first.split(/[>|]/).map((item) => String(item || "").trim().toLowerCase());
    if (supported[left] && supported[right]) {
      source = left;
      target = right;
      offset = 1;
    }
  } else if (supported[first] && supported[second]) {
    source = first;
    target = second;
    offset = 2;
  } else if (supported[first]) {
    source = "auto";
    target = first;
    offset = 1;
  }

  return {
    source,
    target,
    text: cleanText(values.slice(offset).join(" ")),
  };
}

async function requestGoogleTranslate(text, source, target) {
  const response = await axios.get(
    "https://translate.googleapis.com/translate_a/single",
    {
      timeout: 25000,
      params: {
        client: "gtx",
        sl: source || "auto",
        tl: target,
        dt: "t",
        q: text,
      },
      validateStatus: () => true,
    }
  );

  if (response.status >= 400) {
    throw new Error(`google translate HTTP ${response.status}`);
  }

  const data = response.data;
  const parts = Array.isArray(data?.[0]) ? data[0] : [];
  const translated = parts.map((item) => String(item?.[0] || "")).join("").trim();
  const detected = String(data?.[2] || source || "auto").trim().toLowerCase() || "auto";

  if (!translated) throw new Error("google translate empty response");
  return { translated, detectedSource: detected, provider: "google" };
}

async function requestMyMemoryTranslate(text, source, target) {
  const response = await axios.get("https://api.mymemory.translated.net/get", {
    timeout: 25000,
    params: {
      q: text,
      langpair: `${source || "auto"}|${target}`,
    },
    validateStatus: () => true,
  });

  if (response.status >= 400) throw new Error(`mymemory HTTP ${response.status}`);
  const translated = cleanText(response.data?.responseData?.translatedText || "");
  if (!translated) throw new Error("mymemory empty response");

  return {
    translated,
    detectedSource: String(source || "auto").trim().toLowerCase() || "auto",
    provider: "mymemory",
  };
}

async function translateText(text, source, target) {
  try {
    return await requestGoogleTranslate(text, source, target);
  } catch (googleError) {
    try {
      return await requestMyMemoryTranslate(text, source, target);
    } catch (memoryError) {
      throw new Error(
        `No pude traducir ahora mismo. Google: ${googleError?.message || googleError} | MyMemory: ${memoryError?.message || memoryError}`
      );
    }
  }
}

function pickTranscribedText(data = {}) {
  const candidates = [
    data?.text,
    data?.transcript,
    data?.transcription,
    data?.transcripcion,
    data?.result?.text,
    data?.result?.transcript,
    data?.data?.text,
    data?.data?.transcript,
  ];
  for (const candidate of candidates) {
    const value = cleanText(candidate);
    if (value) return value;
  }
  return "";
}

async function transcribeWithEndpoint(sttUrl, audioBuffer, mimeType = "audio/ogg", sourceLang = "auto") {
  const endpoint = cleanText(sttUrl);
  if (!endpoint) throw new Error("No hay endpoint STT configurado.");

  const errors = [];

  try {
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType || "audio/ogg" });
    form.append("file", blob, "voice.ogg");
    form.append("lang", sourceLang);
    form.append("language", sourceLang);

    const response = await fetch(endpoint, {
      method: "POST",
      body: form,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const text = pickTranscribedText(data);
    if (!text) throw new Error("Respuesta sin texto de transcripcion");
    return text;
  } catch (error) {
    errors.push(`form-data: ${error?.message || error}`);
  }

  try {
    const payload = {
      audio_base64: Buffer.from(audioBuffer).toString("base64"),
      mime: mimeType || "audio/ogg",
      language: sourceLang,
    };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const text = pickTranscribedText(data);
    if (!text) throw new Error("Respuesta sin texto de transcripcion");
    return text;
  } catch (error) {
    errors.push(`json-base64: ${error?.message || error}`);
  }

  throw new Error(`No pude transcribir audio con ese endpoint. ${errors.join(" | ")}`);
}

export default {
  name: "traducirvoz",
  command: ["traducirvoz", "voice2text", "trvoz", "voztraducir"],
  category: "ia",
  description: "Traduce notas de voz en grupo (con STT configurado o transcripcion manual).",
  groupOnly: true,

  run: async (ctx) => {
    const { sock, from, args = [], settings } = ctx;
    const msg = ctx.msg || ctx.m || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const prefix = getPrimaryPrefix(settings);
    const chatLang = getChatLanguage(from, "es");
    const supported = listSupportedChatLanguages();
    const parsed = parseLanguageArgs(args, chatLang);
    const quotedMessage = getQuotedMessage(ctx, msg);

    if (!supported[parsed.target]) {
      return sock.sendMessage(
        from,
        {
          text: `Idioma destino no valido. Disponibles: ${Object.keys(supported).join(", ")}`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    let sourceText = cleanText(parsed.text || extractTextFromMessage(quotedMessage));

    if (!sourceText) {
      const quotedAudio = getQuotedAudioMessage(quotedMessage);
      if (!quotedAudio) {
        return sock.sendMessage(
          from,
          {
            text:
              `Uso:\n` +
              `• Responde a una nota de voz y usa: ${prefix}traducirvoz en\n` +
              `• O manual: ${prefix}traducirvoz en hola como estas\n\n` +
              `Tip: puedes configurar STT en settings.system.voiceSttUrl o env VOICE_STT_URL`,
            ...global.channelInfo,
          },
          quoted
        );
      }

      const sttUrl = cleanText(
        settings?.system?.voiceSttUrl ||
          process.env.VOICE_STT_URL ||
          process.env.STT_URL ||
          ""
      );

      if (!sttUrl) {
        return sock.sendMessage(
          from,
          {
            text:
              `No tengo endpoint de transcripcion configurado.\n` +
              `Configura *settings.system.voiceSttUrl* o variable *VOICE_STT_URL*.\n\n` +
              `Mientras tanto puedes usar:\n` +
              `• ${prefix}traducirvoz en <texto_transcrito>`,
            ...global.channelInfo,
          },
          quoted
        );
      }

      try {
        const audioBuffer = await downloadMediaMessage(
          quotedAudio,
          "buffer",
          {},
          { logger, reuploadRequest: sock.updateMediaMessage }
        );
        const mimeType =
          quotedAudio?.message?.audioMessage?.mimetype ||
          quotedAudio?.message?.pttMessage?.mimetype ||
          "audio/ogg";

        sourceText = await transcribeWithEndpoint(
          sttUrl,
          audioBuffer,
          mimeType,
          parsed.source
        );
      } catch (error) {
        return sock.sendMessage(
          from,
          {
            text:
              `No pude transcribir la nota de voz.\n` +
              `Error: ${String(error?.message || error).slice(0, 300)}`,
            ...global.channelInfo,
          },
          quoted
        );
      }
    }

    try {
      const result = await translateText(sourceText, parsed.source, parsed.target);
      return sock.sendMessage(
        from,
        {
          text:
            `🎙️ *TRADUCIR VOZ*\n` +
            `Origen: *${result.detectedSource.toUpperCase()}*\n` +
            `Destino: *${parsed.target.toUpperCase()}*\n` +
            `Proveedor traduccion: *${result.provider}*\n\n` +
            `📝 Texto detectado:\n${sourceText}\n\n` +
            `🌐 Traduccion:\n${result.translated}`,
          ...global.channelInfo,
        },
        quoted
      );
    } catch (error) {
      return sock.sendMessage(
        from,
        {
          text: `❌ ${String(error?.message || "No pude traducir la voz.")}`,
          ...global.channelInfo,
        },
        quoted
      );
    }
  },
};
