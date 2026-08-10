/**
 * Lightweight, reactive theme store. The actual DOM attribute is set
 * pre-hydration in the inline <script> in sidebar.html, so the first
 * paint already has the right colors.
 *
 * BigSet stores theme in localStorage under "bigset:theme" and broadcasts
 * a `bigset:theme-changed` event for cross-component sync (mirrors the
 * frontend's useSyncExternalStore + CustomEvent pattern).
 */
import { writable, type Writable } from "svelte/store";

const STORAGE_KEY = "bigset:theme";
export type Theme = "light" | "dark";

function detect(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr as Theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage might be blocked */
  }
}

export const theme: Writable<Theme> = writable(detect());

theme.subscribe((value) => {
  apply(value);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bigset:theme-changed", { detail: value }));
  }
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark")) {
      theme.set(e.newValue);
    }
  });
}

export function toggleTheme(): void {
  theme.update((current) => (current === "light" ? "dark" : "light"));
}
