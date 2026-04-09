import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import https from "https";
import axios from "axios";
import yts from "yt-search";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { buildDvyerUrl } from "../../lib/api-manager.js";
import { chargeDownloadRequest, refundDownloadCharge } from "../economia/download-access.js";

const API_YTMP3_URL = buildDvyerUrl("/ytmp3");
const TMP_DIR = path.join(os.tmpdir(), "dvyer-ytmp3");
const REQUEST_TIMEOUT = 12 * 60 * 1000;
const MAX_AUDIO_BYTES = 800 * 1024 * 1024;
const AUDIO_AS_DOCUMENT_THRESHOLD = 80 * 1024 * 1024;
const MIN_AUDIO_BYTES = 20 * 1024;
const HTTP_AGENT = new http.Agent({ keepAlive: true });
const HTTPS_AGENT = new https.Agent({ keepAlive: true });

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function cleanupOldFiles(maxAgeMs = 6 * 60 * 60 * 1000) {
  ensureTmpDir();
  const now = Date.now();
  for (const entry of fs.readdirSync(TMP_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(TMP_DIR, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(filePath);
    } catch {}
  }
}

function deleteFileSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clipText(value = "", max = 90) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3))}...`;
}

function humanBytes(bytes = 0) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "N/D";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function safeFileName(name) {
  return (
    String(name || "youtube-audio")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[^\w .()[\]-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "youtube-audio"
  );
}

function normalizeMp3Name(name) {
  const parsed = path.parse(String(name || "").trim());
  const base = safeFileName(parsed.name || name || "youtube-audio");
  return `${base || "youtube-audio"}.mp3`;
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

function resolveUserInput(ctx) {
  const msg = ctx.m || ctx.msg || null;
  const argsText = Array.isArray(ctx.args) ? ctx.args.join(" ").trim() : "";
  const quotedText = extractTextFromMessage(getQuotedMessage(ctx, msg));
  return argsText || quotedText || "";
}

function extractYouTubeUrl(text) {
  const match = String(text || "").match(
    /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i
  );
  return match ? match[0].trim() : "";
}

function parseContentDispositionFileName(headerValue) {
  const text = String(headerValue || "");
  const utfMatch = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]).replace(/["']/g, "").trim();
    } catch {}
  }
  const normalMatch = text.match(/filename="?([^"]+)"?/i);
  return normalMatch?.[1]?.trim() || "";
}

async function readStreamToText(stream) {
  return await new Promise((resolve, reject) => {
    let data = "";
    stream.on("data", (chunk) => {
      data += chunk.toString();
    });
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

function extractApiError(data, status) {
  return (
    data?.detail ||
    data?.error?.message ||
    data?.message ||
    (status ? `HTTP ${status}` : "Error de API")
  );
}

async function resolveInputToUrl(input) {
  const directUrl = extractYouTubeUrl(input);
  if (directUrl) {
    return {
      url: directUrl,
      title: "YouTube MP3",
      searched: false,
    };
  }

  const query = cleanText(input);
  if (!query) return null;

  const results = await yts(query);
  const video = Array.isArray(results?.videos) ? results.videos.find((item) => item?.url) : null;
  if (!video?.url) {
    throw new Error("No encontre resultados en YouTube.");
  }

  return {
    url: video.url,
    title: cleanText(video.title || "YouTube MP3"),
    duration: cleanText(video.timestamp || ""),
    author: cleanText(video.author?.name || video.author || ""),
    searched: true,
  };
}

async function downloadYtmp3(videoUrl, preferredName) {
  ensureTmpDir();
  const tempName = `${Date.now()}-${randomUUID()}-ytmp3.mp3`;
  const outputPath = path.join(TMP_DIR, tempName);

  const response = await axios.get(API_YTMP3_URL, {
    responseType: "stream",
    timeout: REQUEST_TIMEOUT,
    params: {
      mode: "file",
      url: videoUrl,
    },
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145 Safari/537.36",
      Accept: "*/*",
    },
    httpAgent: HTTP_AGENT,
    httpsAgent: HTTPS_AGENT,
    maxRedirects: 5,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const errorText = await readStreamToText(response.data).catch(() => "");
    let parsed = null;
    try {
      parsed = JSON.parse(errorText);
    } catch {}
    throw new Error(extractApiError(parsed || { message: errorText }, response.status));
  }

  const contentLength = Number(response.headers?.["content-length"] || 0);
  if (contentLength > MAX_AUDIO_BYTES) {
    throw new Error(`El MP3 pesa ${humanBytes(contentLength)} y supera el limite del bot.`);
  }

  let downloaded = 0;
  response.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > MAX_AUDIO_BYTES) {
      response.data.destroy(new Error("El MP3 es demasiado grande para enviarlo por WhatsApp."));
    }
  });

  try {
    await pipeline(response.data, fs.createWriteStream(outputPath));
  } catch (error) {
    deleteFileSafe(outputPath);
    throw error;
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("No se pudo guardar el MP3.");
  }

  const size = fs.statSync(outputPath).size;
  if (size < MIN_AUDIO_BYTES) {
    deleteFileSafe(outputPath);
    throw new Error("El archivo MP3 descargado es invalido.");
  }
  if (size > MAX_AUDIO_BYTES) {
    deleteFileSafe(outputPath);
    throw new Error(`El MP3 pesa ${humanBytes(size)} y supera el limite del bot.`);
  }

  const headerName = parseContentDispositionFileName(response.headers?.["content-disposition"]);
  const fileName = normalizeMp3Name(headerName || preferredName || "youtube-audio.mp3");

  return {
    tempPath: outputPath,
    fileName,
    size,
    contentType: response.headers?.["content-type"] || "audio/mpeg",
  };
}

async function sendMp3(sock, from, quoted, data) {
  const caption = [
    "╭─〔 *DVYER • YTMP3* 〕",
    `┃ ♬ Titulo: ${clipText(data.title || data.fileName, 80)}`,
    `┃ ⌁ Peso: ${humanBytes(data.size)}`,
    `┃ ◈ Envio: ${data.size <= AUDIO_AS_DOCUMENT_THRESHOLD ? "audio" : "documento"}`,
    "╰─⟡ MP3 listo.",
  ].join("\n");

  if (data.size <= AUDIO_AS_DOCUMENT_THRESHOLD) {
    try {
      await sock.sendMessage(
        from,
        {
          audio: { url: data.tempPath },
          mimetype: "audio/mpeg",
          fileName: data.fileName,
          ptt: false,
          ...global.channelInfo,
        },
        quoted
      );
      return "audio";
    } catch (error) {
      console.error("YTMP3 audio send fallback:", error?.message || error);
    }
  }

  await sock.sendMessage(
    from,
    {
      document: { url: data.tempPath },
      mimetype: "audio/mpeg",
      fileName: data.fileName,
      caption,
      ...global.channelInfo,
    },
    quoted
  );
  return "document";
}

export default {
  command: ["ytmp3", "yta", "ytaudio"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;

    let tempPath = null;
    let downloadCharge = null;

    try {
      cleanupOldFiles();

      const input = resolveUserInput(ctx);
      const resolved = await resolveInputToUrl(input);

      if (!resolved?.url) {
        return sock.sendMessage(
          from,
          {
            text: [
              "╭─〔 *DVYER • YTMP3* 〕",
              "┃ Uso: .ytmp3 <link o nombre>",
              "┃ Ejemplo: .ytmp3 ozuna odisea",
              "┃ Ejemplo: .ytmp3 https://youtu.be/xxxx",
              "╰─⟡ Envia MP3 rapido desde la API.",
            ].join("\n"),
            ...global.channelInfo,
          },
          quoted
        );
      }

      downloadCharge = await chargeDownloadRequest(ctx, {
        feature: "ytmp3",
        videoUrl: resolved.url,
      });
      if (!downloadCharge.ok) return;

      await sock.sendMessage(
        from,
        {
          text: [
            "╭─〔 *DVYER • YTMP3* 〕",
            `┃ ♬ Titulo: ${clipText(resolved.title, 80)}`,
            resolved.duration ? `┃ ⏱ Duracion: ${resolved.duration}` : "┃ ⏱ Duracion: detectando",
            "┃ ⚡ Modo: descarga directa",
            "┃ ◈ Regla: audio hasta 80 MB",
            "╰─⟡ Preparando MP3...",
          ].join("\n"),
          ...global.channelInfo,
        },
        quoted
      );

      const downloaded = await downloadYtmp3(resolved.url, resolved.title);
      tempPath = downloaded.tempPath;

      await sendMp3(sock, from, quoted, {
        ...downloaded,
        title: resolved.title,
      });
    } catch (error) {
      console.error("YTMP3 ERROR:", error?.message || error);
      refundDownloadCharge(ctx, downloadCharge, {
        feature: "ytmp3",
        error: String(error?.message || error || "unknown_error"),
      });

      await sock.sendMessage(
        from,
        {
          text: `❌ ${String(error?.message || "No se pudo preparar el MP3.")}`,
          ...global.channelInfo,
        },
        quoted
      );
    } finally {
      deleteFileSafe(tempPath);
    }
  },
};
