import {
  buildActiveSessionMessage,
  clearActiveSession,
  ensureSessionAvailable,
  getActiveSession,
  getPrefix,
  isCommandText,
  randomItem,
  recordGameResult,
  setActiveSession,
} from "./_shared.js";
import { TRIVIA_QUESTIONS } from "./_data.js";

function normalizeAnswer(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "a") return 1;
  if (raw === "b") return 2;
  if (raw === "c") return 3;
  if (raw === "d") return 4;
  return Number.parseInt(raw, 10);
}

export default {
  name: "trivia",
  command: ["trivia", "quiz"],
  category: "juegos",
  description: "Responde preguntas de trivia",

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

    const question = randomItem(TRIVIA_QUESTIONS);
    setActiveSession(from, {
      game: "trivia",
      userId: sender,
      question: question.question,
      options: question.options,
      answer: question.answer,
    });

    return sock.sendMessage(
      from,
      {
        text:
          `*TRIVIA*\n\n` +
          `${question.question}\n\n` +
          `1. ${question.options[0]}\n` +
          `2. ${question.options[1]}\n` +
          `3. ${question.options[2]}\n` +
          `4. ${question.options[3]}\n\n` +
          `Responde con 1, 2, 3 o 4.\n` +
          `Usa *${prefix}salirjuego* para cancelar.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },

  onMessage: async ({ sock, msg, from, sender, text, settings }) => {
    const session = getActiveSession(from);
    if (!session || session.game !== "trivia") return false;
    if (session.userId !== sender) return false;
    if (isCommandText(text, settings)) return false;

    const answer = normalizeAnswer(text);
    if (![1, 2, 3, 4].includes(answer)) {
      await sock.sendMessage(
        from,
        {
          text: "Responde con 1, 2, 3 o 4.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    clearActiveSession(from);

    if (answer === Number(session.answer)) {
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "trivia",
        points: 6,
        outcome: "win",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*GANASTE EN TRIVIA*\n\n` +
            `Pregunta: *${session.question}*\n` +
            `Respuesta correcta: *${session.options[session.answer - 1]}*\n` +
            `Puntos: *+6*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    recordGameResult({
      userId: sender,
      chatId: from,
      game: "trivia",
      points: 0,
      outcome: "loss",
    });

    await sock.sendMessage(
      from,
      {
        text:
          `*PERDISTE EN TRIVIA*\n\n` +
          `Pregunta: *${session.question}*\n` +
          `Respuesta correcta: *${session.options[session.answer - 1]}*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
    return true;
  },
};
