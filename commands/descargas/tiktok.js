import axios from "axios";

// ================= CONFIG =================
const COOLDOWN_TIME = 10 * 1000;
const cooldowns = new Map();

const BORDER = "⭐════════════════════════⭐";
const LINE = "❒════════════════════════";
const SMALL = "•────────────────────────•";

const NEXEVO_API = "https://nexevo.onrender.com/download/tiktok?url=";

// Límite (por si te mandan videos grandes)
const MAX_MB = 45; // ajusta a tu gusto
const MAX_BYTES = MAX_MB * 1024 * 1024;

// ================= HELPERS =================
function normalizeText(str = "") {
  return String(str).replace(/\s+/g, " ").trim();
}
function clip(str = "", max = 90) {
  const s = normalizeText(str);
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}
function isTikTokUrl(u) {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    return host.includes("tiktok.com") || host.includes("vm.tiktok.com") || host.includes("vt.tiktok.com");
  } catch {
    return false;
  }
}
function formatNum(n) {
  return Number(n || 0).toLocaleString("es-ES");
}
function unixToDate(unixSeconds) {
  try {
    if (!unixSeconds) return "—";
    const d = new Date(Number(unixSeconds) * 1000);
    return d.toLocaleString("es-ES", { hour12: false });
  } catch {
    return "—";
  }
}

/**
 * Descarga binaria del video (Buffer) para evitar "pantalla negra"
 */
async function downloadBinary(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: MAX_BYTES,
    maxBodyLength: MAX_BYTES,
    headers: {
      // Ayuda con algunos CDNs
      "User-Agent": "Mozilla/5.0",
      "Accept": "*/*",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const contentType = String(res.headers?.["content-type"] || "").toLowerCase();
  const buf = Buffer.from(res.data);

  return { buf, contentType, size: buf.length };
}

// ================= COMANDO =================
export default {
  command: ["tiktok", "tt", "tk"],
  category: "descarga",

  run: async ({ sock, from, args, settings, m, msg }) => {
    const quoted = (m?.key || msg?.key) ? { quoted: (m || msg) } : undefined;
    const channelContext = global.channelInfo || {};
    const BOT_NAME = settings?.botName || "DVYER";

    const userId = from;
    const now = Date.now();
    const endsAt = cooldowns.get(userId) || 0;
    const wait = endsAt - now;

    if (wait > 0) {
      return sock.sendMessage(
        from,
        { text: `⚠️ *¡DESPACIO!* ⏳\nEspera *${Math.ceil(wait / 1000)}s* para volver a usar este comando.`, ...channelContext },
        quoted
      );
    }
    cooldowns.set(userId, now + COOLDOWN_TIME);

    const videoUrl = args.join(" ").trim();

    if (!videoUrl || !isTikTokUrl(videoUrl)) {
      cooldowns.delete(userId);
      return sock.sendMessage(
        from,
        {
          text:
            `*┏━━━〔 📥 TIKTOK DOWNLOADER 〕━━━┓*\n\n` +
            `❌ *ERROR:* Enlace inválido.\n\n` +
            `📌 *USO:* .tiktok <link>\n\n` +
            `*┗━━━━━━━━━━━━━━━━━━━━┛*`,
          ...channelContext,
        },
        quoted
      );
    }

    // 🔔 Notificación 1
    await sock.sendMessage(
      from,
      {
        text:
          `⚡ *Detectado enlace TikTok*\n${SMALL}\n` +
          `🔎 Consultando API...\n${SMALL}`,
        ...channelContext,
      },
      { quoted: m || msg }
    );

    try {
      // 1) Consultar API
      const apiUrl = NEXEVO_API + encodeURIComponent(videoUrl);
      const { data } = await axios.get(apiUrl, { timeout: 30000, headers: { Accept: "application/json" } });

      if (!data?.status || data?.result?.code !== 0 || !data?.result?.data) {
        throw new Error(data?.result?.msg || "La API no devolvió datos.");
      }

      const info = data.result.data;

      // 2) Elegir mejor URL de video
      const candidates = [info.hdplay, info.play, info.wmplay].filter(Boolean);
      if (!candidates.length) throw new Error("No hay enlaces de video disponibles.");

      const title = clip(info.title || "Sin descripción", 100);
      const authorName =
        info?.author?.nickname ||
        info?.author?.unique_id ||
        info?.music_info?.author ||
        "TikTok User";

      // 🔔 Notificación 2
      await sock.sendMessage(
        from,
        {
          text:
            `⬇️ *Descargando video...*\n${SMALL}\n` +
            `🎬 *${clip(title, 60)}*\n` +
            `👤 *${clip(authorName, 40)}*\n` +
            `📦 Máximo permitido: *${MAX_MB}MB*\n${SMALL}`,
          ...channelContext,
        },
        { quoted: m || msg }
      );

      // 3) Descargar binario (con fallback)
      let bin = null;
      let chosenUrl = null;

      for (const u of candidates) {
        try {
          const got = await downloadBinary(u);
          // Validación rápida
          // A veces content-type viene raro, así que también comprobamos "firma" mp4
          const isProbablyVideo =
            got.contentType.includes("video") ||
            got.buf.slice(4, 8).toString("ascii") === "ftyp"; // mp4 ftyp

          if (!isProbablyVideo) continue;

          bin = got;
          chosenUrl = u;
          break;
        } catch {
          // intenta siguiente
        }
      }

      if (!bin) {
        throw new Error("No pude descargar el video como MP4 (CDN bloqueado o formato no compatible).");
      }

      if (bin.size > MAX_BYTES) {
        throw new Error(`El video pesa ${(bin.size / (1024 * 1024)).toFixed(1)}MB y supera el límite (${MAX_MB}MB).`);
      }

      // Caption pro
      const caption = `
${BORDER}
🎬 *TIKTOK DOWNLOADER (HD)*
${BORDER}

📝 *Título:* ${title}
👤 *Autor:* ${authorName}
🕒 *Duración:* ${Number(info.duration || 0)}s
🌎 *Región:* ${info.region || "—"}
📅 *Publicado:* ${unixToDate(info.create_time)}

${LINE}
📊 *Estadísticas:*
▶️ ${formatNum(info.play_count)}  |  ❤️ ${formatNum(info.digg_count)}
💬 ${formatNum(info.comment_count)} | 🔁 ${formatNum(info.share_count)}
📌 Guardados: ${formatNum(info.collect_count)}

${LINE}
🤖 *Bot:* ${BOT_NAME}
${BORDER}`.trim();

      // 🔔 Notificación 3
      await sock.sendMessage(
        from,
        { text: `📤 *Enviando video a WhatsApp...*\n${SMALL}\n✅ Descarga completa: *${(bin.size / (1024 * 1024)).toFixed(1)}MB*\n${SMALL}`, ...channelContext },
        { quoted: m || msg }
      );

      // 4) Enviar como Buffer (evita video negro)
      try {
        await sock.sendMessage(
          from,
          {
            video: bin.buf,
            mimetype: "video/mp4",
            caption,
            fileName: `tiktok_${info.id || Date.now()}.mp4`,
            ...channelContext,
          },
          quoted
        );
      } catch (e) {
        // Fallback: enviar como documento (muchas veces sí abre bien)
        await sock.sendMessage(
          from,
          {
            document: bin.buf,
            mimetype: "video/mp4",
            fileName: `tiktok_${info.id || Date.now()}.mp4`,
            caption: caption,
            ...channelContext,
          },
          quoted
        );
      }

      // (Opcional) enviar audio aparte si quieres:
      const audioUrl = info?.music_info?.play || info?.music || null;
      if (audioUrl) {
        await sock.sendMessage(
          from,
          {
            text: `🎵 *Audio:* ${audioUrl}`,
            ...channelContext,
          },
          quoted
        );
      }

      // debug opcional (por si quieres ver qué URL usó)
      // console.log("Video URL usada:", chosenUrl);

    } catch (err) {
      console.error("❌ ERROR TIKTOK (BUFFER SEND):", err?.message || err);
      cooldowns.delete(userId);

      await sock.sendMessage(
        from,
        {
          text:
            `❌ *ERROR AL DESCARGAR/ENVIAR*\n` +
            `${LINE}\n` +
            `🧩 *Motivo:* ${clip(err?.message || "Error desconocido", 140)}\n` +
            `${LINE}\n` +
            `✅ Prueba:\n` +
            `• Otro enlace (vm/vt también sirven)\n` +
            `• Si pesa mucho, baja el límite o manda como documento\n` +
            `• Si es privado, no se podrá descargar`,
          ...channelContext,
        },
        quoted
      );
    }
  },
};
