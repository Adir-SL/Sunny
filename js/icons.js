/**
 * Meteocons weather icons (fill style, MIT, by Bas Milius — https://meteocons.com),
 * self-hosted under icons/meteocons. "@" is replaced with "day" or "night".
 * The hero uses the animated set; lists use the static set.
 */

const ICON_BY_TYPE = {
  CLEAR: "clear-@",
  MOSTLY_CLEAR: "mostly-clear-@",
  PARTLY_CLOUDY: "partly-cloudy-@",
  MOSTLY_CLOUDY: "overcast-@",
  CLOUDY: "overcast",
  WINDY: "wind",
  WIND_AND_RAIN: "rain",
  LIGHT_RAIN_SHOWERS: "partly-cloudy-@-drizzle",
  CHANCE_OF_SHOWERS: "partly-cloudy-@-rain",
  SCATTERED_SHOWERS: "partly-cloudy-@-rain",
  RAIN_SHOWERS: "overcast-@-rain",
  HEAVY_RAIN_SHOWERS: "extreme-@-rain",
  LIGHT_TO_MODERATE_RAIN: "rain",
  MODERATE_TO_HEAVY_RAIN: "extreme-rain",
  RAIN: "rain",
  LIGHT_RAIN: "drizzle",
  HEAVY_RAIN: "extreme-rain",
  RAIN_PERIODICALLY_HEAVY: "extreme-rain",
  LIGHT_SNOW_SHOWERS: "partly-cloudy-@-snow",
  CHANCE_OF_SNOW_SHOWERS: "partly-cloudy-@-snow",
  SCATTERED_SNOW_SHOWERS: "partly-cloudy-@-snow",
  SNOW_SHOWERS: "overcast-@-snow",
  HEAVY_SNOW_SHOWERS: "extreme-snow",
  LIGHT_TO_MODERATE_SNOW: "snow",
  MODERATE_TO_HEAVY_SNOW: "extreme-snow",
  SNOW: "snow",
  LIGHT_SNOW: "snow",
  HEAVY_SNOW: "extreme-snow",
  SNOWSTORM: "extreme-snow",
  SNOW_PERIODICALLY_HEAVY: "extreme-snow",
  HEAVY_SNOW_STORM: "extreme-snow",
  BLOWING_SNOW: "wind-snow",
  RAIN_AND_SNOW: "sleet",
  HAIL: "hail",
  HAIL_SHOWERS: "partly-cloudy-@-hail",
  THUNDERSTORM: "thunderstorms-rain",
  THUNDERSHOWER: "thunderstorms-@-rain",
  LIGHT_THUNDERSTORM_RAIN: "thunderstorms-@-rain",
  SCATTERED_THUNDERSTORMS: "thunderstorms-@",
  HEAVY_THUNDERSTORM: "thunderstorms-extreme-rain",
};

export const ICON_NAMES = [...new Set(
  Object.values(ICON_BY_TYPE).flatMap((name) => name.includes("@")
    ? [name.replace("@", "day"), name.replace("@", "night")]
    : [name]),
)];

export function iconSlug(condition, isDaytime = true) {
  const pattern = ICON_BY_TYPE[condition?.type || ""] || "partly-cloudy-@";
  return pattern.replace("@", isDaytime ? "day" : "night");
}

export function iconUrl(condition, { isDaytime = true, animated = false } = {}) {
  return `icons/meteocons/${animated ? "animated" : "static"}/${iconSlug(condition, isDaytime)}.svg`;
}

export function fallbackIconSvg(type = "") {
  const name = String(type);
  const storm = /THUNDER/.test(name);
  const snow = /SNOW|HAIL|SLEET/.test(name);
  const rain = /RAIN|SHOWER|DRIZZLE/.test(name);
  const cloud = /CLOUD|FOG|MIST|DUST|SMOKE/.test(name) || rain || snow || storm;
  const sun = !cloud || /PARTLY|MOSTLY_CLEAR|CLEAR/.test(name);
  const parts = [];
  if (sun && !storm) {
    parts.push(`<circle cx="16" cy="15" r="5" fill="#f0a14a"/>`);
  }
  if (cloud) {
    parts.push(`<path d="M10 24h14a5 5 0 0 0 .4-10 6.5 6.5 0 0 0-12.4 1.6A4.2 4.2 0 0 0 10 24z" fill="#d7dee8"/>`);
  }
  if (rain || storm) {
    parts.push(`<path d="M13 27l-1.2 3M18 27l-1.2 3M23 27l-1.2 3" stroke="#3d6f9a" stroke-width="1.6" stroke-linecap="round"/>`);
  }
  if (snow) {
    parts.push(`<path d="M14 28h.1M19 30h.1M23 28h.1" stroke="#d7dee8" stroke-width="2.4" stroke-linecap="round"/>`);
  }
  if (!sun && !cloud) {
    parts.push(`<circle cx="18" cy="18" r="6" fill="#f0a14a"/>`);
  }
  return `<svg class="wx-fallback" viewBox="0 0 36 36" aria-hidden="true">${parts.join("")}</svg>`;
}
