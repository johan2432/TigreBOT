import fs from "fs";
import path from "path";
import axios from "axios";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";

const API_BASE = "https://dv-yer-api.online";
const API_AUDIO_URL = `${API_BASE}/ytdlmp3`;
const API_SEARCH_URL = `${API_BASE}/ytsearch`;

const COOLDOWN_TIME = 10 * 1000;
const AUDIO_QUALITY = "128k";
const REQUEST_TIMEOUT = 60000;
const TMP_DIR = path.join(process.cwd(), "tmp");
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const cooldowns = new Map();

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function safeFileName(name) {
  return (
    String(name || "audio")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "audio"
  );
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function extractYouTubeUrl(text) {
  const match = String(text || "").match(
    /https?:\/\/(?:www\.)?(?:youtube\.com|music\.youtube\.com|youtu\.be)\/[^\s]+/i
  );
  return match ? match[0].trim() : "";
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
  const quotedMessage = getQuotedMessage(ctx, msg);
  const quotedText = extractTextFromMessage(quotedMessage);

  return argsText || quotedText || "";
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractApiError(data, status) {
  return (
    data?.detail ||
    data?.error?.message ||
    data?.message ||
    (status ? `HTTP ${status}` : "Error de API")
  );
}

function pickDownloadUrl(data) {
  return (
    data?.download_url_full ||
    data?.download_url ||
    data?.stream_url_full ||
    data?.stream_url ||
    data?.url ||
    data?.result?.download_url_full ||
    data?.result?.download_url ||
    data?.result?.stream_url_full ||
    data?.result?.stream_url ||
    data?.result?.url ||
    ""
  );
}

async function apiGet(url, params, timeout = REQUEST_TIMEOUT) {
  const response = await axios.get(url, {
    timeout,
    params,
    validateStatus: () => true,
  });

  const data = response.data;

  if (response.status >= 400) {
    throw new Error(extractApiError(data, response.status));
  }

  if (data?.ok === false || data?.status === false) {
    throw new Error(extractApiError(data, response.status));
  }

  return data;
}

async function resolveSearch(query) {
  const data = await apiGet(API_SEARCH_URL, { q: query, limit: 1 }, 25000);
  const first = data?.results?.[0];

  if (!first?.url) {
    throw new Error("No se encontró el audio.");
  }

  return {
    videoUrl: first.url,
    title: safeFileName(first.title || "audio"),
    thumbnail: first.thumbnail || null,
  };
}

async function resolveRedirectTarget(url) {
  let lastError = "No se pudo resolver la redirección final.";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 0,
        validateStatus: () => true,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.location;
        if (location) return location;
      }

      if (response.status >= 200 && response.status < 300) {
        return url;
      }

      lastError = extractApiError(response.data, response.status);
    } catch (error) {
      lastError = error?.message || "redirect failed";
    }

    await sleep(700 * attempt);
  }

  throw new Error(lastError);
}

async function requestAudioSource(videoUrl) {
  let lastError = "No se pudo obtener el audio.";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await apiGet(API_AUDIO_URL, {
        mode: "link",
        quality: AUDIO_QUALITY,
        url: videoUrl,
      });

      const redirectUrl = pickDownloadUrl(data);
      if (!redirectUrl) {
        throw new Error("La API no devolvió download_url.");
      }

      const directUrl = await resolveRedirectTarget(redirectUrl);

      return {
        title: safeFileName(data?.title || data?.result?.title || "audio"),
        directUrl,
      };
    } catch (error) {
      lastError = error?.message || "Error desconocido";
      await sleep(900 * attempt);
    }
  }

  throw new Error(lastError);
}

async function downloadSourceFile(inputUrl, outputPath) {
  const response = await axios.get(inputUrl, {
    responseType: "stream",
    timeout: REQUEST_TIMEOUT,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
      Accept: "*/*",
      Referer: "https://www.youtube.com/",
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const contentLength = Number(response.headers?.["content-length"] || 0);
  if (contentLength && contentLength > MAX_AUDIO_BYTES) {
    throw new Error("Audio demasiado grande");
  }

  let downloaded = 0;

  response.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > MAX_AUDIO_BYTES) {
      response.data.destroy(new Error("Audio demasiado grande"));
    }
  });

  try {
    await pipeline(response.data, fs.createWriteStream(outputPath));
  } catch (error) {
    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {}
    throw error;
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("No se pudo descargar el audio.");
  }

  const size = fs.statSync(outputPath).size;
  if (!size || size < 100000) {
    throw new Error("Audio inválido");
  }

  return outputPath;
}

async function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        AUDIO_QUALITY,
        "-ar",
        "44100",
        "-map_metadata",
        "-1",
        "-loglevel",
        "error",
        outputPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    let errorText = "";

    ffmpeg.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new Error("ffmpeg no está instalado en el hosting."));
        return;
      }
      reject(error);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || `ffmpeg salió con código ${code}`));
    });
  });
}

async function sendAudioFile(sock, from, quoted, { filePath, title }) {
  try {
    await sock.sendMessage(
      from,
      {
        audio: { url: filePath },
        mimetype: "audio/mpeg",
        ptt: false,
        fileName: `${title}.mp3`,
        ...global.channelInfo,
      },
      quoted
    );
    return "audio";
  } catch (e1) {
    console.error("send audio failed:", e1?.message || e1);

    await sock.sendMessage(
      from,
      {
        document: { url: filePath },
        mimetype: "audio/mpeg",
        fileName: `${title}.mp3`,
        caption: `🎵 ${title}`,
        ...global.channelInfo,
      },
      quoted
    );
    return "document";
  }
}

export default {
  command: ["ytmp3", "play", "ytdlmp3"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const userId = from;

    let sourceFile = null;
    let finalMp3 = null;

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${getCooldownRemaining(until)}s`,
        ...global.channelInfo,
      });
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      const rawInput = resolveUserInput(ctx);

      if (!rawInput) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Uso: .ytmp3 <nombre o link> o responde a un mensaje con el link",
          ...global.channelInfo,
        });
      }

      let videoUrl = extractYouTubeUrl(rawInput);
      let title = "audio";
      let thumbnail = null;

      if (!videoUrl) {
        if (isHttpUrl(rawInput)) {
          cooldowns.delete(userId);
          return sock.sendMessage(from, {
            text: "❌ Envíame un link válido de YouTube.",
            ...global.channelInfo,
          });
        }

        const search = await resolveSearch(rawInput);
        videoUrl = search.videoUrl;
        title = search.title;
        thumbnail = search.thumbnail;
      }

      await sock.sendMessage(
        from,
        thumbnail
          ? {
              image: { url: thumbnail },
              caption: `🎵 Preparando audio...\n\n🎧 ${title}\n🎚️ Calidad: ${AUDIO_QUALITY}\n🌐 API: DVYER`,
              ...global.channelInfo,
            }
          : {
              text: `🎵 Preparando audio...\n\n🎧 ${title}\n🎚️ Calidad: ${AUDIO_QUALITY}\n🌐 API: DVYER`,
              ...global.channelInfo,
            },
        quoted
      );

      const info = await requestAudioSource(videoUrl);
      title = safeFileName(info.title || title);

      sourceFile = path.join(TMP_DIR, `${Date.now()}-source.tmp`);
      finalMp3 = path.join(TMP_DIR, `${Date.now()}-${title}.mp3`);

      await downloadSourceFile(info.directUrl, sourceFile);
      await convertToMp3(sourceFile, finalMp3);

      const size = fs.existsSync(finalMp3) ? fs.statSync(finalMp3).size : 0;

      if (!size || size < 100000) {
        throw new Error("Audio inválido");
      }

      if (size > MAX_AUDIO_BYTES) {
        throw new Error("Audio demasiado grande");
      }

      await sendAudioFile(sock, from, quoted, {
        filePath: finalMp3,
        title,
      });
    } catch (err) {
      console.error("YTDLMP3 ERROR:", err?.message || err);
      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: `❌ ${String(err?.message || "Error al procesar la música.")}`,
        ...global.channelInfo,
      });
    } finally {
      try {
        if (sourceFile && fs.existsSync(sourceFile)) {
          fs.unlinkSync(sourceFile);
        }
      } catch {}

      try {
        if (finalMp3 && fs.existsSync(finalMp3)) {
          fs.unlinkSync(finalMp3);
        }
      } catch {}
    }
  },
};

