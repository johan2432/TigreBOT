import { checkVipAndConsume } from "../../settings/vip-guard.js";

export default {
  name: "viptest",
  command: ["viptest"],
  category: "vip",
  description: "Comando VIP con vencimiento y límite",

  run: async ({ sock, msg, from, settings }) => {
    const res = checkVipAndConsume({ msg, from, settings });

    if (!res.ok) {
      const t =
        res.reason === "expired"
          ? "⏳ Tu VIP ya venció."
          : res.reason === "limit"
          ? "🎟️ Ya no tienes usos VIP."
          : "🔒 Este comando es VIP. Pídele permiso al owner.";
      return sock.sendMessage(from, { text: t }, { quoted: msg });
    }

    const left = res.owner ? "∞" : (typeof res.usesLeft === "number" ? res.usesLeft : "∞");
    return sock.sendMessage(
      from,
      { text: `✅ VIP OK 😎\nUsos restantes: *${left}*` },
      { quoted: msg }
    );
  },
};
