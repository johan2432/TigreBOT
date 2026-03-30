import path from "path";
import { createScheduledJsonStore } from "./json-store.js";

const FILE = path.join(process.cwd(), "database", "languages.json");

export const SUPPORTED_CHAT_LANGUAGES = {
  es: "Espanol",
  en: "English",
  pt: "Portugues",
};

const store = createScheduledJsonStore(FILE, () => ({
  chats: {},
}));

function normalizeLanguage(value = "") {
  const code = String(value || "").trim().toLowerCase();
  return SUPPORTED_CHAT_LANGUAGES[code] ? code : "";
}

export function getChatLanguage(chatId = "", fallback = "es") {
  const defaultLang = normalizeLanguage(fallback) || "es";
  const chat = String(chatId || "").trim();
  if (!chat) return defaultLang;

  const raw = store.state?.chats?.[chat];
  const normalized = normalizeLanguage(raw);
  return normalized || defaultLang;
}

export function setChatLanguage(chatId = "", lang = "es") {
  const chat = String(chatId || "").trim();
  const normalized = normalizeLanguage(lang);

  if (!chat || !normalized) {
    return false;
  }

  if (!store.state.chats || typeof store.state.chats !== "object") {
    store.state.chats = {};
  }

  store.state.chats[chat] = normalized;
  store.scheduleSave();
  return true;
}

export function listSupportedChatLanguages() {
  return { ...SUPPORTED_CHAT_LANGUAGES };
}
