const path = require("path");
const fs = require("fs");

const settings = require("./settings/settings.json");

function clampSlots(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 15;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

const maxSlots = clampSlots(settings?.subbot?.maxSlots || settings?.subbots?.length || 15);
const cwd = __dirname;

const baseApp = {
  cwd,
  script: path.join(cwd, "index.js"),
  interpreter: "node",
  autorestart: true,
  watch: false,
  max_memory_restart: "700M",
  env: {
    NODE_ENV: process.env.NODE_ENV || "production",
  },
};

const apps = [
  {
    ...baseApp,
    name: "dvyer-main",
    env: {
      ...baseApp.env,
      BOT_INSTANCE: "main",
    },
  },
];

function hasPersistedSession(authFolder) {
  if (!authFolder) return false;

  const credsPath = path.join(cwd, authFolder, "creds.json");
  if (!fs.existsSync(credsPath)) return false;

  try {
    const parsed = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    return Boolean(parsed?.registered || parsed?.me?.id);
  } catch {
    return false;
  }
}

function shouldRunSubbot(slotConfig = {}) {
  return Boolean(
    slotConfig?.enabled &&
      (
        slotConfig?.pairingNumber ||
        slotConfig?.requesterNumber ||
        slotConfig?.requesterJid ||
        slotConfig?.requestedAt ||
        hasPersistedSession(slotConfig?.authFolder)
      )
  );
}

for (let slot = 1; slot <= maxSlots; slot += 1) {
  const slotConfig = Array.isArray(settings?.subbots)
    ? settings.subbots.find((item) => Number(item?.slot || 0) === slot)
    : null;

  if (!shouldRunSubbot(slotConfig)) {
    continue;
  }

  apps.push({
    ...baseApp,
    name: `dvyer-subbot-${slot}`,
    env: {
      ...baseApp.env,
      BOT_INSTANCE: `subbot${slot}`,
    },
  });
}

module.exports = {
  apps,
};
