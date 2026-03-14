import {
  formatDateTime,
  formatUserLabel,
  getUserGameProfile,
} from "./_shared.js";

export default {
  name: "perfilgame",
  command: ["perfilgame", "mijuego", "gameprofile"],
  category: "juegos",
  description: "Muestra tu perfil y progreso en los juegos",

  run: async ({ sock, msg, from, sender }) => {
    const profile = getUserGameProfile(sender);

    if (!profile) {
      return sock.sendMessage(
        from,
        {
          text: "No pude cargar tu perfil de juegos.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const topGames = Object.entries(profile.games || {})
      .map(([game, stats]) => ({
        game,
        points: Number(stats?.points || 0),
        wins: Number(stats?.wins || 0),
      }))
      .filter((entry) => entry.points > 0 || entry.wins > 0)
      .sort((a, b) => b.points - a.points || b.wins - a.wins)
      .slice(0, 5);

    return sock.sendMessage(
      from,
      {
        text:
          `*PERFIL DE JUEGOS*\n\n` +
          `Jugador: *${formatUserLabel(sender)}*\n` +
          `Puntos: *${profile.points || 0}*\n` +
          `Partidas: *${profile.played || 0}*\n` +
          `Victorias: *${profile.wins || 0}*\n` +
          `Derrotas: *${profile.losses || 0}*\n` +
          `Empates: *${profile.draws || 0}*\n` +
          `Racha actual: *${profile.streak || 0}*\n` +
          `Mejor racha: *${profile.bestStreak || 0}*\n` +
          `Ultima partida: *${formatDateTime(profile.lastPlayedAt)}*\n\n` +
          `Top juegos:\n` +
          (topGames.length
            ? topGames
                .map((item) => `- ${item.game}: ${item.points} pts / ${item.wins} wins`)
                .join("\n")
            : "- Todavia no tienes partidas guardadas."),
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
