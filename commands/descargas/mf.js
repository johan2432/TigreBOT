import axios from "axios";
import fs from "fs";
import path from "path";

const BOT_NAME = "SonGokuBot";
const API_KEY = "dvyer";
const API_URL = "https://api-adonix.ultraplus.click/download/mediafire";
const MAX_MB = 300;

export default {
  command: ["mediafire", "mf"],
  category: "descarga",

  run: async ({ sock, from, args }) => {
    let filePath;

    try {

      if (!args.length) {
        return sock.sendMessage(from, {
          text: "❌ Usa:\n.mf <link de mediafire>"
        });
      }

      await sock.sendMessage(from, {
        text: `📥 Descargando archivo...\n⏳ ${BOT_NAME} trabajando`
      });

      const api = `${API_URL}?apikey=${API_KEY}&url=${encodeURIComponent(args[0])}`;
      const res = await axios.get(api, { timeout: 60000 });

      if (!res.data?.status || !res.data?.result?.link) {
        throw new Error("API inválida");
      }

      const file = res.data.result;

      // 📦 Detectar tamaño
      let sizeMB = 0;

      if (file.size?.includes("MB")) {
        sizeMB = parseFloat(file.size);
      } else if (file.size?.includes("GB")) {
        sizeMB = parseFloat(file.size) * 1024;
      }

      // 🚫 Si supera 300MB → solo link
      if (sizeMB > MAX_MB) {
        return sock.sendMessage(from, {
          text:
            `📁 *MediaFire Downloader*\n\n` +
            `📄 Archivo: ${file.filename}\n` +
            `📦 Tamaño: ${file.size}\n` +
            `📂 Tipo: ${file.filetype}\n\n` +
            `⚠️ Supera el límite de 300MB\n\n` +
            `🔗 Descargar:\n${file.link}`
        });
      }

      // 📂 Crear carpeta tmp
      const tmpDir = path.join(process.cwd(), "tmp");
      fs.mkdirSync(tmpDir, { recursive: true });

      const safeName = file.filename.replace(/[\\/:*?"<>|]/g, "");
      filePath = path.join(tmpDir, `${Date.now()}_${safeName}`);

      // ⬇️ Descargar archivo
      const fileRes = await axios.get(file.link, {
        responseType: "arraybuffer",
        timeout: 600000
      });

      fs.writeFileSync(filePath, fileRes.data);

      // 📤 Enviar documento
      await sock.sendMessage(from, {
        document: fs.readFileSync(filePath),
        fileName: safeName,
        mimetype: "application/octet-stream",
        caption:
          `📁 *MediaFire Downloader*\n\n` +
          `📄 Archivo: ${file.filename}\n` +
          `📦 Tamaño: ${file.size}\n` +
          `📂 Tipo: ${file.filetype}\n\n` +
          `🤖 ${BOT_NAME}`
      });

    } catch (err) {

      console.error("MEDIAFIRE ERROR:", err.message);

      await sock.sendMessage(from, {
        text: "❌ Error al descargar el archivo."
      });

    } finally {

      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

    }
  }
};