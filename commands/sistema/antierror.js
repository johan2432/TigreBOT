import { getPrefix } from "./_shared.js";

function modeLabel(mode = "off") {
  const normalized = String(mode || "off").trim().toLowerCase();
  if (normalized === "owner") return "VISIBLE + OWNER";
  if (normalized === "user") return "VISIBLE";
  return "OFF";
}

function normalizeAction(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || ["status", "estado", "info"].includes(raw)) return "status";
  if (["on", "visible", "user"].includes(raw)) return "user";
  if (["owner", "debug", "full"].includes(raw)) return "owner";
  if (["off", "disable", "apagar"].includes(raw)) return "off";
  return "";
}

export default {
  name: "antierror",
  command: ["antierror", "errorvisible", "erroresvisibles"],
  category: "sistema",
  description: "Controla si los errores inesperados se muestran en chat.",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [], settings }) => {
    const runtime = global.botRuntime;
    const prefix = getPrefix(settings);

    if (!runtime?.getErrorVisibilityState || !runtime?.setErrorVisibilityMode) {
      return sock.sendMessage(
        from,
        {
          text: "No pude acceder al sistema anti-error.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const action = normalizeAction(args[0]);
    if (!action) {
      return sock.sendMessage(
        from,
        {
          text:
            `Uso:\n` +
            `${prefix}antierror status\n` +
            `${prefix}antierror on\n` +
            `${prefix}antierror owner\n` +
            `${prefix}antierror off`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "status") {
      const state = runtime.getErrorVisibilityState();
      return sock.sendMessage(
        from,
        {
          text:
            `*ANTI-ERROR VISIBLE*\n\n` +
            `Estado: *${modeLabel(state.mode)}*\n` +
            `Modo interno: *${state.mode}*\n\n` +
            `• ${prefix}antierror on\n` +
            `• ${prefix}antierror owner\n` +
            `• ${prefix}antierror off`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const next = runtime.setErrorVisibilityMode(action);
    return sock.sendMessage(
      from,
      {
        text:
          `✅ Anti-error actualizado.\n` +
          `Estado: *${modeLabel(next.mode)}*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
