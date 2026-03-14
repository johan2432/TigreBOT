function normalizarJid(x) {
  const jid = String(x || "").trim();
  if (!jid) return "";
  const [user] = jid.split("@");
  return user.split(":")[0];
}

function normalizarNumero(x) {
  return normalizarJid(x).replace(/[^\d]/g, "").trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export default {
  name: "whoami",
  command: ["whoami"],
  category: "admin",

  run: async ({ sock, msg, from, settings }) => {
    const senderJid =
      msg?.key?.participant || msg?.participant || msg?.key?.remoteJid || from;
    const senderIds = unique([normalizarJid(senderJid), normalizarNumero(senderJid)]);
    const ownerNumbers = Array.isArray(settings?.ownerNumbers) ? settings.ownerNumbers : [];
    const ownerLids = Array.isArray(settings?.ownerLids) ? settings.ownerLids : [];
    const ownersNorm = unique([
      ...ownerNumbers.map(normalizarNumero),
      ...ownerLids.map(normalizarJid),
      ...ownerLids.map(normalizarNumero),
    ]);
    const isOwner = senderIds.some((value) => ownersNorm.includes(value));

    await sock.sendMessage(
      from,
      {
        text:
          `*WHOAMI*\n\n` +
          `senderJid: ${String(senderJid)}\n` +
          `senderIds: ${JSON.stringify(senderIds)}\n\n` +
          `ownerNumbers: ${JSON.stringify(ownerNumbers)}\n` +
          `ownerLids: ${JSON.stringify(ownerLids)}\n` +
          `ownersNorm: ${JSON.stringify(ownersNorm)}\n\n` +
          `esOwner: ${isOwner}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
