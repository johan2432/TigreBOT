import { getPrimaryPrefix } from "../../lib/json-store.js";

function normalizeAliases(command = {}) {
  const names = [];

  if (command?.name) {
    names.push(command.name);
  }

  if (Array.isArray(command?.command)) {
    names.push(...command.command);
  } else if (command?.command) {
    names.push(command.command);
  }

  return Array.from(
    new Set(
      names
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function pickMainAlias(command = {}) {
  const aliases = normalizeAliases(command);
  return aliases[0] || "";
}

function findCommand(comandos, name = "") {
  if (!(comandos instanceof Map)) return null;
  const query = String(name || "").trim().toLowerCase();
  if (!query) return null;

  const direct = comandos.get(query);
  if (direct) return direct;

  for (const cmd of new Set(comandos.values())) {
    const aliases = normalizeAliases(cmd);
    if (aliases.includes(query)) {
      return cmd;
    }
  }

  for (const cmd of new Set(comandos.values())) {
    const aliases = normalizeAliases(cmd);
    if (aliases.some((alias) => alias.startsWith(query))) {
      return cmd;
    }
  }

  return null;
}

export default {
  name: "explicar",
  command: ["explicar", "explicarcomando", "helpcmd", "cmdinfo"],
  category: "sistema",
  description: "Explica como usar un comando sin necesidad de IA",

  run: async ({ sock, from, msg, args = [], settings, comandos }) => {
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const prefix = getPrimaryPrefix(settings);
    const input = String(args[0] || "").trim().toLowerCase();

    if (!input) {
      return sock.sendMessage(
        from,
        {
          text:
            `Uso:\n` +
            `• ${prefix}explicar <comando>\n\n` +
            `Ejemplos:\n` +
            `• ${prefix}explicar ytmp3\n` +
            `• ${prefix}explicar tiktoksearch`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    const cmd = findCommand(comandos, input);
    if (!cmd) {
      return sock.sendMessage(
        from,
        {
          text: `No encontre el comando *${input}*.`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    const aliases = normalizeAliases(cmd);
    const mainAlias = pickMainAlias(cmd);
    const rules = [
      cmd?.groupOnly ? "Solo grupos" : "Privado/Grupo",
      cmd?.adminOnly ? "Solo admins" : "Sin restriccion admin",
      cmd?.ownerOnly ? "Solo owner" : "Sin restriccion owner",
    ];

    return sock.sendMessage(
      from,
      {
        text:
          `📘 *EXPLICACION DEL COMANDO*\n` +
          `Comando: *${prefix}${mainAlias || input}*\n` +
          `Alias: ${aliases.length ? aliases.map((alias) => `${prefix}${alias}`).join(", ") : "N/D"}\n` +
          `Categoria: *${String(cmd?.category || "general").toUpperCase()}*\n` +
          `Descripcion: ${cmd?.description || cmd?.desc || "Sin descripcion."}\n` +
          `Reglas: ${rules.join(" | ")}\n\n` +
          `Tip: prueba con \`${prefix}${mainAlias || input}\``,
        ...global.channelInfo,
      },
      quoted
    );
  },
};
