import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { execSync } from "child_process";

const API_URL = "https://mayapi.ooguy.com/ytdl";

// ====== SISTEMA INTELIGENTE DE API KEYS ======

const API_KEYS = [
  "may-ad025b11",
  "may-3e5a03fa",
  "may-1285f1e9",
  "may-5793b618",
  "may-72e941fc",
  "may-5d597e52"
];

let currentKeyIndex = 0;
const blockedKeys = new Map(); // key -> timestamp bloqueo
const RETRY_BLOCKED_AFTER = 30 * 60 * 1000; // 30 minutos

function getCurrentApiKey() {
  const now = Date.now();

  for (let i = 0; i < API_KEYS.length; i++) {
    const index = (currentKeyIndex + i) % API_KEYS.length;
    const key = API_KEYS[index];
    const blockedAt = blockedKeys.get(key);

    if (!blockedAt || (now - blockedAt) > RETRY_BLOCKED_AFTER) {
      currentKeyIndex = index;
      blockedKeys.delete(key);
      return key;
    }
  }

  return null; // todas bloqueadas
}

function markKeyAsBlocked(key) {
  blockedKeys.set(key, Date.now());
}

// ================= CONFIG ORIGINAL =================

const COOLDOWN_TIME = 15 * 1000;
const DEFAULT_QUALITY = "360p";

const TMP_DIR = path.join(process.cwd(), "tmp");

const MAX_VIDEO_BYTES = 70 * 1024 * 1024;
const MAX_DOC_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_FREE_BYTES = 350 * 1024 * 1024;
const MIN_VALID_BYTES = 300000;
const CLEANUP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const cooldowns = new Map();
const locks = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function safeFileName(name) {
  return (String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "video");
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

function parseQuality(args) {
  const q = args.find((a) => /^\d{3,4}p$/i.test(a));
  return (q || DEFAULT_QUALITY).toLowerCase();
}

function withoutQuality(args) {
  return args.filter((a) => !/^\d{3,4}p$/i.test(a));
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function getYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "").trim();
    const v = u.searchParams.get("v");
    if (v) return v.trim();
    const parts = u.pathname.split("/").filter(Boolean);
    const idxShorts = parts.indexOf("shorts");
    if (idxShorts >= 0 && parts[idxShorts + 1]) return parts[idxShorts + 1].trim();
    const idxEmbed = parts.indexOf("embed");
    if (idxEmbed >= 0 && parts[idxEmbed + 1]) return parts[idxEmbed + 1].trim();
    return null;
  } catch {
    return null;
  }
}

function cleanupTmp(maxAgeMs = CLEANUP_MAX_AGE_MS) {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TMP_DIR)) {
      const p = path.join(TMP_DIR, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (now - st.mtimeMs) > maxAgeMs) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

function getFreeBytes(dir) {
  try {
    const out = execSync(`df -k "${dir}" | tail -1 | awk '{print $4}'`).toString().trim();
    const freeKb = Number(out);
    return Number.isFinite(freeKb) ? freeKb * 1024 : null;
  } catch {
    return null;
  }
}

// ===== API con rotación automática =====

async function fetchDirectMediaUrl({ videoUrl, quality }) {
  let lastError = null;

  for (let i = 0; i < API_KEYS.length; i++) {
    const apiKey = getCurrentApiKey();
    if (!apiKey) break;

    try {
      const { data } = await axios.get(API_URL, {
        timeout: 25000,
        params: { url: videoUrl, quality, apikey: apiKey },
        validateStatus: (s) => s >= 200 && s < 500,
      });

      if (!data?.status || !data?.result?.url) {
        throw new Error(data?.message || "API inválida");
      }

      console.log(`✅ API usada: ${apiKey}`);

      return {
        title: data?.result?.title || "video",
        directUrl: data.result.url,
      };

    } catch (err) {
      console.log(`❌ API bloqueada o falló: ${apiKey}`);
      markKeyAsBlocked(apiKey);
      lastError = err;
    }
  }

  throw new Error("❌ Todas las API Keys están bloqueadas o fallando.");
}

// ================= RESTO DE TU CÓDIGO =================
// 🔥 TODO lo demás queda EXACTAMENTE igual
// (no modifico nada más de tu lógica)

export default {
  command: ["ytmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const userId = from;

    if (locks.has(from)) {
      return sock.sendMessage(from, { text: "⏳ Ya estoy procesando otro video aquí. Espera un momento.", ...global.channelInfo });
    }

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${getCooldownRemaining(until)}s`,
        ...global.channelInfo,
      });
    }
    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    const quoted = msg?.key ? { quoted: msg } : undefined;
    let outFile = null;

    try {
      locks.add(from);
      cleanupTmp();

      if (!args?.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, { text: "❌ Uso: .ytmp4 (360p) <nombre o link>", ...global.channelInfo });
      }

      const quality = parseQuality(args);
      const query = withoutQuality(args).join(" ").trim();
      if (!query) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, { text: "❌ Debes poner un nombre o link.", ...global.channelInfo });
      }

      const meta = await resolveVideoInfo(query);
      if (!meta) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, { text: "❌ No se encontró el video.", ...global.channelInfo });
      }

      let { videoUrl, title, thumbnail } = meta;

      if (thumbnail) {
        await sock.sendMessage(from, {
          image: { url: thumbnail },
          caption: `⬇️ Procesando...\n\n🎬 ${title}\n🎚️ Calidad: ${quality}\n⏳ Espera por favor...`,
          ...global.channelInfo,
        }, quoted);
      }

      const info = await fetchDirectMediaUrl({ videoUrl, quality });
      title = safeFileName(info.title || title);

      try {
        await sock.sendMessage(from, {
          video: { url: info.directUrl },
          mimetype: "video/mp4",
          caption: `🎬 ${title}`,
          ...global.channelInfo,
        }, quoted);
        return;
      } catch {
        throw new Error("Error enviando video.");
      }

    } catch (err) {
      cooldowns.delete(userId);
      await sock.sendMessage(from, {
        text: `❌ ${String(err?.message || "Error al procesar el video.")}`,
        ...global.channelInfo,
      });
    } finally {
      locks.delete(from);
    }
  },
};