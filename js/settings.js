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
    forceDemo: Boolean(settings.forceDemo),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function clearStoredSettings() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * localStorage wins after the user saves Settings, so clearing the key
 * does not fall back to a config file. config.public.json may supply a
 * proxy URL only — an apiKey in that file is ignored.
 */
export function resolveSettings(stored, fileConfig = {}, publicConfig = {}) {
  if (stored?.saved) {
    return {
      apiKey: cleanText(stored.apiKey),
      proxyBase: safeProxy(stored.proxyBase),
      forceDemo: Boolean(stored.forceDemo),
      source: "browser",
    };
  }
  return {
    apiKey: cleanText(fileConfig.apiKey),
    proxyBase: safeProxy(fileConfig.proxyBase) || safeProxy(publicConfig.proxyBase),
    forceDemo: false,
    source: "file",
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
