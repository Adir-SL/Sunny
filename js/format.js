/** Formatting and forecast rules. Weather values from the API are metric. */

export const RAIN_THRESHOLD = 30;
export const DEFAULT_PLACE = {
  name: "Ramat Gan",
  region: "Israel",
  lat: 32.0684,
  lng: 34.8248,
  timeZone: "Asia/Jerusalem",
};

const CARDINALS = {
  NORTH: "N",
  NORTH_NORTHEAST: "NNE",
  NORTHEAST: "NE",
  EAST_NORTHEAST: "ENE",
  EAST: "E",
  EAST_SOUTHEAST: "ESE",
  SOUTHEAST: "SE",
  SOUTH_SOUTHEAST: "SSE",
  SOUTH: "S",
  SOUTH_SOUTHWEST: "SSW",
  SOUTHWEST: "SW",
  WEST_SOUTHWEST: "WSW",
  WEST: "W",
  WEST_NORTHWEST: "WNW",
  NORTHWEST: "NW",
  NORTH_NORTHWEST: "NNW",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function civilParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

export function dateKeyInZone(date, timeZone) {
  const parts = civilParts(date, timeZone);
  return dateKey(parts.year, parts.month, parts.day);
}

export function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function offsetSeconds(date, timeZone) {
  const parts = civilParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  return Math.round((asUtc - date.getTime()) / 1000);
}

/** Civil time in `timeZone` expressed as a UTC Date. */
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const first = offsetSeconds(guess, timeZone);
  const adjusted = new Date(guess.getTime() - first * 1000);
  const second = offsetSeconds(adjusted, timeZone);
  return second === first ? adjusted : new Date(guess.getTime() - second * 1000);
}

export function hourLocalDateKey(hour, timeZone) {
  const display = hour?.displayDateTime;
  if (display?.year && display?.month && display?.day) {
    return dateKey(display.year, display.month, display.day);
  }
  const start = hour?.interval?.startTime;
  if (!start) return "";
  return dateKeyInZone(new Date(start), timeZone);
}

export function rainyHours(hours, timeZone, now = new Date(), threshold = RAIN_THRESHOLD) {
  const today = dateKeyInZone(now, timeZone);
  return (hours || []).filter((hour) => {
    const percent = hour?.precipitation?.probability?.percent;
    return hourLocalDateKey(hour, timeZone) === today && Number(percent) > threshold;
  });
}

export function tempNumber(celsius, unit) {
  if (celsius == null || celsius === "") return null;
  const value = Number(celsius);
  if (!Number.isFinite(value)) return null;
  return unit === "f" ? (value * 9) / 5 + 32 : value;
}

export function formatTemp(celsius, unit) {
  const value = tempNumber(celsius, unit);
  if (value == null) return "—";
  const rounded = Math.round(value);
  return `${rounded === 0 ? 0 : rounded}°`;
}

/** Describe a 24-hour temperature change (in °C) as "2° hotter than yesterday". */
export function formatTempChange(deltaCelsius, unit, than = "yesterday") {
  if (deltaCelsius == null || deltaCelsius === "") return "";
  const value = Number(deltaCelsius);
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(unit === "f" ? value * 1.8 : value);
  if (rounded === 0) return `Same temperature as ${than}`;
  return `${Math.abs(rounded)}° ${rounded > 0 ? "hotter" : "cooler"} than ${than}`;
}

/** Find the history hour that starts 24 hours before the given forecast hour. */
export function hourDayBefore(hour, historyHours) {
  const start = Date.parse(hour?.interval?.startTime);
  if (!Number.isFinite(start) || !Array.isArray(historyHours)) return null;
  const target = start - 24 * 3600 * 1000;
  return historyHours.find((item) => {
    const time = Date.parse(item?.interval?.startTime);
    return Number.isFinite(time) && Math.abs(time - target) < 30 * 60 * 1000;
  }) || null;
}

export function formatTempSpoken(celsius, unit) {
  const shown = formatTemp(celsius, unit);
  if (shown === "—") return "unavailable";
  return `${shown.replace("°", "")} degrees ${unit === "f" ? "Fahrenheit" : "Celsius"}`;
}

export function speedNumber(kmh, unit) {
  if (kmh == null || kmh === "") return null;
  const value = Number(kmh);
  if (!Number.isFinite(value)) return null;
  return unit === "f" ? value * 0.621371 : value;
}

export function formatSpeed(kmh, unit) {
  const value = speedNumber(kmh, unit);
  if (value == null) return "—";
  return `${Math.round(value)} ${unit === "f" ? "mph" : "km/h"}`;
}

export function formatDistance(km, unit) {
  const value = Number(km);
  if (!Number.isFinite(value)) return "—";
  if (unit === "f") return `${Math.round(value * 0.621371)} mi`;
  return `${Math.round(value)} km`;
}

export function formatAmount(mm, unit) {
  const value = Number(mm);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (unit === "f") return `${(value / 25.4).toFixed(2)} in`;
  return value < 10 ? `${value.toFixed(1)} mm` : `${Math.round(value)} mm`;
}

export function cardinalLabel(cardinal) {
  if (!cardinal) return "";
  return CARDINALS[cardinal] || String(cardinal).replaceAll("_", " ").toLowerCase();
}

export function formatHourLabel(hour) {
  const display = hour?.displayDateTime;
  if (display && Number.isFinite(Number(display.hours))) {
    return `${String(display.hours).padStart(2, "0")}:00`;
  }
  return "";
}

export function formatClock(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatLongDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function zoneOffsetLabel(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
  } catch {
    return timeZone || "";
  }
}

export function weekdayFromCivil(year, month, day) {
  const utc = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(utc);
}

export function uvCategory(index) {
  const value = Number(index);
  if (!Number.isFinite(value)) return "";
  if (value <= 2) return "Low";
  if (value <= 5) return "Moderate";
  if (value <= 7) return "High";
  if (value <= 10) return "Very high";
  return "Extreme";
}

export function precipPercent(precipitation) {
  const value = precipitation?.probability?.percent;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function degreesOf(temperature) {
  const value = temperature?.degrees;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function placeKey(place) {
  return `${Number(place.lat).toFixed(3)},${Number(place.lng).toFixed(3)}`;
}

export function skyFromCondition(type, isDaytime) {
  const name = String(type || "");
  if (!isDaytime) return "night";
  if (/THUNDER|TSTORMS/.test(name)) return "storm";
  if (/SNOW|SLEET|FLURR|ICE|HAIL/.test(name)) return "snow";
  if (/RAIN|SHOWER|DRIZZLE/.test(name)) return "rain";
  if (/CLOUD|FOG|DUST|SMOKE|HAZE/.test(name)) return "cloud";
  return "clear";
}
