import {
  buildActiveSessionMessage,
  clearActiveSession,
  ensureSessionAvailable,
  getActiveSession,
  getPrefix,
  isCommandText,
  recordGameResult,
  setActiveSession,
  updateActiveSession,
} from "./_shared.js";

const MAX_ATTEMPTS = 8;

export default {
  name: "adivina",
  command: ["adivina", "guessnumber"],
  category: "juegos",
  description: "Adivina el numero secreto del bot",

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

    const target = Math.floor(Math.random() * 50) + 1;
    setActiveSession(from, {
      game: "adivina",
      userId: sender,
      target,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
    });

    return sock.sendMessage(
      from,
      {
        text:
          `*ADIVINA EL NUMERO*\n\n` +
          `Estoy pensando en un numero del 1 al 50.\n` +
          `Tienes *${MAX_ATTEMPTS}* intentos.\n` +
          `Responde solo con el numero.\n` +
          `Si quieres salir usa *${prefix}salirjuego*.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },

  onMessage: async ({ sock, msg, from, sender, text, settings }) => {
    const session = getActiveSession(from);
    if (!session || session.game !== "adivina") return false;
    if (session.userId !== sender) return false;
    if (isCommandText(text, settings)) return false;

    const guess = Number.parseInt(String(text || "").trim(), 10);
    if (!Number.isFinite(guess)) {
      await sock.sendMessage(
        from,
        {
          text: "Envia solo un numero del 1 al 50.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    const attempts = Number(session.attempts || 0) + 1;

    if (guess === Number(session.target)) {
      clearActiveSession(from);
      const points = Math.max(3, 10 - attempts);
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "adivina",
        points,
        outcome: "win",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*GANASTE EN ADIVINA*\n\n` +
            `Numero correcto: *${session.target}*\n` +
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
        game: "adivina",
        points: 0,
        outcome: "loss",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*PERDISTE EN ADIVINA*\n\n` +
            `Se acabaron tus intentos.\n` +
            `Numero correcto: *${session.target}*`,
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
          `${guess < Number(session.target) ? "Mas alto" : "Mas bajo"}.\n` +
          `Intento: *${attempts}/${session.maxAttempts}*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
    return true;
  },
};
