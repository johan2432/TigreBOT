import axios from "axios";
import yts from "yt-search";

const API_URL = "https://nexevo-api.vercel.app/download/y";
const COOLDOWN = 8000;
const cooldowns = new Map();

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function axiosGetWithRetry(url, opts, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, opts);
    } catch (e) {
      lastErr = e;
      const code = e?.response?.status;
      const isRetryable =
        !code ||
        code >= 500 ||
        code === 429 ||
        e?.code === "ECONNRESET" ||
        e?.code === "ETIMEDOUT" ||
        e?.code === "ECONNABORTED";

      if (!isRetryable || i === retries) throw lastErr;
      await wait(400 * (i + 1)); // backoff simple
    }
  }
  throw lastErr;
}

export default {
  command: ["ytmp3"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;

    const msg = ctx.m || ctx.message || ctx.msg || null;
    const messageKey = msg?.key || null;

    const now = Date.now();
    const userCooldown = cooldowns.get(from);

    if (userCooldown && now < userCooldown) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${Math.ceil((userCooldown - now) / 1000)}s`,
      });
    }

    cooldowns.set(from, now + COOLDOWN);

    try {
      if (!args || !args.length) {
        cooldowns.delete(from);
        return sock.sendMessage(
          from,
          { text: "🎧 Uso: .ytmp3 <nombre o link>" },
          msg ? { quoted: msg } : undefined
        );
      }

      // ✅ reacción al inicio
      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "⏳", key: messageKey } });
      }

      let query = args.join(" ").trim();
      let videoUrl = query;
      let title = "YouTube Audio";
      let thumbnail = "";
      let duration = "??";

      // Si no es link, busca en YouTube
      if (!/^https?:\/\//i.test(query)) {
        const { videos } = await yts(query);
        if (!videos?.length) throw new Error("Sin resultados");

        // opcional: evitar lives muy largos
        const v = videos.find((x) => x.seconds && x.seconds < 1800) || videos[0];

        videoUrl = v.url;
        title = v.title;
        thumbnail = v.thumbnail;
        duration = v.timestamp;
      }

      // 1) pedir URL directa a la API (con retry)
      const apiRes = await axiosGetWithRetry(
        `${API_URL}?url=${encodeURIComponent(videoUrl)}`,
        { timeout: 25000 },
        2
      );

      const directUrl = apiRes?.data?.result?.url;

      // ✅ Validación fuerte para evitar ENOENT / url vacía
      if (!directUrl || typeof directUrl !== "string" || !directUrl.startsWith("http")) {
        throw new Error("API inválida: directUrl vacío");
      }

      // Aviso rápido (opcional)
      // await sock.sendMessage(from, { text: "🎧 Enviando audio..." }, msg ? { quoted: msg } : undefined);

      // 2) enviar por URL directa (más rápido, sin guardar archivo)
      await sock.sendMessage(
        from,
        {
          audio: { url: directUrl },
          mimetype: "audio/mpeg",
          fileName: `${title}.mp3`,
          contextInfo: thumbnail
            ? {
                externalAdReply: {
                  title,
                  body: `⏱ ${duration}`,
                  thumbnailUrl: thumbnail,
                  sourceUrl: videoUrl,
                  mediaType: 1,
                  renderLargerThumbnail: true,
                },
              }
            : undefined,
        },
        msg ? { quoted: msg } : undefined
      );

      // ✅ reacción final
      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "✅", key: messageKey } });
      }
    } catch (err) {
      cooldowns.delete(from);
      console.error("❌ YTMP3 ERROR:", err?.message || err);

      if (messageKey) {
        try {
          await sock.sendMessage(from, { react: { text: "❌", key: messageKey } });
        } catch {}
      }

      await sock.sendMessage(
        from,
        { text: "❌ No se pudo descargar el audio" },
        msg ? { quoted: msg } : undefined
      );
    }
  },
};

