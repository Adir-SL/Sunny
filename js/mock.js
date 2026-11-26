/**
 * Sample responses in the shape of the Google Weather API.
 * Times follow the place's time zone. This is not live weather.
 */

import { civilParts, zonedTimeToUtc } from "./format.js";

export const DEMO_CITIES = [
  { name: "Ramat Gan", region: "Israel", lat: 32.0684, lng: 34.8248, timeZone: "Asia/Jerusalem" },
  { name: "Tel Aviv", region: "Israel", lat: 32.0853, lng: 34.7818, timeZone: "Asia/Jerusalem" },
  { name: "Jerusalem", region: "Israel", lat: 31.7683, lng: 35.2137, timeZone: "Asia/Jerusalem" },
  { name: "Haifa", region: "Israel", lat: 32.794, lng: 34.9896, timeZone: "Asia/Jerusalem" },
  { name: "Be'er Sheva", region: "Israel", lat: 31.2518, lng: 34.7913, timeZone: "Asia/Jerusalem" },
  { name: "London", region: "United Kingdom", lat: 51.5072, lng: -0.1276, timeZone: "Europe/London" },
  { name: "Paris", region: "France", lat: 48.8566, lng: 2.3522, timeZone: "Europe/Paris" },
  { name: "Berlin", region: "Germany", lat: 52.52, lng: 13.405, timeZone: "Europe/Berlin" },
  { name: "Rome", region: "Italy", lat: 41.9028, lng: 12.4964, timeZone: "Europe/Rome" },
  { name: "Madrid", region: "Spain", lat: 40.4168, lng: -3.7038, timeZone: "Europe/Madrid" },
  { name: "Athens", region: "Greece", lat: 37.9838, lng: 23.7275, timeZone: "Europe/Athens" },
  { name: "Amsterdam", region: "Netherlands", lat: 52.3676, lng: 4.9041, timeZone: "Europe/Amsterdam" },
  { name: "Lisbon", region: "Portugal", lat: 38.7223, lng: -9.1393, timeZone: "Europe/Lisbon" },
  { name: "Cairo", region: "Egypt", lat: 30.0444, lng: 31.2357, timeZone: "Africa/Cairo" },
  { name: "Dubai", region: "United Arab Emirates", lat: 25.2048, lng: 55.2708, timeZone: "Asia/Dubai" },
  { name: "Mumbai", region: "India", lat: 19.076, lng: 72.8777, timeZone: "Asia/Kolkata" },
  { name: "Bangkok", region: "Thailand", lat: 13.7563, lng: 100.5018, timeZone: "Asia/Bangkok" },
  { name: "Singapore", region: "Singapore", lat: 1.3521, lng: 103.8198, timeZone: "Asia/Singapore" },
  { name: "Tokyo", region: "Japan", lat: 35.6762, lng: 139.6503, timeZone: "Asia/Tokyo" },
  { name: "Seoul", region: "South Korea", lat: 37.5665, lng: 126.978, timeZone: "Asia/Seoul" },
  { name: "Sydney", region: "Australia", lat: -33.8688, lng: 151.2093, timeZone: "Australia/Sydney" },
  { name: "New York", region: "United States", lat: 40.7128, lng: -74.006, timeZone: "America/New_York" },
  { name: "Chicago", region: "United States", lat: 41.8781, lng: -87.6298, timeZone: "America/Chicago" },
  { name: "Los Angeles", region: "United States", lat: 34.0522, lng: -118.2437, timeZone: "America/Los_Angeles" },
  { name: "Toronto", region: "Canada", lat: 43.6532, lng: -79.3832, timeZone: "America/Toronto" },
  { name: "São Paulo", region: "Brazil", lat: -23.5558, lng: -46.6396, timeZone: "America/Sao_Paulo" },
  { name: "Cape Town", region: "South Africa", lat: -33.9249, lng: 18.4241, timeZone: "Africa/Johannesburg" },
  { name: "Nairobi", region: "Kenya", lat: -1.2921, lng: 36.8219, timeZone: "Africa/Nairobi" },
  { name: "Reykjavík", region: "Iceland", lat: 64.1466, lng: -21.9426, timeZone: "Atlantic/Reykjavik" },
];

const CONDITIONS = {
  clear: condition("CLEAR", "Sunny", "sunny"),
  mostly: condition("MOSTLY_CLEAR", "Mostly sunny", "mostly_sunny"),
  partly: condition("PARTLY_CLOUDY", "Partly cloudy", "partly_cloudy"),
  cloudy: condition("CLOUDY", "Cloudy", "cloudy"),
  showers: condition("RAIN_SHOWERS", "Rain showers", "showers"),
  rain: condition("RAIN", "Rain", "showers"),
  night: condition("CLEAR", "Clear", "clear"),
  nightCloud: condition("PARTLY_CLOUDY", "Partly cloudy", "mostly_clear"),
};

function condition(type, text, slug) {
  return {
    type,
    description: { text, languageCode: "en" },
    iconBaseUri: `https://maps.gstatic.com/weather/v1/${slug}`,
  };
}

function temperature(degrees) {
  return { degrees: Math.round(degrees * 10) / 10, unit: "CELSIUS" };
}

function searchDemoCities(query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return DEMO_CITIES.filter((city) => `${city.name} ${city.region}`.toLowerCase().includes(needle)).slice(0, 8);
}

export { searchDemoCities };

export function buildMockResponses(place, now = new Date()) {
  const timeZone = place.timeZone || "Asia/Jerusalem";
  const zone = { id: timeZone };
  const here = civilParts(now, timeZone);
  const latitudeBias = Math.max(-6, Math.min(6, (32 - Number(place.lat || 32)) / 8));

  const rainAt = new Set();
  const rainChance = [42, 68, 84, 57, 33];
  const lead = here.hour >= 19 ? 0 : 2;
  rainChance.forEach((_, index) => rainAt.add(lead + index));

  const forecastHours = [];
  for (let index = 0; index < 48; index += 1) {
    const instant = new Date(now.getTime() + index * 3600 * 1000);
    instant.setUTCMinutes(0, 0, 0);
    const local = civilParts(instant, timeZone);
    const end = new Date(instant.getTime() + 3600 * 1000);
    const daylight = local.hour >= 6 && local.hour < 17;
    const rainIndex = [...rainAt].indexOf(index);
    const raining = rainIndex >= 0;
    const temp = diurnalTemp(local.hour, latitudeBias) + (raining ? -1.4 : 0);
    const pop = raining ? rainChance[rainIndex] : local.hour >= 13 && local.hour <= 15 ? 18 : 8;
    let weather = CONDITIONS.partly;
    if (raining) weather = pop >= 70 ? CONDITIONS.rain : CONDITIONS.showers;
    else if (!daylight) weather = local.hour >= 20 || local.hour < 5 ? CONDITIONS.night : CONDITIONS.nightCloud;
    else if (local.hour < 9) weather = CONDITIONS.mostly;
    else if (local.hour > 15) weather = CONDITIONS.cloudy;
    else weather = CONDITIONS.partly;

    forecastHours.push({
      interval: { startTime: instant.toISOString(), endTime: end.toISOString() },
      displayDateTime: {
        year: local.year,
        month: local.month,
        day: local.day,
        hours: local.hour,
        minutes: 0,
        seconds: 0,
        utcOffset: `${offsetLabel(instant, timeZone)}`,
      },
      isDaytime: daylight,
      weatherCondition: weather,
      temperature: temperature(temp),
      feelsLikeTemperature: temperature(temp - (raining ? 1.6 : 0.7)),
      dewPoint: temperature(temp - 6),
      relativeHumidity: raining ? 78 : 56 + (local.hour > 18 ? 8 : 0),
      uvIndex: daylight ? Math.max(1, Math.round(4 * Math.sin(((local.hour - 6) / 11) * Math.PI))) : 0,
      precipitation: {
        probability: { percent: pop, type: "RAIN" },
        qpf: { quantity: raining ? Math.round((pop / 40) * 10) / 10 : 0, unit: "MILLIMETERS" },
      },
      thunderstormProbability: raining && pop >= 70 ? 20 : 0,
      airPressure: { meanSeaLevelMillibars: 1016 },
      wind: {
        direction: { degrees: 310, cardinal: "NORTHWEST" },
        speed: { value: raining ? 22 : 14, unit: "KILOMETERS_PER_HOUR" },
        gust: { value: raining ? 36 : 24, unit: "KILOMETERS_PER_HOUR" },
      },
      visibility: { distance: raining ? 8 : 16, unit: "KILOMETERS" },
      cloudCover: raining ? 92 : 40,
    });
  }

  const historyHours = [];
  for (let index = 1; index <= 24; index += 1) {
    const instant = new Date(now.getTime() - index * 3600 * 1000);
    instant.setUTCMinutes(0, 0, 0);
    const local = civilParts(instant, timeZone);
    historyHours.push({
      interval: { startTime: instant.toISOString(), endTime: new Date(instant.getTime() + 3600 * 1000).toISOString() },
      displayDateTime: { year: local.year, month: local.month, day: local.day, hours: local.hour, minutes: 0, seconds: 0 },
      temperature: temperature(diurnalTemp(local.hour, latitudeBias) + (local.hour >= 12 ? 1.8 : 0.6)),
    });
  }

  const currentHour = forecastHours[0];
  const todayKey = `${here.year}-${here.month}-${here.day}`;
  const todayHours = forecastHours.filter((hour) => {
    const d = hour.displayDateTime;
    return `${d.year}-${d.month}-${d.day}` === todayKey;
  });
  const temps = todayHours.map((hour) => hour.temperature.degrees);

  const current = {
    currentTime: now.toISOString(),
    timeZone: zone,
    isDaytime: currentHour.isDaytime,
    weatherCondition: currentHour.weatherCondition,
    temperature: currentHour.temperature,
    feelsLikeTemperature: currentHour.feelsLikeTemperature,
    dewPoint: currentHour.dewPoint,
    relativeHumidity: currentHour.relativeHumidity,
    uvIndex: currentHour.uvIndex,
    precipitation: currentHour.precipitation,
    thunderstormProbability: currentHour.thunderstormProbability,
    airPressure: currentHour.airPressure,
    wind: currentHour.wind,
    visibility: currentHour.visibility,
    cloudCover: currentHour.cloudCover,
    currentConditionsHistory: {
      temperatureChange: temperature(-0.6),
      maxTemperature: temperature(Math.max(...temps, currentHour.temperature.degrees)),
      minTemperature: temperature(Math.min(...temps, currentHour.temperature.degrees - 4)),
      qpf: { quantity: 0.4, unit: "MILLIMETERS" },
    },
  };

  const forecastDays = [];
  for (let offset = 0; offset < 10; offset += 1) {
    const noon = zonedTimeToUtc(here.year, here.month, here.day, 12, 0, timeZone);
    const dayInstant = new Date(noon.getTime() + offset * 86400000);
    const local = civilParts(dayInstant, timeZone);
    const high = diurnalTemp(15, latitudeBias) + ((offset % 3) - 1) * 0.8;
    const low = diurnalTemp(5, latitudeBias) + ((offset % 2) - 0.5);
    const sunrise = zonedTimeToUtc(local.year, local.month, local.day, 6, 18 + (offset % 4), timeZone);
    const sunset = zonedTimeToUtc(local.year, local.month, local.day, 16, 36 + (offset % 5), timeZone);
    const dayPop = offset === 0 ? 84 : offset === 1 ? 40 : offset % 4 === 0 ? 30 : 10;
    const dayCondition = dayPop >= 60 ? CONDITIONS.showers : dayPop >= 30 ? CONDITIONS.partly : CONDITIONS.mostly;
    forecastDays.push({
      displayDate: { year: local.year, month: local.month, day: local.day },
      maxTemperature: temperature(high),
      minTemperature: temperature(low),
      feelsLikeMaxTemperature: temperature(high - 0.5),
      feelsLikeMinTemperature: temperature(low - 1),
      sunEvents: {
        sunriseTime: sunrise.toISOString(),
        sunsetTime: sunset.toISOString(),
      },
      daytimeForecast: {
        weatherCondition: dayCondition,
        precipitation: {
          probability: { percent: dayPop, type: "RAIN" },
          qpf: { quantity: dayPop > 50 ? 3.2 : 0, unit: "MILLIMETERS" },
        },
        wind: currentHour.wind,
        relativeHumidity: 60,
        uvIndex: 4,
      },
      nighttimeForecast: {
        weatherCondition: CONDITIONS.nightCloud,
        precipitation: { probability: { percent: Math.max(0, dayPop - 25), type: "RAIN" }, qpf: { quantity: 0, unit: "MILLIMETERS" } },
        relativeHumidity: 72,
        uvIndex: 0,
      },
    });
  }

  const alerts = {
    regionCode: "IL",
    weatherAlerts: [
      {
        alertId: "demo-sample-wind",
        alertTitle: { text: "Wind advisory (sample)", languageCode: "en" },
        eventType: "WIND",
        areaName: place.region ? `${place.name}, ${place.region}` : place.name,
        description: "Sample alert included so this layout can be previewed. It is not a real warning and it did not come from a weather agency.",
        severity: "MODERATE",
        certainty: "POSSIBLE",
        urgency: "FUTURE",
        instruction: ["This is demo copy. A live alert would quote the publishing agency here."],
        safetyRecommendations: [
          {
            directive: "Not a real alert.",
            subtext: "Sample data adds this card so you can see severity, timing, and source attribution.",
          },
        ],
        startTime: now.toISOString(),
        expirationTime: new Date(now.getTime() + 6 * 3600 * 1000).toISOString(),
        dataSource: {
          publisher: "DEMO",
          name: "Sample publisher (not a real agency)",
          authorityUri: "https://developers.google.com/maps/documentation/weather/weather-alerts",
        },
      },
    ],
  };

  return {
    current,
    hours: { forecastHours, timeZone: zone },
    history: { historyHours },
    days: { forecastDays, timeZone: zone },
    alerts,
    alertsError: null,
  };
}

function diurnalTemp(hour, bias) {
  const min = 14 + bias * 0.4;
  const max = 23 + bias;
  const phase = ((hour - 15) / 24) * Math.PI * 2;
  return min + (max - min) * (0.5 + 0.5 * Math.cos(phase));
}

function offsetLabel(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
  }).formatToParts(date);
  const name = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return "0s";
  const sign = match[1] === "-" ? -1 : 1;
  const seconds = sign * (Number(match[2]) * 3600 + Number(match[3] || 0) * 60);
  return `${seconds}s`;
}
