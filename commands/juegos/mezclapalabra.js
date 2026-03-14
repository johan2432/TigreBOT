import {
  buildActiveSessionMessage,
  clearActiveSession,
  ensureSessionAvailable,
  getActiveSession,
  getPrefix,
  isCommandText,
  randomItem,
  recordGameResult,
  scrambleWord,
  setActiveSession,
  updateActiveSession,
} from "./_shared.js";
import { SCRAMBLE_WORDS } from "./_data.js";

const MAX_ATTEMPTS = 3;

export default {
  name: "mezclapalabra",
  command: ["mezclapalabra", "scramble", "ordenapalabra"],
  category: "juegos",
  description: "Adivina la palabra desordenada",

  run: async ({ sock, msg, from, sender, settings }) => {
    const prefix = getPrefix(settings);
    const active = getActiveSession(from);

    if (!ensureSessionAvailable(from)) {
      return sock.sendMessage(
        from,
        {
          text: buildActiveSessionMessage(prefix, active),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const word = randomItem(SCRAMBLE_WORDS);
    const scrambled = scrambleWord(word);

    setActiveSession(from, {
      game: "mezclapalabra",
      userId: sender,
      word,
      scrambled,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
    });

    return sock.sendMessage(
      from,
      {
        text:
          `*MEZCLA PALABRA*\n\n` +
          `Ordena esta palabra:\n*${scrambled.toUpperCase()}*\n\n` +
          `Intentos: *0/${MAX_ATTEMPTS}*\n` +
          `Usa *${prefix}salirjuego* si quieres cancelar.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },

  onMessage: async ({ sock, msg, from, sender, text, settings }) => {
    const session = getActiveSession(from);
    if (!session || session.game !== "mezclapalabra") return false;
    if (session.userId !== sender) return false;
    if (isCommandText(text, settings)) return false;

    const answer = String(text || "").trim().toLowerCase();
    if (!answer) return false;

    const attempts = Number(session.attempts || 0) + 1;
    const target = String(session.word || "").toLowerCase();

    if (answer === target) {
      clearActiveSession(from);
      const points = Math.max(4, 9 - attempts);
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "mezclapalabra",
        points,
        outcome: "win",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*GANASTE EN MEZCLA PALABRA*\n\n` +
            `Palabra: *${target.toUpperCase()}*\n` +
            `Intentos: *${attempts}/${session.maxAttempts}*\n` +
            `Puntos: *+${points}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    if (attempts >= Number(session.maxAttempts || MAX_ATTEMPTS)) {
      clearActiveSession(from);
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "mezclapalabra",
        points: 0,
        outcome: "loss",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*PERDISTE EN MEZCLA PALABRA*\n\n` +
            `La palabra era: *${target.toUpperCase()}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    updateActiveSession(from, { attempts });

    await sock.sendMessage(
      from,
      {
        text:
          `No era esa.\n` +
          `Palabra mezclada: *${String(session.scrambled || "").toUpperCase()}*\n` +
          `Intentos: *${attempts}/${session.maxAttempts}*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
    return true;
  },
};
