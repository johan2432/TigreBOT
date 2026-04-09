import yts from 'yt-search'

export default {
  name: 'play',
  command: ['play'],
  category: 'descarga',

  async run(ctx) {
    const { sock: conn, m, from, args } = ctx

    try {
      const query = Array.isArray(args) ? args.join(' ').trim() : ''

      if (!query) {
        return await conn.sendMessage(
          from,
          { text: 'Ejemplo:\n.yts anuel aa' },
          { quoted: m }
        )
      }

      const res = await yts(query)
      const videos = Array.isArray(res?.videos) ? res.videos.slice(0, 10) : []

      if (!videos.length) {
        return await conn.sendMessage(
          from,
          { text: 'No encontré resultados.' },
          { quoted: m }
        )
      }

      let thumbBuffer = null
      try {
        if (videos[0]?.thumbnail) {
          const response = await fetch(videos[0].thumbnail)
          const arrayBuffer = await response.arrayBuffer()
          thumbBuffer = Buffer.from(arrayBuffer)
        }
      } catch (e) {
        console.error('Error descargando thumbnail:', e)
      }

      const mp4Rows = videos.map((v, i) => ({
        header: `${i + 1}`,
        title: String(v.title || 'Sin título').slice(0, 72),
        description: `🎬 MP4 | ⏱ ${v.timestamp || '??:??'} | 👤 ${v.author?.name || 'Desconocido'}`.slice(0, 72),
        id: `.ytmp4 ${v.url}`
      }))

      if (thumbBuffer) {
        await conn.sendMessage(
          from,
          {
            image: thumbBuffer,
            caption:
              `🎵 *FSOCIETY BOT*\n\n` +
              `🔎 Resultado para: *${query}*\n` +
              `📌 Primer resultado: *${videos[0].title}*\n\n` +
              `Selecciona un resultado para MP4. El scraper esta reiniciado para rehacerlo limpio.`
          },
          { quoted: m }
        )
      } else {
        await conn.sendMessage(
          from,
          {
            text:
              `🎵 *FSOCIETY BOT*\n\n` +
              `🔎 Resultado para: *${query}*\n\n` +
              `Selecciona un resultado para MP4. El scraper esta reiniciado para rehacerlo limpio.`
          },
          { quoted: m }
        )
      }

      return await conn.sendMessage(
        from,
        {
          text: `Resultados para: ${query}`,
          title: 'FSOCIETY BOT',
          subtitle: 'MP4',
          footer: 'Descargas YouTube',
          interactiveButtons: [
            {
              name: 'single_select',
              buttonParamsJson: JSON.stringify({
                title: '🎬 Descargar MP4',
                sections: [
                  {
                    title: 'Resultados MP4',
                    rows: mp4Rows
                  }
                ]
              })
            }
          ]
        },
        { quoted: m }
      )
    } catch (e) {
      console.error('Error en ysearch:', e)

      return await conn.sendMessage(
        from,
        { text: `Error en ysearch:\n${e?.message || e}` },
        { quoted: m }
      )
    }
  }
}
