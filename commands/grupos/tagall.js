import {
  getParticipantDisplayTag,
  getParticipantMentionJid,
} from "../../lib/group-compat.js";

export default {
  command: ["tagall", "invocar", "invocartodos", "llamartodos", "mencionartodos"],
  category: "grupo",
  description: "Invoca y etiqueta a todos los miembros del grupo",
  groupOnly: true,
  adminOnly: true,

  run: async ({ sock, msg, from, args }) => {
    const meta = await sock.groupMetadata(from);
    const participants = Array.isArray(meta?.participants) ? meta.participants : [];
    const members = participants
      .map((participant) => getParticipantMentionJid(meta, participant, participant?.id))
      .filter(Boolean);

    const texto = args.length
      ? args.join(" ")
      : "📣 *Invocacion general del grupo*";

    const lines = participants
      .map((participant) => `• ${getParticipantDisplayTag(participant, participant?.id)}`)
      .join("\n");

    return sock.sendMessage(
      from,
      {
        text: `${texto}\n\n${lines}`,
        mentions: members,
        ...global.channelInfo
      },
      { quoted: msg }
    );
  }
};
