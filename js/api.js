/**
 * Google Maps Platform calls used by Sunny:
 * - Weather API: current conditions, hourly forecast, hourly history, daily forecast, public alerts
 * - Places API (New): city autocomplete and place details
 * - Places API (New) Nearby Search: name the device location
 * - Geocoding API: fallback when Nearby Search finds no locality
 * No other weather provider is called.
 */

import { buildMockResponses, searchDemoCities } from "./mock.js";

const WEATHER_ORIGIN = "https://weather.googleapis.com";
const PLACES_ORIGIN = "https://places.googleapis.com";
const GEO_ORIGIN = "https://maps.googleapis.com";

async function readJson(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return {};
    const data = await response.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export async function loadConfigFiles() {
  const [fileConfig, publicConfig] = await Promise.all([
    readJson(new URL("../config.json", import.meta.url)),
    readJson(new URL("../config.public.json", import.meta.url)),
  ]);
  return {
    fileConfig: {
      apiKey: typeof fileConfig.apiKey === "string" ? fileConfig.apiKey : "",
      proxyBase: typeof fileConfig.proxyBase === "string" ? fileConfig.proxyBase : "",
    },
    publicConfig: {
      proxyBase: typeof publicConfig.proxyBase === "string" ? publicConfig.proxyBase : "",
    },
  };
}

function endpoint(settings, directUrl, proxyPath, { withKey = false } = {}) {
  const url = settings.proxyBase ? new URL(`${settings.proxyBase}${proxyPath}`) : new URL(directUrl);
  if (!settings.proxyBase && withKey) url.searchParams.set("key", settings.apiKey);
  return url;
}

async function requestJson(url, { method = "GET", headers, body, signal } = {}) {
  let response;
  try {
    response = await fetch(url, { method, headers, body, signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const wrapped = new Error("Network error. Check your connection and try again.");
    wrapped.cause = error;
    throw wrapped;
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error_message || `Request failed (${response.status}).`;
    const error = new Error(String(message).replace(/key=[^&\s]+/gi, "key=…"));
    error.status = response.status;
    throw error;
  }
  return payload || {};
}

async function weatherGet(path, params, settings, signal, { units = true } = {}) {
  const query = new URLSearchParams({ languageCode: "en", ...params });
  if (units) query.set("unitsSystem", "METRIC");
  const resource = `/v1/${path}?${query}`;
  const url = endpoint(settings, `${WEATHER_ORIGIN}${resource}`, resource, { withKey: true });
  return requestJson(url, { signal });
}

async function fetchAllHours(place, settings, signal) {
  const hours = [];
  let pageToken = "";
  let timeZone = null;
  for (let page = 0; page < 6; page += 1) {
    const params = {
      "location.latitude": String(place.lat),
      "location.longitude": String(place.lng),
      hours: "48",
      pageSize: "24",
    };
    if (pageToken) params.pageToken = pageToken;
    const body = await weatherGet("forecast/hours:lookup", params, settings, signal);
    if (body.timeZone) timeZone = body.timeZone;
    hours.push(...(body.forecastHours || []));
    if (!body.nextPageToken || hours.length >= 48) break;
    pageToken = body.nextPageToken;
  }
  return { forecastHours: hours, timeZone };
}

async function fetchHistoryHours(place, settings, signal) {
  const hours = [];
  let pageToken = "";
  for (let page = 0; page < 3; page += 1) {
    const params = {
      "location.latitude": String(place.lat),
      "location.longitude": String(place.lng),
      hours: "24",
      pageSize: "24",
    };
    if (pageToken) params.pageToken = pageToken;
    const body = await weatherGet("history/hours:lookup", params, settings, signal);
    hours.push(...(body.historyHours || []));
    if (!body.nextPageToken || hours.length >= 24) break;
    pageToken = body.nextPageToken;
  }
  return { historyHours: hours };
}

async function fetchAllDays(place, settings, signal) {
  const days = [];
  let pageToken = "";
  let timeZone = null;
  for (let page = 0; page < 4; page += 1) {
    const params = {
      "location.latitude": String(place.lat),
      "location.longitude": String(place.lng),
      days: "10",
      pageSize: "10",
    };
    if (pageToken) params.pageToken = pageToken;
    const body = await weatherGet("forecast/days:lookup", params, settings, signal);
    if (body.timeZone) timeZone = body.timeZone;
    days.push(...(body.forecastDays || []));
    if (!body.nextPageToken || days.length >= 10) break;
    pageToken = body.nextPageToken;
  }
  return { forecastDays: days.slice(0, 10), timeZone };
}

export async function fetchWeather(place, settings, signal) {
  if (settings.demo) {
    await delay(280, signal);
    return buildMockResponses(place);
  }
  const loc = {
    "location.latitude": String(place.lat),
    "location.longitude": String(place.lng),
  };
  const [current, hours, history, days, alertsResult] = await Promise.all([
    weatherGet("currentConditions:lookup", loc, settings, signal),
    fetchAllHours(place, settings, signal),
    // History only feeds the "vs yesterday" line, so a failure must not block the forecast.
    fetchHistoryHours(place, settings, signal).catch((error) => {
      if (error?.name === "AbortError") throw error;
      return { historyHours: [] };
    }),
    fetchAllDays(place, settings, signal),
    weatherGet("publicAlerts:lookup", loc, settings, signal, { units: false }).then(
      (alerts) => ({ alerts, alertsError: null }),
      (error) => ({ alerts: { weatherAlerts: [], regionCode: "" }, alertsError: error }),
    ),
  ]);
  return {
    current,
    hours,
    history,
    days,
    alerts: alertsResult.alerts,
    alertsError: alertsResult.alertsError,
  };
}

export async function searchCities(query, settings, signal) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const coords = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return [{ name: `${lat.toFixed(2)}, ${lng.toFixed(2)}`, region: "Coordinates", lat, lng, timeZone: "UTC" }];
    }
  }
  if (settings.demo) {
    await delay(60, signal);
    return searchDemoCities(trimmed);
  }
  const url = endpoint(
    settings,
    `${PLACES_ORIGIN}/v1/places:autocomplete`,
    "/places/v1/places:autocomplete",
  );
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
  };
  if (!settings.proxyBase) headers["X-Goog-Api-Key"] = settings.apiKey;
  const body = await requestJson(url, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      input: trimmed,
      includedPrimaryTypes: ["(cities)"],
      languageCode: "en",
    }),
  });
  return (body.suggestions || []).flatMap((suggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction?.placeId) return [];
    const main = prediction.structuredFormat?.mainText?.text || prediction.text?.text || "City";
    const secondary = prediction.structuredFormat?.secondaryText?.text || "";
    return [{ name: main, region: secondary, placeId: prediction.placeId }];
  }).slice(0, 8);
}

export async function lookupPlace(placeId, settings, signal) {
  const resource = `/v1/places/${encodeURIComponent(placeId)}`;
  const url = endpoint(settings, `${PLACES_ORIGIN}${resource}`, `/places${resource}`);
  url.searchParams.set("languageCode", "en");
  const headers = { "X-Goog-FieldMask": "location,displayName,formattedAddress" };
  if (!settings.proxyBase) headers["X-Goog-Api-Key"] = settings.apiKey;
  const body = await requestJson(url, { headers, signal });
  const lat = body.location?.latitude;
  const lng = body.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("That place did not include a location.");
  }
  return {
    name: body.displayName?.text || "Selected place",
    region: body.formattedAddress || "",
    lat,
    lng,
  };
}

export const NEARBY_FIELD_MASK = "places.displayName,places.formattedAddress,places.types";
export const NEARBY_RADII = [5000, 20000];

export function nearbySearchBody(lat, lng, radius) {
  return {
    includedTypes: ["locality"],
    maxResultCount: 1,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius,
      },
    },
  };
}

/** Turn a Places Nearby Search response into a city label, or null. */
export function placeFromNearby(payload, lat, lng) {
  const places = Array.isArray(payload?.places) ? payload.places : [];
  const place = places.find((item) => item?.types?.includes("locality")) || places[0];
  const name = place?.displayName?.text?.trim();
  if (!name) return null;
  const formatted = String(place.formattedAddress || "").trim();
  let region = "";
  if (formatted && formatted !== name) {
    region = formatted.startsWith(`${name},`)
      ? formatted.slice(name.length + 1).trim()
      : formatted;
  }
  return { name, region, lat, lng, unnamed: false };
}

export function placeFromGeocode(payload, lat, lng) {
  const result = payload?.results?.[0];
  if (!result) return null;
  const components = result.address_components || [];
  const locality = components.find((part) => part.types?.includes("locality") || part.types?.includes("postal_town"));
  const admin = components.find((part) => part.types?.includes("administrative_area_level_1"));
  const country = components.find((part) => part.types?.includes("country"));
  const name = (locality?.long_name || admin?.long_name || "").trim();
  if (!name) return null;
  return {
    name,
    region: locality ? (country?.long_name || "") : [admin?.long_name, country?.long_name].filter(Boolean).join(", "),
    lat,
    lng,
    unnamed: false,
  };
}

/** Try Nearby Search at 5 km, then 20 km, then Geocoding, then coordinates. */
export async function nameFromLookups(lat, lng, { nearby, geocode }) {
  for (const radius of NEARBY_RADII) {
    const found = await nearby(radius);
    if (found) return found;
  }
  const geocoded = await geocode();
  if (geocoded) return geocoded;
  return { name: "Current location", region: "", lat, lng, unnamed: true };
}

export async function reverseGeocode(lat, lng, settings, signal) {
  if (settings.demo) {
    return { name: "Current location", region: "", lat, lng, unnamed: true };
  }
  return nameFromLookups(lat, lng, {
    nearby: (radius) => nearbyLocality(lat, lng, radius, settings, signal),
    geocode: () => geocodeLocality(lat, lng, settings, signal),
  });
}

async function nearbyLocality(lat, lng, radius, settings, signal) {
  try {
    const url = endpoint(
      settings,
      `${PLACES_ORIGIN}/v1/places:searchNearby`,
      "/places/v1/places:searchNearby",
    );
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": NEARBY_FIELD_MASK,
    };
    if (!settings.proxyBase) headers["X-Goog-Api-Key"] = settings.apiKey;
    const body = await requestJson(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(nearbySearchBody(lat, lng, radius)),
    });
    return placeFromNearby(body, lat, lng);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return null;
  }
}

async function geocodeLocality(lat, lng, settings, signal) {
  try {
    const url = endpoint(
      settings,
      `${GEO_ORIGIN}/maps/api/geocode/json`,
      "/geocode/json",
      { withKey: true },
    );
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("language", "en");
    url.searchParams.set("result_type", "locality|postal_town|administrative_area_level_2");
    const body = await requestJson(url, { signal });
    return placeFromGeocode(body, lat, lng);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return null;
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }, { once: true });
  });
}
