import axios from "axios";
import yts from "yt-search";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const API_BASE = "https://dv-yer-api.online/ytmp3";
const COOLDOWN = 8000;
const cooldowns = new Map();

let busy = false;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withGlobalLock(fn) {
  while (busy) await wait(400);
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

function safeFileName(name) {
  return String(name || "audio")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export default {
  command: ["ytmp3", "play"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const messageKey = msg?.key || null;

    const now = Date.now();
    const userCooldown = cooldowns.get(from);

    if (userCooldown && now < userCooldown) {
      return sock.sendMessage(
        from,
        { text: `⏳ Espera ${Math.ceil((userCooldown - now) / 1000)}s`, ...global.channelInfo },
        msg ? { quoted: msg } : undefined
      );
    }

    cooldowns.set(from, now + COOLDOWN);

    try {
      if (!args?.length) {
        cooldowns.delete(from);
        return sock.sendMessage(
          from,
          { text: "🎧 Uso: .ytmp3 <nombre o link>", ...global.channelInfo },
          msg ? { quoted: msg } : undefined
        );
      }

      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "⏳", key: messageKey } });
      }

      let query = args.join(" ").trim();
      let videoUrl = query;
      let title = "YouTube Audio";
      let thumbnail = "";
      let duration = "??";

      if (!/^https?:\/\//i.test(query)) {
        const { videos } = await yts(query);
        if (!videos?.length) throw new Error("Sin resultados");
        const v = videos.find((x) => x.seconds && x.seconds < 1800) || videos[0];
        videoUrl = v.url;
        title = v.title;
        thumbnail = v.thumbnail;
        duration = v.timestamp;
      }

      await sock.sendMessage(
        from,
        {
          text: `🎧 *Descargando...*\n\n🎵 ${title}\n⏱ ${duration}`,
          contextInfo: {
            externalAdReply: {
              title: title,
              body: `⏱ ${duration}`,
              thumbnailUrl: thumbnail,
              sourceUrl: videoUrl,
              mediaType: 1,
              renderLargerThumbnail: true,
              showAdAttribution: false
            }
          },
          ...global.channelInfo
        },
        msg ? { quoted: msg } : undefined
      );

      // Petición con User-Agent para evitar bloqueos
      const apiRes = await axios.get(API_BASE, {
        params: { mode: "link", quality: "128k", url: videoUrl },
        headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36" 
        },
        timeout: 35000
      });

      const data = apiRes.data;
      const audioUrl = data?.download_url_full;

      if (!data?.ok || !audioUrl) {
        throw new Error("La API no devolvió un enlace válido.");
      }

      await withGlobalLock(async () => {
        await sock.sendMessage(
          from,
          {
            audio: { url: audioUrl },
            mimetype: "audio/mpeg",
            ptt: false, // Asegura que se envíe como archivo de audio
            fileName: `${safeFileName(title)}.mp3`,
            contextInfo: {
              externalAdReply: {
                title: title,
                body: `⏱ ${duration}`,
                thumbnailUrl: thumbnail,
                sourceUrl: videoUrl,
                mediaType: 1,
                renderLargerThumbnail: true
              }
            },
            ...global.channelInfo
          },
          msg ? { quoted: msg } : undefined
        );
      });

      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "✅", key: messageKey } });
      }

    } catch (err) {
      cooldowns.delete(from);
      console.error("❌ YTMP3 ERROR:", err?.message || err);

      if (messageKey) {
        try { await sock.sendMessage(from, { react: { text: "❌", key: messageKey } }); } catch {}
      }

      await sock.sendMessage(
        from,
        { text: "❌ No se pudo descargar el audio. Intenta de nuevo.", ...global.channelInfo },
        msg ? { quoted: msg } : undefined
      );
    }
  },
};
