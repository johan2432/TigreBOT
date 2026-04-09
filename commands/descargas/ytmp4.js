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

const API_YTMP4_URL = buildDvyerUrl("/ytmp4");
const TMP_DIR = path.join(os.tmpdir(), "dvyer-ytmp4");
const REQUEST_TIMEOUT = 15 * 60 * 1000;
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const VIDEO_AS_DOCUMENT_THRESHOLD = 80 * 1024 * 1024;
const MIN_VIDEO_BYTES = 64 * 1024;
const HTTP_AGENT = new http.Agent({ keepAlive: true });
const HTTPS_AGENT = new https.Agent({ keepAlive: true });
const QUALITY_PATTERN = /^(1080p|720p|480p|360p|240p|144p|best|hd|sd|\d{3,4}p?)$/i;

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
    String(name || "youtube-video")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[^\w .()[\]-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "youtube-video"
  );
}

function normalizeMp4Name(name) {
  const parsed = path.parse(String(name || "").trim());
  const base = safeFileName(parsed.name || name || "youtube-video");
  return `${base || "youtube-video"}.mp4`;
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

function resolveRawInput(ctx) {
  const msg = ctx.m || ctx.msg || null;
  const argsText = Array.isArray(ctx.args) ? ctx.args.join(" ").trim() : "";
  const quotedText = extractTextFromMessage(getQuotedMessage(ctx, msg));
  return cleanText(argsText || quotedText || "");
}

function extractYouTubeUrl(text) {
  const match = String(text || "").match(
    /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i
  );
  return match ? match[0].trim() : "";
}

function extractQualityAndQuery(input) {
  const tokens = cleanText(input).split(/\s+/).filter(Boolean);
  let quality = "360p";
  const remaining = [];

  for (const token of tokens) {
    if (QUALITY_PATTERN.test(token) && quality === "360p") {
      quality = token;
      continue;
    }
    remaining.push(token);
  }

  return {
    quality: normalizeQuality(quality),
    query: remaining.join(" ").trim(),
  };
}

function normalizeQuality(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "360p";
  if (text === "hd") return "720p";
  if (text === "sd") return "360p";
  if (text === "best") return "best";
  const match = text.match(/(\d{3,4})/);
  return match ? `${match[1]}p` : "360p";
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
      title: "YouTube MP4",
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
    title: cleanText(video.title || "YouTube MP4"),
    duration: cleanText(video.timestamp || ""),
    author: cleanText(video.author?.name || video.author || ""),
    searched: true,
  };
}

async function downloadYtmp4(videoUrl, preferredName, quality) {
  ensureTmpDir();
  const tempName = `${Date.now()}-${randomUUID()}-ytmp4.mp4`;
  const outputPath = path.join(TMP_DIR, tempName);

  const response = await axios.get(API_YTMP4_URL, {
    responseType: "stream",
    timeout: REQUEST_TIMEOUT,
    params: {
      mode: "file",
      url: videoUrl,
      quality,
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
  if (contentLength > MAX_VIDEO_BYTES) {
    throw new Error(`El video pesa ${humanBytes(contentLength)} y supera el limite del bot.`);
  }

  let downloaded = 0;
  response.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > MAX_VIDEO_BYTES) {
      response.data.destroy(new Error("El video es demasiado grande para enviarlo por WhatsApp."));
    }
  });

  try {
    await pipeline(response.data, fs.createWriteStream(outputPath));
  } catch (error) {
    deleteFileSafe(outputPath);
    throw error;
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("No se pudo guardar el MP4.");
  }

  const size = fs.statSync(outputPath).size;
  if (size < MIN_VIDEO_BYTES) {
    deleteFileSafe(outputPath);
    throw new Error("El archivo MP4 descargado es invalido.");
  }
  if (size > MAX_VIDEO_BYTES) {
    deleteFileSafe(outputPath);
    throw new Error(`El video pesa ${humanBytes(size)} y supera el limite del bot.`);
  }

  const headerName = parseContentDispositionFileName(response.headers?.["content-disposition"]);
  const fileName = normalizeMp4Name(headerName || preferredName || "youtube-video.mp4");

  return {
    tempPath: outputPath,
    fileName,
    size,
    contentType: response.headers?.["content-type"] || "video/mp4",
  };
}

async function sendMp4(sock, from, quoted, data) {
  const caption = [
    "╭─〔 *DVYER • YTMP4* 〕",
    `┃ 🎬 Titulo: ${clipText(data.title || data.fileName, 80)}`,
    `┃ ⌁ Calidad: ${data.quality || "360p"}`,
    `┃ ◈ Peso: ${humanBytes(data.size)}`,
    `┃ ⚡ Envio: ${data.size <= VIDEO_AS_DOCUMENT_THRESHOLD ? "video" : "documento"}`,
    "╰─⟡ MP4 listo.",
  ].join("\n");

  if (data.size <= VIDEO_AS_DOCUMENT_THRESHOLD) {
    try {
      await sock.sendMessage(
        from,
        {
          video: { url: data.tempPath },
          mimetype: "video/mp4",
          fileName: data.fileName,
          caption,
          gifPlayback: false,
          ...global.channelInfo,
        },
        quoted
      );
      return "video";
    } catch (error) {
      console.error("YTMP4 video send fallback:", error?.message || error);
    }
  }

  await sock.sendMessage(
    from,
    {
      document: { url: data.tempPath },
      mimetype: "video/mp4",
      fileName: data.fileName,
      caption,
      ...global.channelInfo,
    },
    quoted
  );
  return "document";
}

export default {
  command: ["ytmp4", "ytv", "ytvideo"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;

    let tempPath = null;
    let downloadCharge = null;

    try {
      cleanupOldFiles();

      const rawInput = resolveRawInput(ctx);
      const { quality, query } = extractQualityAndQuery(rawInput);
      const resolved = await resolveInputToUrl(query || rawInput);

      if (!resolved?.url) {
        return sock.sendMessage(
          from,
          {
            text: [
              "╭─〔 *DVYER • YTMP4* 〕",
              "┃ Uso: .ytmp4 <link o nombre>",
              "┃ Uso: .ytmp4 720p <link o nombre>",
              "┃ Ejemplo: .ytmp4 ozuna odisea",
              "┃ Ejemplo: .ytmp4 360p https://youtu.be/xxxx",
              "╰─⟡ MP4 directo desde la API.",
            ].join("\n"),
            ...global.channelInfo,
          },
          quoted
        );
      }

      downloadCharge = await chargeDownloadRequest(ctx, {
        feature: "ytmp4",
        videoUrl: resolved.url,
      });
      if (!downloadCharge.ok) return;

      await sock.sendMessage(
        from,
        {
          text: [
            "╭─〔 *DVYER • YTMP4* 〕",
            `┃ 🎬 Titulo: ${clipText(resolved.title, 80)}`,
            resolved.duration ? `┃ ⏱ Duracion: ${resolved.duration}` : "┃ ⏱ Duracion: detectando",
            `┃ ⌁ Calidad: ${quality}`,
            "┃ ⚡ Modo: descarga directa",
            "┃ ◈ Regla: video hasta 80 MB como video",
            "╰─⟡ Preparando MP4...",
          ].join("\n"),
          ...global.channelInfo,
        },
        quoted
      );

      const downloaded = await downloadYtmp4(resolved.url, resolved.title, quality);
      tempPath = downloaded.tempPath;

      await sendMp4(sock, from, quoted, {
        ...downloaded,
        title: path.parse(downloaded.fileName).name || resolved.title,
        quality,
      });
    } catch (error) {
      console.error("YTMP4 ERROR:", error?.message || error);
      refundDownloadCharge(ctx, downloadCharge, {
        feature: "ytmp4",
        error: String(error?.message || error || "unknown_error"),
      });

      await sock.sendMessage(
        from,
        {
          text: `❌ ${String(error?.message || "No se pudo preparar el MP4.")}`,
          ...global.channelInfo,
        },
        quoted
      );
    } finally {
      deleteFileSafe(tempPath);
    }
  },
};
