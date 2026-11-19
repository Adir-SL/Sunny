/** API key and proxy resolution. Keys stay in localStorage or a gitignored config file. */

const STORAGE_KEY = "sunny.settings";

export function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Accept an https proxy URL. http is allowed only for localhost.
 * Returns the base without a trailing slash, or "" when empty.
 * Throws when the value is non-empty but not usable.
 */
export function normalizeProxyBase(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Proxy URL is not valid.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const https = url.protocol === "https:";
  const httpLocal = url.protocol === "http:" && local;
  if (!https && !httpLocal) {
    throw new Error("Use an https proxy URL. http is only allowed for localhost.");
  }
  const path = url.pathname.replace(/\/$/, "");
  return path && path !== "/" ? `${url.origin}${path}` : url.origin;
}

export function readStoredSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.saved) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredSettings(settings) {
  const payload = {
    saved: true,
    apiKey: cleanText(settings.apiKey),
    proxyBase: cleanText(settings.proxyBase),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function clearStoredSettings() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * A saved browser key replaces a file key. A proxy in config.public.json
 * still applies when the browser has not set its own proxy. An apiKey in
 * config.public.json is ignored so a public file cannot publish a secret.
 */
export function resolveSettings(stored, fileConfig = {}, publicConfig = {}) {
  const saved = Boolean(stored?.saved);
  const apiKey = saved ? cleanText(stored.apiKey) : cleanText(fileConfig.apiKey);
  const proxyBase = (saved ? safeProxy(stored.proxyBase) : safeProxy(fileConfig.proxyBase))
    || safeProxy(publicConfig.proxyBase);
  return {
    apiKey,
    proxyBase,
    source: saved ? "browser" : "file",
  };
}

function safeProxy(value) {
  try {
    return normalizeProxyBase(value);
  } catch {
    return "";
  }
}

export function hasLiveCredential(settings) {
  return Boolean(cleanText(settings?.apiKey) || cleanText(settings?.proxyBase));
}
