import path from "path";
import { createScheduledJsonStore } from "../../lib/json-store.js";
import {
  addCoins,
  addDownloadRequests,
  formatCoins,
  formatUserLabel,
  getEconomyProfile,
  getPrefix,
  spendCoins,
} from "./_shared.js";

const STORE_FILE = path.join(process.cwd(), "database", "economia-premium.json");
const store = createScheduledJsonStore(STORE_FILE, () => ({
  trackedSince: new Date().toISOString(),
  users: {},
}));

const ACTIVITY_STEP_COMMANDS = 20;

const WEEKLY_MISSIONS = Object.freeze([
  {
    id: "m1",
    title: "Actividad semanal",
    description: "Ejecuta 40 comandos esta semana.",
    metric: "commands",
    target: 40,
    rewardCoins: 300,
    rewardXp: 140,
  },
  {
    id: "m2",
    title: "Ganancias semanales",
    description: "Acumula 2,000 dolares ganados esta semana.",
    metric: "earned",
    target: 2000,
    rewardCoins: 450,
    rewardXp: 190,
  },
  {
    id: "m3",
    title: "Descargas activas",
    description: "Consume 8 solicitudes de descarga esta semana.",
    metric: "requests",
    target: 8,
    rewardCoins: 280,
    rewardXp: 120,
  },
]);

const ACHIEVEMENTS = Object.freeze([
  {
    id: "ach_cmd_500",
    title: "Comandante 500",
    description: "Llega a 500 comandos ejecutados.",
    metric: "commands",
    target: 500,
    rewardCoins: 900,
    rewardXp: 280,
  },
  {
    id: "ach_earn_15000",
    title: "Magnate",
    description: "Llega a 15,000 dolares ganados totales.",
    metric: "earned",
    target: 15000,
    rewardCoins: 1200,
    rewardXp: 340,
  },
  {
    id: "ach_req_100",
    title: "Descargador Elite",
    description: "Usa 100 solicitudes de descarga.",
    metric: "requests",
    target: 100,
    rewardCoins: 800,
    rewardXp: 220,
  },
  {
    id: "ach_bank_5000",
    title: "Banco Fuerte",
    description: "Alcanza 5,000 dolares en banco.",
    metric: "bank",
    target: 5000,
    rewardCoins: 1000,
    rewardXp: 300,
  },
]);

const PREMIUM_SHOP = Object.freeze([
  {
    id: "xp_boost_250",
    name: "Boost XP 250",
    description: "Sube tu progreso premium rapidamente.",
    levelRequired: 1,
    price: 500,
    grant: { xp: 250 },
  },
  {
    id: "req_premium_10",
    name: "Pack premium 10 requests",
    description: "Recibe 10 solicitudes extra de descarga.",
    levelRequired: 2,
    price: 700,
    grant: { requests: 10 },
  },
  {
    id: "skin_neon",
    name: "Skin Neon",
    description: "Item cosmetico premium para inventario.",
    levelRequired: 3,
    price: 1400,
    grant: { item: "skin_neon" },
  },
  {
    id: "tag_diamante",
    name: "Tag Diamante",
    description: "Tag premium de alto nivel.",
    levelRequired: 5,
    price: 2600,
    grant: { item: "tag_diamante" },
  },
  {
    id: "caja_elite",
    name: "Caja Elite",
    description: "Caja de coleccion nivel alto.",
    levelRequired: 7,
    price: 3900,
    grant: { item: "caja_elite" },
  },
]);

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function weekStartKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function xpRequiredForLevel(level = 1) {
  const safe = Math.max(1, Math.floor(Number(level || 1)));
  return 220 + (safe - 1) * 90;
}

function metricValue(profile, metric) {
  const safeProfile = profile || {};
  if (metric === "commands") return Number(safeProfile.commandCount || 0);
  if (metric === "earned") return Number(safeProfile.totalEarned || 0);
  if (metric === "requests") return Number(safeProfile?.requests?.totalConsumed || 0);
  if (metric === "bank") return Number(safeProfile.bank || 0);
  return 0;
}

function getOrCreateUserState(userId, economyProfile) {
  const users = store.state.users || (store.state.users = {});
  const key = normalizeText(userId);
  const nowWeek = weekStartKey();
  const profile = economyProfile || {};

  if (!users[key]) {
    users[key] = {
      id: key,
      level: 1,
      xpInLevel: 0,
      totalXpEarned: 0,
      inventory: {},
      achievementsClaimed: {},
      weekly: {
        key: nowWeek,
        baselineCommands: metricValue(profile, "commands"),
        baselineEarned: metricValue(profile, "earned"),
        baselineRequests: metricValue(profile, "requests"),
        claimedMissions: {},
      },
      activity: {
        step: ACTIVITY_STEP_COMMANDS,
        nextCommandMilestone: metricValue(profile, "commands") + ACTIVITY_STEP_COMMANDS,
        lastClaimAt: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const user = users[key];
  user.level = Math.max(1, Number.parseInt(String(user.level || 1), 10) || 1);
  user.xpInLevel = Math.max(0, Number.parseInt(String(user.xpInLevel || 0), 10) || 0);
  user.totalXpEarned = Math.max(0, Number.parseInt(String(user.totalXpEarned || 0), 10) || 0);
  if (!user.inventory || typeof user.inventory !== "object" || Array.isArray(user.inventory)) {
    user.inventory = {};
  }
  if (
    !user.achievementsClaimed ||
    typeof user.achievementsClaimed !== "object" ||
    Array.isArray(user.achievementsClaimed)
  ) {
    user.achievementsClaimed = {};
  }
  if (!user.weekly || typeof user.weekly !== "object" || Array.isArray(user.weekly)) {
    user.weekly = {
      key: nowWeek,
      baselineCommands: metricValue(profile, "commands"),
      baselineEarned: metricValue(profile, "earned"),
      baselineRequests: metricValue(profile, "requests"),
      claimedMissions: {},
    };
  }
  if (
    !user.weekly.claimedMissions ||
    typeof user.weekly.claimedMissions !== "object" ||
    Array.isArray(user.weekly.claimedMissions)
  ) {
    user.weekly.claimedMissions = {};
  }
  if (!user.activity || typeof user.activity !== "object" || Array.isArray(user.activity)) {
    user.activity = {};
  }
  user.activity.step = ACTIVITY_STEP_COMMANDS;
  const currentCommands = metricValue(profile, "commands");
  if (!Number.isFinite(Number(user.activity.nextCommandMilestone)) || Number(user.activity.nextCommandMilestone) <= 0) {
    user.activity.nextCommandMilestone = currentCommands + ACTIVITY_STEP_COMMANDS;
  }
  user.activity.lastClaimAt = Number(user.activity.lastClaimAt || 0);

  if (normalizeText(user.weekly.key) !== nowWeek) {
    user.weekly.key = nowWeek;
    user.weekly.baselineCommands = currentCommands;
    user.weekly.baselineEarned = metricValue(profile, "earned");
    user.weekly.baselineRequests = metricValue(profile, "requests");
    user.weekly.claimedMissions = {};
  }

  user.updatedAt = new Date().toISOString();
  return user;
}

function weeklyMetricProgress(user, profile, metric) {
  if (!user?.weekly) return 0;

  if (metric === "commands") {
    return Math.max(0, metricValue(profile, "commands") - Number(user.weekly.baselineCommands || 0));
  }
  if (metric === "earned") {
    return Math.max(0, metricValue(profile, "earned") - Number(user.weekly.baselineEarned || 0));
  }
  if (metric === "requests") {
    return Math.max(0, metricValue(profile, "requests") - Number(user.weekly.baselineRequests || 0));
  }

  return 0;
}

function grantXp(user, amount = 0) {
  const normalized = Math.max(0, Math.floor(Number(amount || 0)));
  if (!normalized) return { amount: 0, levelUps: 0, level: user.level };

  let remaining = normalized;
  let levelUps = 0;
  user.totalXpEarned += normalized;

  while (remaining > 0) {
    const required = xpRequiredForLevel(user.level);
    const missing = Math.max(1, required - user.xpInLevel);
    if (remaining >= missing) {
      user.xpInLevel = 0;
      user.level += 1;
      levelUps += 1;
      remaining -= missing;
      continue;
    }

    user.xpInLevel += remaining;
    remaining = 0;
  }

  return {
    amount: normalized,
    levelUps,
    level: user.level,
  };
}

function buildWeeklyMissionRows(user, profile) {
  return WEEKLY_MISSIONS.map((mission) => {
    const progress = weeklyMetricProgress(user, profile, mission.metric);
    const done = progress >= mission.target;
    const claimed = user.weekly.claimedMissions?.[mission.id] === true;
    return {
      ...mission,
      progress,
      done,
      claimed,
    };
  });
}

function buildAchievementRows(user, profile) {
  return ACHIEVEMENTS.map((achievement) => {
    const progress = metricValue(profile, achievement.metric);
    const done = progress >= achievement.target;
    const claimed = user.achievementsClaimed?.[achievement.id] === true;
    return {
      ...achievement,
      progress,
      done,
      claimed,
    };
  });
}

function formatMissionRow(row) {
  const status = row.claimed ? "COBRADA ✅" : row.done ? "LISTA 🟢" : "PENDIENTE 🟡";
  return (
    `*${row.id.toUpperCase()}* - ${status}\n` +
    `${row.title}\n` +
    `${row.description}\n` +
    `Progreso: *${row.progress}/${row.target}*\n` +
    `Premio: *${formatCoins(row.rewardCoins)}* + *${row.rewardXp} XP*`
  );
}

function formatAchievementRow(row) {
  const status = row.claimed ? "COBRADO ✅" : row.done ? "LISTO 🟢" : "BLOQUEADO ⚪";
  return (
    `*${row.id}* - ${status}\n` +
    `${row.title}\n` +
    `${row.description}\n` +
    `Progreso: *${row.progress}/${row.target}*\n` +
    `Premio: *${formatCoins(row.rewardCoins)}* + *${row.rewardXp} XP*`
  );
}

function formatShopRow(item) {
  return (
    `*${item.id}* (Nivel ${item.levelRequired}+)\n` +
    `${item.name}\n` +
    `${item.description}\n` +
    `Precio: *${formatCoins(item.price)}*`
  );
}

function profileSummary(user, profile) {
  const commands = metricValue(profile, "commands");
  const earned = metricValue(profile, "earned");
  const requests = metricValue(profile, "requests");
  const bank = metricValue(profile, "bank");
  const nextXp = xpRequiredForLevel(user.level);
  const progressPercent = Math.max(0, Math.min(100, Math.floor((Number(user.xpInLevel || 0) / nextXp) * 100)));
  const inventoryList = Object.entries(user.inventory || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([itemId, count]) => `- ${itemId}: ${count}`);

  return (
    `*ECONOMIA PREMIUM*\n\n` +
    `Usuario: *${formatUserLabel(profile?.id || "")}*\n` +
    `Nivel premium: *${user.level}*\n` +
    `XP: *${user.xpInLevel}/${nextXp}* (${progressPercent}%)\n` +
    `XP total: *${user.totalXpEarned}*\n` +
    `Comandos usados: *${commands}*\n` +
    `Ganado total: *${formatCoins(earned)}*\n` +
    `Solicitudes usadas: *${requests}*\n` +
    `Banco actual: *${formatCoins(bank)}*\n` +
    `Hito actividad: *${user.activity.nextCommandMilestone} comandos*\n\n` +
    `Inventario premium:\n${inventoryList.length ? inventoryList.join("\n") : "- Vacio"}`
  );
}

function resolveMissionById(id = "") {
  const key = normalizeText(id).toLowerCase();
  return WEEKLY_MISSIONS.find((mission) => mission.id === key) || null;
}

function resolveAchievementById(id = "") {
  const key = normalizeText(id).toLowerCase();
  return ACHIEVEMENTS.find((achievement) => achievement.id === key) || null;
}

function resolveShopItem(itemId = "") {
  const key = normalizeText(itemId).toLowerCase();
  return PREMIUM_SHOP.find((item) => item.id === key) || null;
}

function claimWeeklyMission({ sender, settings, user, profile, missionId }) {
  const mission = resolveMissionById(missionId);
  if (!mission) {
    return { ok: false, message: "No encontre esa mision semanal." };
  }

  if (user.weekly.claimedMissions?.[mission.id]) {
    return { ok: false, message: "Esa mision ya fue cobrada esta semana." };
  }

  const progress = weeklyMetricProgress(user, profile, mission.metric);
  if (progress < mission.target) {
    return {
      ok: false,
      message: `Aun no completas la mision.\nProgreso: *${progress}/${mission.target}*`,
    };
  }

  user.weekly.claimedMissions[mission.id] = true;
  const xp = grantXp(user, mission.rewardXp);
  addCoins(sender, mission.rewardCoins, "premium_weekly_mission", {
    missionId: mission.id,
    week: user.weekly.key,
  });
  store.scheduleSave();

  return {
    ok: true,
    mission,
    xp,
  };
}

function claimAchievement({ sender, user, profile, achievementId }) {
  const achievement = resolveAchievementById(achievementId);
  if (!achievement) {
    return { ok: false, message: "No encontre ese logro." };
  }

  if (user.achievementsClaimed?.[achievement.id]) {
    return { ok: false, message: "Ese logro ya fue cobrado." };
  }

  const progress = metricValue(profile, achievement.metric);
  if (progress < achievement.target) {
    return {
      ok: false,
      message: `Ese logro aun no esta listo.\nProgreso: *${progress}/${achievement.target}*`,
    };
  }

  user.achievementsClaimed[achievement.id] = true;
  const xp = grantXp(user, achievement.rewardXp);
  addCoins(sender, achievement.rewardCoins, "premium_achievement", {
    achievementId: achievement.id,
  });
  store.scheduleSave();

  return {
    ok: true,
    achievement,
    xp,
  };
}

function claimActivityReward({ sender, user, profile }) {
  const commands = metricValue(profile, "commands");
  const nextMilestone = Number(user.activity.nextCommandMilestone || ACTIVITY_STEP_COMMANDS);

  if (commands < nextMilestone) {
    return {
      ok: false,
      message:
        `Aun no puedes cobrar actividad.\n` +
        `Te faltan *${nextMilestone - commands}* comandos para el siguiente premio.`,
    };
  }

  const rewardCoins = 160 + user.level * 22;
  const rewardXp = 95 + Math.floor(user.level * 6);
  const xp = grantXp(user, rewardXp);
  addCoins(sender, rewardCoins, "premium_activity_reward", {
    milestone: nextMilestone,
  });

  user.activity.lastClaimAt = Date.now();
  user.activity.nextCommandMilestone = nextMilestone + ACTIVITY_STEP_COMMANDS;
  store.scheduleSave();

  return {
    ok: true,
    rewardCoins,
    rewardXp,
    xp,
    nextMilestone: user.activity.nextCommandMilestone,
  };
}

function buyPremiumItem({ sender, settings, user, itemId }) {
  const item = resolveShopItem(itemId);
  if (!item) {
    return { ok: false, message: "No existe ese item premium." };
  }

  if (user.level < item.levelRequired) {
    return {
      ok: false,
      message: `Necesitas nivel premium *${item.levelRequired}* para comprar *${item.id}*.`,
    };
  }

  const spend = spendCoins(sender, item.price, "premium_shop_buy", { itemId: item.id });
  if (!spend.ok) {
    return {
      ok: false,
      message: `Saldo insuficiente. Te faltan *${formatCoins(spend.missing || 0)}*.`,
    };
  }

  const grants = [];

  if (Number(item.grant?.xp || 0) > 0) {
    const xpInfo = grantXp(user, Number(item.grant.xp || 0));
    grants.push(`XP +${xpInfo.amount}`);
  }

  if (Number(item.grant?.requests || 0) > 0) {
    const amount = Math.max(1, Math.floor(Number(item.grant.requests || 0)));
    addDownloadRequests(
      sender,
      amount,
      "premium_shop_request_pack",
      { itemId: item.id, countAsPurchased: false },
      settings
    );
    grants.push(`Solicitudes +${amount}`);
  }

  if (normalizeText(item.grant?.item)) {
    const itemKey = normalizeText(item.grant.item).toLowerCase();
    user.inventory[itemKey] = Number(user.inventory[itemKey] || 0) + 1;
    grants.push(`Item ${itemKey} x1`);
  }

  store.scheduleSave();

  return {
    ok: true,
    item,
    grants,
  };
}

async function sendPremiumPanel({ sock, from, msg, settings, profile, user }) {
  const prefix = getPrefix(settings);
  const missionRows = buildWeeklyMissionRows(user, profile);
  const readyMissions = missionRows.filter((row) => row.done && !row.claimed).length;
  const achievementRows = buildAchievementRows(user, profile);
  const readyAchievements = achievementRows.filter((row) => row.done && !row.claimed).length;
  const commandsNow = metricValue(profile, "commands");
  const activityReady = commandsNow >= Number(user.activity.nextCommandMilestone || ACTIVITY_STEP_COMMANDS);

  return sock.sendMessage(
    from,
    {
      text:
        `${profileSummary(user, profile)}\n\n` +
        `Misiones listas: *${readyMissions}*\n` +
        `Logros listos: *${readyAchievements}*\n` +
        `Actividad: *${activityReady ? "Lista para cobrar ✅" : "Aun en progreso 🟡"}*`,
      title: "FSOCIETY BOT",
      subtitle: "Economia Premium",
      footer: "Misiones, logros, actividad y tienda por niveles",
      interactiveButtons: [
        {
          name: "single_select",
          buttonParamsJson: JSON.stringify({
            title: "Abrir panel premium",
            sections: [
              {
                title: "Progreso",
                rows: [
                  {
                    header: "PERFIL",
                    title: "Ver perfil premium",
                    description: "Resumen de nivel, XP y actividad.",
                    id: `${prefix}premium perfil`,
                  },
                  {
                    header: "MISIONES",
                    title: "Ver misiones semanales",
                    description: "Estado y premios de la semana.",
                    id: `${prefix}premium misiones`,
                  },
                  {
                    header: "LOGROS",
                    title: "Ver logros",
                    description: "Desbloqueos permanentes.",
                    id: `${prefix}premium logros`,
                  },
                  {
                    header: "ACTIVIDAD",
                    title: "Ver progreso de actividad",
                    description: "Premios por uso del bot.",
                    id: `${prefix}premium actividad`,
                  },
                ],
              },
              {
                title: "Reclamar",
                rows: [
                  {
                    header: "MISION",
                    title: "Reclamar M1",
                    description: "Actividad semanal.",
                    id: `${prefix}premium reclamar m1`,
                  },
                  {
                    header: "MISION",
                    title: "Reclamar M2",
                    description: "Ganancias semanales.",
                    id: `${prefix}premium reclamar m2`,
                  },
                  {
                    header: "MISION",
                    title: "Reclamar M3",
                    description: "Descargas semanales.",
                    id: `${prefix}premium reclamar m3`,
                  },
                  {
                    header: "ACTIVIDAD",
                    title: "Reclamar actividad",
                    description: "Premio por comandos acumulados.",
                    id: `${prefix}premium reclamar actividad`,
                  },
                ],
              },
              {
                title: "Tienda por nivel",
                rows: PREMIUM_SHOP.slice(0, 5).map((item) => ({
                  header: `NIVEL ${item.levelRequired}+`,
                  title: `Comprar ${item.id}`,
                  description: `${item.name} · ${formatCoins(item.price)}`,
                  id: `${prefix}premium comprar ${item.id}`,
                })),
              },
            ],
          }),
        },
      ],
      ...global.channelInfo,
    },
    { quoted: msg }
  );
}

export default {
  name: "premium",
  command: [
    "premium",
    "economiapremium",
    "misiones",
    "misionessemanales",
    "logros",
    "logrospremium",
    "actividadpremium",
    "reclamaractividad",
    "tiendapremium",
    "comprarpremium",
    "nivelpremium",
  ],
  category: "economia",
  description: "Misiones semanales, logros, actividad y tienda por niveles.",

  run: async ({ sock, msg, from, sender, args = [], settings = {}, commandName = "" }) => {
    const command = normalizeText(commandName).toLowerCase();
    const profile = getEconomyProfile(sender, settings);
    const user = getOrCreateUserState(sender, profile);
    const prefix = getPrefix(settings);
    store.scheduleSave();

    const aliasActionMap = {
      misiones: "misiones",
      misionessemanales: "misiones",
      logros: "logros",
      logrospremium: "logros",
      actividadpremium: "actividad",
      reclamaractividad: "reclamar_actividad",
      tiendapremium: "tienda",
      comprarpremium: "comprar",
      nivelpremium: "perfil",
      economiapremium: "panel",
      premium: "",
    };

    let action = aliasActionMap[command] || normalizeText(args[0]).toLowerCase();
    let payload = aliasActionMap[command] ? args : args.slice(1);

    if (!action || ["panel", "menu", "help", "inicio"].includes(action)) {
      return sendPremiumPanel({ sock, from, msg, settings, profile, user });
    }

    if (action === "perfil" || action === "estado") {
      return sock.sendMessage(
        from,
        {
          text: profileSummary(user, profile),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "misiones") {
      const rows = buildWeeklyMissionRows(user, profile);
      return sock.sendMessage(
        from,
        {
          text:
            `*MISIONES SEMANALES* (${user.weekly.key})\n\n` +
            `${rows.map((row) => formatMissionRow(row)).join("\n\n")}\n\n` +
            `Reclama con: *${prefix}premium reclamar m1|m2|m3*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "logros") {
      const rows = buildAchievementRows(user, profile);
      return sock.sendMessage(
        from,
        {
          text:
            `*LOGROS PREMIUM*\n\n` +
            `${rows.map((row) => formatAchievementRow(row)).join("\n\n")}\n\n` +
            `Reclama con: *${prefix}premium reclamar ach_id*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "actividad") {
      const commands = metricValue(profile, "commands");
      const nextMilestone = Number(user.activity.nextCommandMilestone || ACTIVITY_STEP_COMMANDS);
      const ready = commands >= nextMilestone;
      return sock.sendMessage(
        from,
        {
          text:
            `*RECOMPENSA POR ACTIVIDAD*\n\n` +
            `Comandos actuales: *${commands}*\n` +
            `Siguiente hito: *${nextMilestone}*\n` +
            `Estado: *${ready ? "LISTO PARA COBRAR ✅" : "EN PROGRESO 🟡"}*\n\n` +
            `Reclama con: *${prefix}premium reclamar actividad*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "tienda" || action === "shop") {
      return sock.sendMessage(
        from,
        {
          text:
            `*TIENDA PREMIUM POR NIVELES*\n\n` +
            `${PREMIUM_SHOP.map((item) => formatShopRow(item)).join("\n\n")}\n\n` +
            `Tu nivel actual: *${user.level}*\n` +
            `Compra con: *${prefix}premium comprar id_item*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "comprar") {
      const itemId = normalizeText(payload[0]);
      if (!itemId) {
        return sock.sendMessage(
          from,
          {
            text: `Usa: *${prefix}premium comprar id_item*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      const result = buyPremiumItem({ sender, settings, user, itemId });
      if (!result.ok) {
        return sock.sendMessage(from, { text: result.message, ...global.channelInfo }, { quoted: msg });
      }

      return sock.sendMessage(
        from,
        {
          text:
            `*COMPRA PREMIUM EXITOSA*\n\n` +
            `Item: *${result.item.name}* (${result.item.id})\n` +
            `Costo: *${formatCoins(result.item.price)}*\n` +
            `Recompensas: ${result.grants.length ? result.grants.join(" | ") : "aplicadas"}\n` +
            `Nivel actual: *${user.level}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "reclamar_actividad") {
      const result = claimActivityReward({ sender, user, profile });
      if (!result.ok) {
        return sock.sendMessage(from, { text: result.message, ...global.channelInfo }, { quoted: msg });
      }

      return sock.sendMessage(
        from,
        {
          text:
            `*ACTIVIDAD COBRADA*\n\n` +
            `Ganaste: *${formatCoins(result.rewardCoins)}* + *${result.rewardXp} XP*\n` +
            `Nivel actual: *${result.xp.level}*\n` +
            `Siguiente hito: *${result.nextMilestone} comandos*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "reclamar") {
      const target = normalizeText(payload[0]).toLowerCase();
      if (!target) {
        return sock.sendMessage(
          from,
          {
            text:
              `Usa:\n` +
              `*${prefix}premium reclamar m1*\n` +
              `*${prefix}premium reclamar m2*\n` +
              `*${prefix}premium reclamar m3*\n` +
              `*${prefix}premium reclamar actividad*\n` +
              `*${prefix}premium reclamar ach_cmd_500*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      if (target === "actividad") {
        const result = claimActivityReward({ sender, user, profile });
        if (!result.ok) {
          return sock.sendMessage(from, { text: result.message, ...global.channelInfo }, { quoted: msg });
        }
        return sock.sendMessage(
          from,
          {
            text:
              `*ACTIVIDAD COBRADA*\n\n` +
              `Ganaste: *${formatCoins(result.rewardCoins)}* + *${result.rewardXp} XP*\n` +
              `Siguiente hito: *${result.nextMilestone} comandos*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      if (target.startsWith("m")) {
        const result = claimWeeklyMission({
          sender,
          settings,
          user,
          profile,
          missionId: target,
        });
        if (!result.ok) {
          return sock.sendMessage(from, { text: result.message, ...global.channelInfo }, { quoted: msg });
        }

        return sock.sendMessage(
          from,
          {
            text:
              `*MISION COBRADA*\n\n` +
              `${result.mission.title}\n` +
              `Ganaste: *${formatCoins(result.mission.rewardCoins)}* + *${result.mission.rewardXp} XP*\n` +
              `Nivel actual: *${result.xp.level}*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      if (target.startsWith("ach_")) {
        const result = claimAchievement({
          sender,
          user,
          profile,
          achievementId: target,
        });
        if (!result.ok) {
          return sock.sendMessage(from, { text: result.message, ...global.channelInfo }, { quoted: msg });
        }

        return sock.sendMessage(
          from,
          {
            text:
              `*LOGRO COBRADO*\n\n` +
              `${result.achievement.title}\n` +
              `Ganaste: *${formatCoins(result.achievement.rewardCoins)}* + *${result.achievement.rewardXp} XP*\n` +
              `Nivel actual: *${result.xp.level}*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      return sock.sendMessage(
        from,
        {
          text: "No reconoci ese objetivo de reclamo.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return sock.sendMessage(
      from,
      {
        text:
          `Accion no valida.\n` +
          `Usa *${prefix}premium* para abrir el panel premium.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
