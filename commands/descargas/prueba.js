import axios from "axios";
import yts from "yt-search";

const VREDEN_API = "https://api.vreden.my.id/api/v1/download/youtube/audio";
const COOLDOWN = 8000;
const cooldowns = new Map();

function safeFileName(name) {
  return String(name || "audio")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// Limpia links con ?si= / &list= / etc. y deja watch?v=ID
function cleanYoutubeUrl(input) {
  try {
    const u = new URL(input);

    // youtu.be/ID
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "");
      return `https://youtube.com/watch?v=${id}`;
    }

    // youtube.com/watch?v=ID
    const v = u.searchParams.get("v");
    if (v) return `https://youtube.com/watch?v=${v}`;

    return input;
  } catch {
    return input;
  }
}

export default {
  command: ["ytav", "ytmp3v", "mp3v"],
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
          { text: "🎧 Uso: .ytav <nombre o link de YouTube>", ...global.channelInfo },
          msg ? { quoted: msg } : undefined
        );
      }

      if (messageKey) {
        try { await sock.sendMessage(from, { react: { text: "⏳", key: messageKey } }); } catch {}
      }

      let query = args.join(" ").trim();
      let videoUrl = query;

      // Metadata para tarjeta
      let title = "YouTube Audio";
      let thumbnail = "";
      let duration = "??";

      // Si no es link: busca
      if (!/^https?:\/\//i.test(query)) {
        const { videos } = await yts(query);
        if (!videos?.length) throw new Error("Sin resultados");

        const v = videos.find((x) => x.seconds && x.seconds < 1800) || videos[0];
        videoUrl = v.url;
        title = v.title;
        thumbnail = v.thumbnail;
        duration = v.timestamp;
      } else {
        // Si es link: lo limpiamos
        videoUrl = cleanYoutubeUrl(query);

        // Opcional: sacar metadata con yts para bonita tarjeta
        try {
          const u = new URL(videoUrl);
          const vid = u.searchParams.get("v");
          if (vid) {
            const info = await yts({ videoId: vid });
            if (info?.title) {
              title = info.title;
              thumbnail = info.thumbnail || info.image || "";
              duration = info.timestamp || info.duration?.timestamp || duration;
            }
          }
        } catch {}
      }

      // Mensaje con tarjeta (como tu estilo)
      await sock.sendMessage(
        from,
        {
          text: `🎧 *Descargando Audio (Vreden)*\n\n🎵 ${title}\n⏱ ${duration}`,
          contextInfo: {
            externalAdReply: {
              title,
              body: `⏱ Duración: ${duration}`,
              thumbnailUrl: thumbnail || undefined,
              sourceUrl: videoUrl,
              mediaType: 1,
              renderLargerThumbnail: true,
              showAdAttribution: false,
            },
          },
          ...global.channelInfo,
        },
        msg ? { quoted: msg } : undefined
      );

      // ✅ SOLO VREDEN API
      const apiUrl =
        `${VREDEN_API}?url=${encodeURIComponent(videoUrl)}&quality=128`;

      const { data } = await axios.get(apiUrl, { timeout: 30000 });

      // Si la API responde pero status false
      if (!data?.status || !data?.result) {
        throw new Error("Respuesta inválida de Vreden");
      }

      // Caso como tu ejemplo: download.status=false "Converting error"
      if (data.result?.download?.status === false) {
        const reason = data.result.download?.message || "Converting error";
        cooldowns.delete(from);

        if (messageKey) {
          try { await sock.sendMessage(from, { react: { text: "❌", key: messageKey } }); } catch {}
        }

        return sock.sendMessage(
          from,
          { text: `❌ Vreden no pudo convertir el audio.\n> Motivo: *${reason}*`, ...global.channelInfo },
          msg ? { quoted: msg } : undefined
        );
      }

      // Buscar la URL de descarga (por si cambia el nombre de la llave)
      const dlUrl =
        data.result?.download?.url ||
        data.result?.download?.link ||
        data.result?.download_url ||
        data.result?.url;

      if (!dlUrl || !String(dlUrl).startsWith("http")) {
        throw new Error("Vreden no devolvió link de descarga");
      }

      // Enviar audio por URL (igual que tu ytmp3.js)
      await sock.sendMessage(
        from,
        {
          audio: { url: dlUrl },
          mimetype: "audio/mpeg",
          fileName: `${safeFileName(title)}.mp3`,
          contextInfo: {
            externalAdReply: {
              title,
              body: `⏱ ${duration}`,
              thumbnailUrl: thumbnail || undefined,
              sourceUrl: videoUrl,
              mediaType: 1,
              renderLargerThumbnail: true,
              showAdAttribution: false,
            },
          },
          ...global.channelInfo,
        },
        msg ? { quoted: msg } : undefined
      );

      if (messageKey) {
        try { await sock.sendMessage(from, { react: { text: "✅", key: messageKey } }); } catch {}
      }

    } catch (err) {
      cooldowns.delete(from);
      console.error("❌ YTAV (VREDEN) ERROR:", err?.message || err);

      if (messageKey) {
        try { await sock.sendMessage(from, { react: { text: "❌", key: messageKey } }); } catch {}
      }

      await sock.sendMessage(
        from,
        { text: "❌ No se pudo descargar el audio con Vreden.", ...global.channelInfo },
        msg ? { quoted: msg } : undefined
      );
    }
  },
};
