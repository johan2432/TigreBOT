import yts from "yt-search";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import axios from "axios";
import sharp from "sharp";
import { getBuffer } from "../lib/message.js";

const api = { url: "https://nexevo-api.vercel.app" };

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const isYTUrl = (url) =>
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(url);

function safeFileName(name) {
  return String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

async function downloadToFile(url, outPath) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 60000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outPath);
    res.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  const size = fs.statSync(outPath).size;
  if (!size || size < 50_000) throw new Error("Archivo incompleto");
  return size;
}

export default {
  command: ["play2", "mp4", "ytmp4", "ytvideo", "playvideo"],
  category: "downloader",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const m = ctx.m || ctx.msg || null;

    const reply = (text) =>
      sock.sendMessage(
        from,
        { text, ...global.channelInfo },
        m ? { quoted: m } : undefined
      );

    let tempVideoPath = null;

    try {
      if (!args?.[0]) {
        return reply(
          "🌸 *Shizuka AI:*\n> Por favor, indícame qué video deseas visualizar."
        );
      }

      const query = args.join(" ");
      let url, title, thumbUrl, thumbBuffer, videoData;

      // 1) Buscar o usar link
      if (!isYTUrl(query)) {
        const search = await yts(query);
        if (!search.all?.length) {
          return reply("🥀 *Lo siento,*\n> no encontré resultados para tu búsqueda.");
        }
        videoData = search.all[0];
        url = videoData.url;
      } else {
        // Mantengo tu lógica original (no la cambio)
        const videoId = query.split("v=")[1] || query.split("/").pop();
        const search = await yts({ videoId });
        videoData = search;
        url = query;
      }

      title = videoData?.title || "YouTube Video";
      thumbUrl = videoData?.image || videoData?.thumbnail || null;

      if (thumbUrl) {
        thumbBuffer = await getBuffer(thumbUrl);
      }

      const vistas = (videoData?.views || 0).toLocaleString();
      const canal = videoData?.author?.name || "YouTube";

      // 2) Mensaje "preparando"
      let infoMessage = `✨ ── 𝒮𝒽𝒾𝓏𝓊𝓀𝒶 𝒜𝐼 ── ✨\n\n`;
      infoMessage += `🎬 *Tu video se está preparando*\n\n`;
      infoMessage += `• 🏷️ *Título:* ${title}\n`;
      infoMessage += `• 🎙️ *Canal:* ${canal}\n`;
      infoMessage += `• ⏳ *Duración:* ${videoData?.timestamp || "N/A"}\n`;
      infoMessage += `• 👀 *Vistas:* ${vistas}\n\n`;
      infoMessage += `> 💎 *Enviando contenido, espera un momento...*`;

      if (thumbBuffer) {
        await sock.sendMessage(
          from,
          { image: thumbBuffer, caption: infoMessage, ...global.channelInfo },
          m ? { quoted: m } : undefined
        );
      } else {
        await reply(infoMessage);
      }

      // 3) API NEXEVO (según tu ejemplo)
      const res = await fetch(`${api.url}/download/y2?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!data?.status || !data?.result?.url) {
        return reply("🥀 *Ups,*\n> hubo un pequeño fallo al procesar el video.");
      }

      const videoUrl = data.result.url;

      // Si la API trae thumbnail mejor, úsalo
      const apiThumb = data?.result?.info?.thumbnail;
      const finalThumbUrl = apiThumb || thumbUrl;

      // 4) Descargar a archivo temporal (cache) y borrar después de enviar
      const fileBase = safeFileName(title);
      tempVideoPath = path.join(TMP_DIR, `${Date.now()}_${fileBase}.mp4`);

      await downloadToFile(videoUrl, tempVideoPath);

      // thumbnail 300x300
      let jpegThumb;
      if (finalThumbUrl) {
        const tb = await getBuffer(finalThumbUrl);
        jpegThumb = await sharp(tb).resize(300, 300).jpeg({ quality: 80 }).toBuffer();
      } else if (thumbBuffer) {
        jpegThumb = await sharp(thumbBuffer).resize(300, 300).jpeg({ quality: 80 }).toBuffer();
      }

      // 5) Enviar video desde archivo local
      await sock.sendMessage(
        from,
        {
          video: { url: tempVideoPath },
          mimetype: "video/mp4",
          fileName: `${fileBase}.mp4`,
          jpegThumbnail: jpegThumb,
          caption: `🎬 *${title}*`,
          ...global.channelInfo,
        },
        m ? { quoted: m } : undefined
      );
    } catch (e) {
      console.error(e);
      await reply("🥀 *Shizuka AI:*\n> Ha ocurrido un error inesperado al procesar el video.");
    } finally {
      // ✅ borrar cache automáticamente
      try {
        if (tempVideoPath && fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
      } catch {}
    }
  },
};
