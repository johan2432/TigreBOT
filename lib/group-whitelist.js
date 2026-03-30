import path from "path";
import { createScheduledJsonStore, normalizeJidUser, normalizeNumber } from "./json-store.js";

const FILE = path.join(process.cwd(), "database", "group_whitelist.json");
const store = createScheduledJsonStore(FILE, () => ({
  groups: {},
}));

function ensureGroupMap() {
  if (!store.state.groups || typeof store.state.groups !== "object") {
    store.state.groups = {};
  }
}

function normalizeValue(value = "") {
  const digits = normalizeNumber(value);
  if (digits) {
    return digits;
  }

  return String(normalizeJidUser(value) || "").trim().toLowerCase();
}

function buildMatchKeys(value = "") {
  const keys = new Set();
  const raw = String(value || "").trim();
  if (!raw) return keys;

  const normalized = normalizeValue(raw);
  if (normalized) {
    keys.add(normalized);
  }

  const jidUser = String(normalizeJidUser(raw) || "").trim().toLowerCase();
  if (jidUser) {
    keys.add(jidUser);
  }

  const digits = String(normalizeNumber(raw) || "").trim();
  if (digits) {
    keys.add(digits);
  }

  return keys;
}

export function getGroupWhitelist(groupId = "") {
  ensureGroupMap();
  const group = String(groupId || "").trim();
  const values = Array.isArray(store.state.groups[group]) ? store.state.groups[group] : [];
  return Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean))).sort();
}

export function isWhitelistedUser(groupId = "", value = "") {
  const groupList = getGroupWhitelist(groupId);
  if (!groupList.length) return false;

  const incoming = buildMatchKeys(value);
  if (!incoming.size) return false;

  for (const member of groupList) {
    const keys = buildMatchKeys(member);
    for (const key of keys) {
      if (incoming.has(key)) {
        return true;
      }
    }
  }

  return false;
}

export function addWhitelistedUser(groupId = "", value = "") {
  const group = String(groupId || "").trim();
  const normalized = normalizeValue(value);
  if (!group || !normalized) {
    return { ok: false, reason: "invalid_input" };
  }

  ensureGroupMap();
  const current = new Set(getGroupWhitelist(group));
  const existed = current.has(normalized);
  current.add(normalized);
  store.state.groups[group] = Array.from(current).sort();
  store.scheduleSave();

  return {
    ok: true,
    existed,
    value: normalized,
    total: store.state.groups[group].length,
  };
}

export function removeWhitelistedUser(groupId = "", value = "") {
  const group = String(groupId || "").trim();
  if (!group) return { ok: false, reason: "invalid_group" };

  const incoming = buildMatchKeys(value);
  if (!incoming.size) return { ok: false, reason: "invalid_user" };

  const current = getGroupWhitelist(group);
  if (!current.length) return { ok: true, removed: false, total: 0 };

  const next = current.filter((member) => {
    const keys = buildMatchKeys(member);
    for (const key of keys) {
      if (incoming.has(key)) {
        return false;
      }
    }
    return true;
  });

  ensureGroupMap();
  store.state.groups[group] = next;
  if (!next.length) {
    delete store.state.groups[group];
  }
  store.scheduleSave();

  return {
    ok: true,
    removed: next.length !== current.length,
    total: next.length,
  };
}

export function clearGroupWhitelist(groupId = "") {
  ensureGroupMap();
  const group = String(groupId || "").trim();
  if (!group) return { ok: false, reason: "invalid_group" };

  const hadEntries = Array.isArray(store.state.groups[group]) && store.state.groups[group].length > 0;
  delete store.state.groups[group];
  store.scheduleSave();

  return {
    ok: true,
    cleared: hadEntries,
  };
}
