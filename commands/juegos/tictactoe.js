import {
  buildActiveSessionMessage,
  buildTicTacToeBoard,
  clearActiveSession,
  ensureSessionAvailable,
  getActiveSession,
  getPrefix,
  getTicTacToeWinner,
  isCommandText,
  pickBestTicTacToeMove,
  recordGameResult,
  setActiveSession,
  updateActiveSession,
} from "./_shared.js";

function renderBoard(board) {
  return `\`\`\`\n${buildTicTacToeBoard(board)}\n\`\`\``;
}

function parseMove(value = "") {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return parsed >= 1 && parsed <= 9 ? parsed - 1 : -1;
}

export default {
  name: "tictactoe",
  command: ["tictactoe", "gato", "ttt"],
  category: "juegos",
  description: "Juega tres en raya contra el bot",

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

    const board = Array(9).fill("");
    setActiveSession(from, {
      game: "tictactoe",
      userId: sender,
      board,
      playerSymbol: "X",
      botSymbol: "O",
    });

    return sock.sendMessage(
      from,
      {
        text:
          `*TIC TAC TOE*\n\n` +
          `${renderBoard(board)}\n` +
          `Tu simbolo: *X*\n` +
          `Bot: *O*\n` +
          `Responde con un numero del 1 al 9 para marcar.\n` +
          `Usa *${prefix}salirjuego* si quieres cancelar.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },

  onMessage: async ({ sock, msg, from, sender, text, settings }) => {
    const session = getActiveSession(from);
    if (!session || session.game !== "tictactoe") return false;
    if (session.userId !== sender) return false;
    if (isCommandText(text, settings)) return false;

    const move = parseMove(text);
    if (move < 0) {
      await sock.sendMessage(
        from,
        {
          text: "Responde con un numero del 1 al 9.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    const board = Array.isArray(session.board) ? [...session.board] : Array(9).fill("");
    if (board[move]) {
      await sock.sendMessage(
        from,
        {
          text:
            `Ese espacio ya esta ocupado.\n\n` +
            `${renderBoard(board)}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    board[move] = "X";
    let winner = getTicTacToeWinner(board);

    if (winner === "X") {
      clearActiveSession(from);
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "tictactoe",
        points: 8,
        outcome: "win",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*GANASTE EN TIC TAC TOE*\n\n` +
            `${renderBoard(board)}\n` +
            `Puntos: *+8*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    if (winner === "draw") {
      clearActiveSession(from);
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "tictactoe",
        points: 2,
        outcome: "draw",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*EMPATE EN TIC TAC TOE*\n\n` +
            `${renderBoard(board)}\n` +
            `Puntos: *+2*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    const botMove = pickBestTicTacToeMove(board);
    if (botMove >= 0) {
      board[botMove] = "O";
    }

    winner = getTicTacToeWinner(board);
    if (winner === "O") {
      clearActiveSession(from);
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "tictactoe",
        points: 0,
        outcome: "loss",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*PERDISTE EN TIC TAC TOE*\n\n` +
            `${renderBoard(board)}\n` +
            `El bot gano esta ronda.`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    if (winner === "draw") {
      clearActiveSession(from);
      recordGameResult({
        userId: sender,
        chatId: from,
        game: "tictactoe",
        points: 2,
        outcome: "draw",
      });

      await sock.sendMessage(
        from,
        {
          text:
            `*EMPATE EN TIC TAC TOE*\n\n` +
            `${renderBoard(board)}\n` +
            `Puntos: *+2*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
      return true;
    }

    updateActiveSession(from, { board });
    await sock.sendMessage(
      from,
      {
        text:
          `*TIC TAC TOE*\n\n` +
          `${renderBoard(board)}\n` +
          `El bot ya jugo. Tu turno.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
    return true;
  },
};
