import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { spawn } from "child_process";

const API_URL = "https://nexevo-api.vercel.app/download/y2";
const COOLDOWN_TIME = 12 * 1000;
const cooldowns = new Map();

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// “sin límite” (pero ponemos uno enorme para no colgarse infinito)
const MAX_BYTES_HUGE = 2 * 1024 * 1024 * 1024; // 2GB

function safeFileName(name) {
  return String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

async function headInfo(url) {
  try {
    const res = await axios.head(url, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const len = Number(res.headers["content-length"] || 0);
    const contentType = String(res.headers["content-type"] || "");
    const server = String(res.headers["server"] || "");
    const finalUrl = res.request?.res?.responseUrl || url;

    return {
      len: Number.isFinite(len) ? len : 0,
      contentType,
      server,
      finalUrl,
      status: res.status,
    };
  } catch (e) {
    return {
      len: 0,
      contentType: "",
      server: "",
      finalUrl: url,
      status: 0,
      error: e?.message || "HEAD failed",
    };
  }
}

async function remuxNoLimitWithProgress({ inputUrl, outPath, sock, from, quotedMsg }) {
  const args = [
    "-y",
    "-loglevel", "error",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-i", inputUrl,
    "-map", "0:v",
    "-map", "0:a?",
    "-movflags", "+faststart",
    "-c", "copy",
    outPath,
  ];

  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr += d.toString()));

  // Progreso: cada 10s reporta tamaño actual
  const interval = setInterval(async () => {
    try {
      if (fs.existsSync(outPath)) {
        const s = fs.statSync(outPath).size;
        const mb = (s / 1048576).toFixed(1);
        await sock.sendMessage(
          from,
          { text: `📥 Progreso: ${mb} MB escritos…`, ...global.channelInfo },
          quotedMsg ? { quoted: quotedMsg } : undefined
        );

        // “sin límite” pero anti-bloqueo: si pasa 2GB, corta.
        if (s > MAX_BYTES_HUGE) {
          try { ff.kill("SIGKILL"); } catch {}
        }
      }
    } catch {}
  }, 10000);

  const code = await new Promise((resolve, reject) => {
    ff.on("close", (c) => resolve(c));
    ff.on("error", reject);
  });

  clearInterval(interval);

  if (code !== 0) {
    throw new Error(ffErr || `ffmpeg failed (code ${code})`);
  }

  const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  if (!size || size < 300000) throw new Error("Salida MP4 incompleta");
  return size;
}

export default {
  command: ["ytmp4dbg2", "ytmp4nolimit"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;

    const reply = (text) =>
      sock.sendMessage(
        from,
        { text, ...global.channelInfo },
        msg ? { quoted: msg } : undefined
      );

    const userId = from;
    if (cooldowns.has(userId)) {
      const wait = cooldowns.get(userId) - Date.now();
      if (wait > 0) return reply(`⏳ Espera ${Math.ceil(wait / 1000)}s`);
    }
    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    let finalMp4 = null;

    try {
      if (!args?.length) {
        cooldowns.delete(userId);
        return reply("❌ Uso: .ytmp4dbg2 <nombre o link de YouTube>");
      }

      const query = args.join(" ").trim();

      let ytUrl = query;
      let title = "YouTube Video";

      if (!/^https?:\/\//i.test(query)) {
        const search = await yts(query);
        if (!search.videos?.length) {
          cooldowns.delete(userId);
          return reply("❌ No se encontró el video");
        }
        const v = search.videos[0];
        ytUrl = v.url;
        title = safeFileName(v.title);
      }

      await reply(`🎬 *DEBUG NO LIMIT*\n📹 ${title}\n⏳ Pidiendo link…`);

      const api = `${API_URL}?url=${encodeURIComponent(ytUrl)}`;
      const { data } = await axios.get(api, { timeout: 20000 });

      if (!data?.status || !data?.result?.url) throw new Error("API inválida");
      const mp4Remote = data.result.url;

      // HEAD para ver si hay tamaño
      const info = await headInfo(mp4Remote);
      let host = "";
      try { host = new URL(info.finalUrl).host; } catch {}

      const sizeText = info.len
        ? `${(info.len / 1048576).toFixed(1)} MB`
        : "DESCONOCIDO (sin Content-Length)";

      await reply(
        `📌 Enlace:\n` +
        `• Host: ${host || "N/A"}\n` +
        `• HEAD: ${info.status || "N/A"}\n` +
        `• Tamaño remoto: ${sizeText}\n` +
        `• Server: ${info.server || "N/A"}\n`
      );

      finalMp4 = path.join(TMP_DIR, `${Date.now()}_${safeFileName(title)}.mp4`);

      await reply("⏳ Remux con ffmpeg… (te avisaré cada 10s el tamaño)");

      // Remux sin límite (con progreso)
      const finalSize = await remuxNoLimitWithProgress({
        inputUrl: mp4Remote,
        outPath: finalMp4,
        sock,
        from,
        quotedMsg: msg
      });

      await reply(`✅ Listo: ${(finalSize / 1048576).toFixed(1)} MB`);

      // Enviar (ojo: si pesa mucho, WhatsApp puede fallar)
      await sock.sendMessage(
        from,
        {
          video: { url: finalMp4 },
          mimetype: "video/mp4",
          fileName: `${safeFileName(title)}.mp4`,
          caption: `🎬 ${title}`,
          ...global.channelInfo,
        },
        msg ? { quoted: msg } : undefined
      );

    } catch (err) {
      console.error("YTMP4 DBG2 ERROR:", err?.message || err);

      if (String(err?.code) === "ENOSPC" || /no space/i.test(String(err?.message))) {
        return reply("❌ ENOSPC: tu hosting se quedó sin espacio mientras escribía. Eso confirma que el archivo era demasiado grande.");
      }

      await reply("❌ Error en debug nolimit (mira consola).");
    } finally {
      cooldowns.delete(userId);
      try { if (finalMp4 && fs.existsSync(finalMp4)) fs.unlinkSync(finalMp4); } catch {}
    }
  },
};
