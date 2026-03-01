export default {
  command: ["demote", "degradar"],
  category: "grupo",
  description: "Quita admin (respondiendo o mencionando)",
  groupOnly: true,
  adminOnly: true,

  run: async ({ sock, msg, from }) => {
    const mentioned =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    const quotedParticipant =
      msg.message?.extendedTextMessage?.contextInfo?.participant || null;

    const target = mentioned[0] || quotedParticipant;
    if (!target) {
      return sock.sendMessage(
        from,
        { text: "⚙️ Usa: responde a alguien o menciónalo.\nEj: .demote @usuario", ...global.channelInfo },
        { quoted: msg }
      );
    }

    try {
      await sock.groupParticipantsUpdate(from, [target], "demote");
      return sock.sendMessage(
        from,
        { text: "✅ Admin removido.", mentions: [target], ...global.channelInfo },
        { quoted: msg }
      );
    } catch (e) {
      console.error("demote error:", e);
      return sock.sendMessage(from, { text: "❌ No pude degradar.", ...global.channelInfo }, { quoted: msg });
    }
  }
};
