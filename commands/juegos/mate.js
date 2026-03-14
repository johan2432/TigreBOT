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

const MAX_ATTEMPTS = 2;

function generateQuestion() {
  const operations = [
    () => {
      const a = Math.floor(Math.random() * 40) + 10;
      const b = Math.floor(Math.random() * 40) + 10;
      return { text: `${a} + ${b}`, answer: a + b };
    },
    () => {
      const a = Math.floor(Math.random() * 50) + 25;
      const b = Math.floor(Math.random() * 20) + 5;
      return { text: `${a} - ${b}`, answer: a - b };
    },
    () => {
      const a = Math.floor(Math.random() * 12) + 2;
      const b = Math.floor(Math.random() * 12) + 2;
      return { text: `${a} x ${b}`, answer: a * b };
    },
  ];

  return operations[Math.floor(Math.random() * operations.length)]();
}

export default {
  name: "mate",
  command: ["mate", "matematica", "math"],
  category: "juegos",
  description: "Resuelve una operacion matematica",

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

    const question = generateQuestion();
    setActiveSession(from, {
      game: "mate",
      userId: sender,
      question: question.text,
      answer: question.answer,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
    });

    return sock.sendMessage(
      from,
      {
        text:
          `*RETO MATE*\n\n` +
          `Resuelve: *${question.text}*\n` +
          `Tienes *${MAX_ATTEMPTS}* intentos.\n` +
          `Usa *${prefix}salirjuego* si quieres salir.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },

  onMessage: async ({ sock, msg, from, sender, text, settings }) => {
    const session = getActiveSession(from);
    if (!session || session.game !== "mate") return false;
    if (session.userId !== sender) return false;
    if (isCommandText(text, settings)) return false;

    const guess = Number.parseInt(String(text || "").trim(), 10);
    if (!Number.isFinite(guess)) {
      await sock.sendMessage(
        from,
        {
          text: "Envia solo el resultado numerico.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    const attempts = Number(session.attempts || 0) + 1;
    if (guess === Number(session.answer)) {
      clearActiveSession(from);
      const points = attempts === 1 ? 6 : 4;
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "mate",
        points,
        outcome: "win",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*GANASTE EN MATE*\n\n` +
            `Operacion: *${session.question}*\n` +
            `Respuesta: *${session.answer}*\n` +
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
        game: "mate",
        points: 0,
        outcome: "loss",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*PERDISTE EN MATE*\n\n` +
            `Operacion: *${session.question}*\n` +
            `Respuesta correcta: *${session.answer}*`,
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
          `No era ese resultado.\n` +
          `Operacion: *${session.question}*\n` +
          `Intentos: *${attempts}/${session.maxAttempts}*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
    return true;
  },
};
