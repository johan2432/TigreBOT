import {
  clearActiveSession,
  formatUserLabel,
  getActiveSession,
} from "./_shared.js";

export default {
  name: "salirjuego",
  command: ["salirjuego", "cancelargame", "rendirse"],
  category: "juegos",
  description: "Cancela el juego activo del chat",

  run: async ({ sock, msg, from, sender, esOwner }) => {
    const session = getActiveSession(from);

    if (!session) {
      return sock.sendMessage(
        from,
        {
          text: "No hay ningun juego activo en este chat.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (!esOwner && session.userId !== sender) {
      return sock.sendMessage(
        from,
        {
          text:
            `Solo el jugador activo puede cancelar este juego.\n` +
            `Jugador: *${formatUserLabel(session.userId)}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    clearActiveSession(from);

    return sock.sendMessage(
      from,
      {
        text: `Juego *${String(session.game || "").toUpperCase()}* cancelado.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
