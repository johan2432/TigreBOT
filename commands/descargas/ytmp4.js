export default {
  command: ["ytmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;

    return sock.sendMessage(
      from,
      {
        text: [
          "╭─〔 *DVYER • YTMP4* 〕",
          "┃ Estado: scraper reiniciado",
          "┃ Los motores viejos de YouTube MP3/MP4 fueron retirados.",
          "┃ Solo queda la base /ytmp4 para crear el nuevo scraper desde cero.",
          "╰─⟡ Te aviso cuando vuelva a estar activo.",
        ].join("\n"),
        ...global.channelInfo,
      },
      quoted
    );
  },
};
