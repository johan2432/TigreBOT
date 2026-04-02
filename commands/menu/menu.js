import fs from "fs";
import path from "path";

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function getPrimaryPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function getPrefixLabel(settings) {
  if (Array.isArray(settings?.prefix)) {
    const values = settings.prefix
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return values.length ? values.join(" | ") : ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function normalizeCategoryLabel(value = "") {
  return String(value || "")
    .replace(/_/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeCategoryKey(value = "") {
  const key = String(value || "").trim().toLowerCase();
  const aliases = {
    descarga: "descargas",
    grupo: "grupos",
  };
  return aliases[key] || key;
}

function getCategorySortIndex(category = "") {
  const order = [
    "menu",
    "descargas",
    "busqueda",
    "freefire",
    "juegos",
    "herramientas",
    "grupos",
    "subbots",
    "economia",
    "sistema",
    "ia",
    "media",
    "anime",
    "admin",
    "vip",
  ];
  const index = order.indexOf(normalizeCategoryKey(category));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function getCategoryIcon(category = "") {
  const key = normalizeCategoryKey(category);
  const icons = {
    admin: "👑",
    ai: "🧠",
    ia: "🧠",
    anime: "🌸",
    busqueda: "🔎",
    descargas: "📥",
    economia: "💰",
    freefire: "🔥",
    grupos: "🛡️",
    herramientas: "🧰",
    juegos: "🎮",
    media: "🖼️",
    menu: "📜",
    sistema: "⚙️",
    subbots: "🤖",
    vip: "💎",
  };

  return icons[key] || "✦";
}

function getSubbotSlot(botId = "") {
  const match = String(botId || "")
    .trim()
    .toLowerCase()
    .match(/^subbot(\d{1,2})$/);

  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

function getMenuContext({ settings, botId = "", botLabel = "" }) {
  const normalizedBotId = String(botId || "").trim().toLowerCase();

  if (!normalizedBotId || normalizedBotId === "main") {
    return {
      title: "FSOCIETY BOT PRINCIPAL",
      botLine: settings?.botName || "Fsociety bot",
    };
  }

  const slot = getSubbotSlot(normalizedBotId);
  const subbotName =
    (slot >= 1 && Array.isArray(settings?.subbots) && settings.subbots[slot - 1]?.name) ||
    String(botLabel || "").trim() ||
    `Fsociety Subbot ${slot || 1}`;

  return {
    title: `MENU SUBBOT FSOCIETY ${slot || 1}`,
    botLine: subbotName,
  };
}

function buildTopPanel({
  settings,
  uptime,
  totalCategories,
  totalCommands,
  prefixLabel,
  menuTitle,
  botLine,
}) {
  return [
    `╭━━━〔 ${menuTitle} 〕━━━⬣`,
    `┃ ✦ Bot activo: *${botLine || settings.botName || "BOT"}*`,
    `┃ ✦ Owner: *${settings.ownerName || "Owner"}*`,
    `┃ ✦ Prefijos: *${prefixLabel}*`,
    `┃ ✦ Uptime: *${uptime}*`,
    `┃ ✦ Categorias: *${totalCategories}*`,
    `┃ ✦ Comandos: *${totalCommands}*`,
    "╰━━━━━━━━━━━━━━━━━━━━━━⬣",
  ].join("\n");
}

function buildCategoryBlock(category, commands, primaryPrefix) {
  const icon = getCategoryIcon(category);
  const title = normalizeCategoryLabel(normalizeCategoryKey(category));
  const lines = [
    `╭─〔 ${icon} ${title} 〕`,
    ...commands.map((name) => `│ • \`${primaryPrefix}${name}\``),
    "╰────────────⬣",
  ];

  return lines.join("\n");
}

function buildFooter(primaryPrefix) {
  return [
    "╭─〔 NOTAS 〕",
    `│ • Usa \`${primaryPrefix}herramientas\` para utilidades ordenadas`,
    `│ • Usa \`${primaryPrefix}status\` para ver el estado del bot`,
    `│ • Usa \`${primaryPrefix}owner\` si necesitas soporte directo`,
    "╰────────────⬣",
  ].join("\n");
}

function resolveMenuImagePath() {
  const base = path.join(process.cwd(), "imagenes", "menu");
  const candidates = [`${base}.png`, `${base}.jpg`, `${base}.jpeg`, `${base}.webp`];
  return candidates.find((filePath) => fs.existsSync(filePath)) || "";
}

export default {
  command: ["menu"],
  category: "menu",
  description: "Menu principal con imagen",

  run: async ({ sock, msg, from, settings, comandos, botId, botLabel }) => {
    try {
      if (!comandos) {
        return sock.sendMessage(
          from,
          { text: "Error interno del menu.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const imagePath = resolveMenuImagePath();
      if (!imagePath) {
        return sock.sendMessage(
          from,
          { text: "Imagen del menu no encontrada en imagenes/menu.png.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const uptime = formatUptime(process.uptime());
      const primaryPrefix = getPrimaryPrefix(settings);
      const prefixLabel = getPrefixLabel(settings);
      const menuContext = getMenuContext({ settings, botId, botLabel });
      const categorias = {};

      for (const cmd of new Set(comandos.values())) {
        if (!cmd?.category || !cmd?.command) continue;

        const category = normalizeCategoryKey(cmd.category);
        const principal = cmd.name || (Array.isArray(cmd.command) ? cmd.command[0] : cmd.command);
        if (!principal) continue;

        if (!categorias[category]) categorias[category] = new Set();
        categorias[category].add(String(principal).toLowerCase());
      }

      const categoryNames = Object.keys(categorias).sort((a, b) => {
        const byOrder = getCategorySortIndex(a) - getCategorySortIndex(b);
        if (byOrder !== 0) return byOrder;
        return String(a).localeCompare(String(b));
      });
      const totalCommands = categoryNames.reduce(
        (sum, category) => sum + Array.from(categorias[category]).length,
        0
      );

      const parts = [
        buildTopPanel({
          settings,
          uptime,
          totalCategories: categoryNames.length,
          totalCommands,
          prefixLabel,
          menuTitle: menuContext.title,
          botLine: menuContext.botLine,
        }),
        ...categoryNames.map((category) =>
          buildCategoryBlock(category, Array.from(categorias[category]).sort(), primaryPrefix)
        ),
        buildFooter(primaryPrefix),
      ];

      await sock.sendMessage(
        from,
        {
          image: fs.readFileSync(imagePath),
          caption: parts.join("\n\n").trim(),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    } catch (error) {
      console.error("MENU ERROR:", error);
      await sock.sendMessage(
        from,
        { text: "Error al mostrar el menu.", ...global.channelInfo },
        { quoted: msg }
      );
    }
  },
};
