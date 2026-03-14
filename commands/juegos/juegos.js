import { getPrefix } from "./_shared.js";

export default {
  name: "juegos",
  command: ["juegos", "games", "menujuegos"],
  category: "juegos",
  description: "Muestra el menu de juegos del bot",

  run: async ({ sock, msg, from, settings }) => {
    const prefix = getPrefix(settings);

    return sock.sendMessage(
      from,
      {
        text:
          `*JUEGOS BOT*\n\n` +
          `Disponibles:\n` +
          `- ${prefix}ppt piedra\n` +
          `- ${prefix}adivina\n` +
          `- ${prefix}ahorcado\n` +
          `- ${prefix}mezclapalabra\n` +
          `- ${prefix}mate\n` +
          `- ${prefix}trivia\n` +
          `- ${prefix}emojiquiz\n` +
          `- ${prefix}tictactoe\n\n` +
          `Rankings:\n` +
          `- ${prefix}topjuegos\n` +
          `- ${prefix}topjuegos grupo\n` +
          `- ${prefix}topjuegos trivia\n` +
          `- ${prefix}topjuegos grupo trivia\n` +
          `- ${prefix}perfilgame\n\n` +
          `Control:\n` +
          `- ${prefix}salirjuego`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
