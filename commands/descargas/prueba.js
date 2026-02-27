import axios from 'axios';  // Necesitas instalar axios usando `npm install axios`
import yts from 'yt-search';  // Necesitas instalar yt-search usando `npm install yt-search`
import fs from 'fs';
import path from 'path';

const API_KEY = 'DvYer159';  // Tu nueva API Key
const TMP_DIR = path.join(process.cwd(), 'ytmp4');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const BASE_URL = 'https://api-sky.ultraplus.click'; // Base URL de la API

export default {
  command: ['ytmp1'],
  category: 'descarga',

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;

    if (!args.length) {
      return sock.sendMessage(from, {
        text: "❌ Uso: .ytmp1 <link o nombre del video>",
        ...global.channelInfo,
      });
    }

    let query = args.join(' ');  // Obtenemos el nombre o el link del video
    let videoUrl = query;

    try {
      // Si no es link, hacer búsqueda con yt-search
      if (!/^https?:\/\//i.test(query)) {
        const search = await yts(query);
        if (!search.videos.length) {
          throw new Error('No se encontró el video');
        }
        videoUrl = search.videos[0].url;
      }

      // 1) Obtener las opciones de calidad del video
      const optionsResponse = await axios.post(
        `${BASE_URL}/youtube-mp4`,
        { url: videoUrl },
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY,
          },
        }
      );

      console.log("Opciones de calidad:", optionsResponse.data);

      // Verificar si la respuesta tiene las opciones de calidad
      const videoOptions = optionsResponse.data?.result?.options?.video;
      if (!videoOptions || !videoOptions.find(opt => opt.label === '360p')) {
        throw new Error('No se encontró la calidad 360p');
      }

      // 2) Obtener el enlace de descarga en calidad 360p
      const resolveResponse = await axios.post(
        `${BASE_URL}/youtube-mp4/resolve`,
        {
          url: videoUrl,
          type: 'video',
          quality: '360',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY,
          },
        }
      );

      console.log("Respuesta de /resolve:", resolveResponse.data);

      const rel = resolveResponse.data?.result?.media?.dl_download;
      if (!rel) throw new Error('No se encontró enlace de descarga');

      // Construir la URL completa usando la URL base
      const downloadUrl = BASE_URL + rel;
      console.log('Enlace de descarga:', downloadUrl);  // Depuración: Verificar el enlace de descarga completo

      // 3) Descargar el archivo
      const videoFilePath = path.join(TMP_DIR, 'video_360p.mp4');
      const writer = fs.createWriteStream(videoFilePath);

      const videoRes = await axios({
        url: downloadUrl,  // Usamos la URL completa ahora
        method: 'GET',
        responseType: 'stream',
      });

      videoRes.data.pipe(writer);

      // Cuando el archivo se haya descargado
      writer.on('finish', async () => {
        await sock.sendMessage(
          from,
          {
            video: fs.readFileSync(videoFilePath),
            mimetype: 'video/mp4',
            caption: `🎬 Video descargado en 360p`,
            ...global.channelInfo,
          },
          msg?.key ? { quoted: msg } : undefined
        );

        // Eliminar el archivo temporal después de enviarlo
        fs.unlinkSync(videoFilePath);
      });

      writer.on('error', (err) => {
        throw new Error('Error al guardar el archivo de video: ' + err.message);
      });

    } catch (err) {
      console.error('❌ Error en YTMP1:', err);
      await sock.sendMessage(
        from,
        { text: `❌ Error: ${err.message}` },
        msg ? { quoted: msg } : undefined
      );
    }
  }
};
