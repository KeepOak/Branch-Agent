// The window's language (Private #1100): Settings › Appearance › Language keeps it in the person's look ("lang",
// appearance-store). Words with a translation in the catalog (built from the Control UI's translations,
// scripts/build-window-locales.mjs) show in that language; every other word stays in English.
import { useSyncExternalStore } from "react";
import { CATALOG } from "./catalog";

/** The languages there are translations for, each in its own name. English first. */
export const LANGUAGES: { id: string; name: string }[] = [
  { id: "en", name: "English" }, { id: "ar", name: "العربية" }, { id: "de", name: "Deutsch" }, { id: "es", name: "Español" },
  { id: "fa", name: "فارسی" }, { id: "fr", name: "Français" }, { id: "hi", name: "हिन्दी" }, { id: "id", name: "Bahasa Indonesia" },
  { id: "it", name: "Italiano" }, { id: "ja-JP", name: "日本語" }, { id: "ko", name: "한국어" }, { id: "nl", name: "Nederlands" },
  { id: "pl", name: "Polski" }, { id: "pt-BR", name: "Português (Brasil)" }, { id: "ru", name: "Русский" }, { id: "th", name: "ไทย" },
  { id: "tr", name: "Türkçe" }, { id: "uk", name: "Українська" }, { id: "vi", name: "Tiếng Việt" }, { id: "zh-CN", name: "简体中文" },
  { id: "zh-TW", name: "繁體中文" },
];
const known = (v: unknown): v is string => typeof v === "string" && LANGUAGES.some((l) => l.id === v);

function saved(): string {
  try {
    const lang = (JSON.parse(localStorage.getItem("branch.look") ?? "{}") as { look?: { lang?: unknown } }).look?.lang;
    return known(lang) ? lang : "en";
  } catch {
    return "en"; // storage blocked or damaged: English
  }
}

let current = typeof localStorage === "undefined" ? "en" : saved();
const listeners = new Set<() => void>();

/** Switches the window's words to a language (anything unknown is English) and tells the pages that show them. */
export function setLanguage(id: unknown): void {
  const next = known(id) ? id : "en";
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn());
}
/** The window's language now. */
export const language = (): string => current;
/** A word in the window's language, or the English word when there is no translation for it. */
export function t(en: string): string {
  return current === "en" ? en : CATALOG[current]?.[en] ?? en;
}
/** Re-draws a component when the language changes; returns the language. */
export function useLanguage(): string {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, language, language);
}

if (typeof window !== "undefined") {
  document.documentElement.lang = current;
  // The look store says when the person's look changes (here, in another window, or on another device).
  window.addEventListener("branch:look-change", (e) => setLanguage((e as CustomEvent<{ look?: { lang?: unknown } }>).detail?.look?.lang));
}
