import axios from "axios";

// ================= CONFIG =================
const API_URL = "https://nexevo-api.vercel.app/download/tiktok";
const COOLDOWN_TIME = 10 * 1000;
const cooldowns = new Map();

const LINE = "━━━━━━━━━━━━━━━━━━━━";

// ================= COMANDO =================
export default {
  command: ["tiktok"],
  category: "descarga",

  run: async ({ sock, from, args, settings, m, msg }) => {
    const quoted = (m?.key || msg?.key) ? { quoted: (m || msg) } : undefined;
    const userId = from;
    const BOT_NAME = settings?.botName || "DVYER";

    // 🔒 COOLDOWN
    if (cooldowns.has(userId)) {
      const wait = cooldowns.get(userId) - Date.now();
      if (wait > 0) {
        return sock.sendMessage(
          from,
          {
            text: `⏳ Espera *${Math.ceil(wait / 1000)}s* antes de usar el comando`,
            ...global.channelInfo
          },
          quoted
        );
      }
    }
    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      if (!args.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text:
`╭─❌ *COMANDO INCORRECTO*
│ ${LINE}
│ 📌 Uso:
│ .tiktok <link>
│
│ ✏️ Ejemplo:
│ .tiktok https://www.tiktok.com/@usuario/video/123456
╰──────────────`,
            ...global.channelInfo
          },
          quoted
        );
      }

      let videoUrl = args[0].trim();

      // 🔥 Limpiar parámetros extra del link
      if (videoUrl.includes("?")) videoUrl = videoUrl.split("?")[0];

      // ✅ Validar dominios comunes de TikTok
      const isTikTok =
        /tiktok\.com/i.test(videoUrl) ||
        /vm\.tiktok\.com/i.test(videoUrl) ||
        /vt\.tiktok\.com/i.test(videoUrl);

      if (!isTikTok) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text:
`╭─❌ *LINK INVÁLIDO*
│ ${LINE}
│ Envía un link válido de TikTok
╰──────────────`,
            ...global.channelInfo
          },
          quoted
        );
      }

      // 📡 Mensaje procesando
      await sock.sendMessage(
        from,
        {
          text:
`╭─🎬 *TIKTOK DESCARGADOR*
│ ${LINE}
│ ⏳ Procesando video...
│ 🤖 ${BOT_NAME}
╰──────────────`,
          ...global.channelInfo
        },
        quoted
      );

      const api = `${API_URL}?url=${encodeURIComponent(videoUrl)}`;

      let data;
      try {
        const response = await axios.get(api, {
          timeout: 25000,
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        data = response.data;
      } catch (apiError) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text:
`╭─❌ *ERROR API*
│ ${LINE}
│ La API respondió con error
│ Puede estar caída o saturada
│ Intenta nuevamente en unos segundos
╰──────────────`,
            ...global.channelInfo
          },
          quoted
        );
      }

      // 🔎 Validar estructura real
      if (!data?.status || data?.result?.code !== 0 || !data?.result?.data) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text:
`╭─❌ *SIN RESULTADO*
│ ${LINE}
│ No se pudo obtener el video
│ Intenta con otro enlace
╰──────────────`,
            ...global.channelInfo
          },
          quoted
        );
      }

      const info = data.result.data;

      const video =
        info.hdplay ||
        info.play ||
        info.wmplay;

      if (!video) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text:
`╭─❌ *VIDEO NO DISPONIBLE*
│ ${LINE}
│ La API no devolvió enlace válido
╰──────────────`,
            ...global.channelInfo
          },
          quoted
        );
      }

      const title = (info.title || "Video TikTok").toString().slice(0, 80);

      // 🎬 Enviar video
      await sock.sendMessage(
        from,
        {
          video: { url: video },
          caption:
`╭─🎬 *VIDEO LISTO*
│ ${LINE}
│ 📌 *Título:* ${title}
│ ⏱️ *Duración:* ${info.duration || 0}s
│ ❤️ *Likes:* ${info.digg_count || 0}
│ 💬 *Comentarios:* ${info.comment_count || 0}
│ 🔁 *Compartidos:* ${info.share_count || 0}
│ ▶️ *Vistas:* ${info.play_count || 0}
│ 🌍 *Región:* ${info.region || "N/A"}
│
│ ⚡ Calidad automática
│ 🤖 ${BOT_NAME}
╰──────────────`,
          ...global.channelInfo
        },
        quoted
      );

    } catch (err) {
      console.error("❌ TIKTOK GENERAL ERROR:", err?.message || err);
      cooldowns.delete(userId);

      await sock.sendMessage(
        from,
        {
          text:
`╭─❌ *ERROR GENERAL*
│ ${LINE}
│ Ocurrió un problema inesperado
│ Intenta nuevamente
╰──────────────`,
          ...global.channelInfo
        },
        quoted
      );
    }
  }
};
