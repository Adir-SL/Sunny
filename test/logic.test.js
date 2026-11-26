import assert from "node:assert/strict";
import test from "node:test";
import { buildMockResponses } from "../js/mock.js";
import {
  DEFAULT_PLACE,
  dateKeyInZone,
  formatTemp,
  formatTempChange,
  rainyHours,
  weekdayFromCivil,
  zonedTimeToUtc,
} from "../js/format.js";
import { hasLiveCredential, normalizeProxyBase, resolveSettings } from "../js/settings.js";
import { renderChart } from "../js/chart.js";
import {
  NEARBY_FIELD_MASK,
  nameFromLookups,
  nearbySearchBody,
  placeFromNearby,
} from "../js/api.js";
import { routeUpstream } from "../proxy/cloudflare-worker.js";

test("temperatures always include a degree symbol", () => {
  assert.equal(formatTemp(22.4, "c"), "22°");
  assert.equal(formatTemp(0.2, "c"), "0°");
  assert.equal(formatTemp(-0.2, "c"), "0°");
  assert.equal(formatTemp(0, "f"), "32°");
  assert.equal(formatTemp(null, "c"), "—");
});

test("rain warning lists only today's hours above 30 percent", () => {
  const zone = "Asia/Jerusalem";
  const now = new Date("2026-11-19T08:00:00Z");
  const hours = [0, 30, 31, 80].map((percent, index) => ({
    displayDateTime: { year: 2026, month: 11, day: index === 3 ? 20 : 19, hours: 10 + index },
    precipitation: { probability: { percent, type: "RAIN" } },
  }));
  const rainy = rainyHours(hours, zone, now);
  assert.equal(rainy.length, 1);
  assert.equal(rainy[0].precipitation.probability.percent, 31);
});

test("demo forecast includes a same-day rain warning for Ramat Gan", () => {
  const now = new Date("2026-11-19T08:03:00Z");
  const bundle = buildMockResponses(DEFAULT_PLACE, now);
  const zone = bundle.current.timeZone.id;
  assert.equal(zone, "Asia/Jerusalem");
  assert.equal(bundle.current.temperature.unit, "CELSIUS");
  assert.ok(bundle.current.weatherCondition.iconBaseUri.startsWith("https://maps.gstatic.com/weather/v1/"));
  assert.equal(bundle.days.forecastDays.length, 10);
  assert.ok(bundle.days.forecastDays[0].sunEvents.sunriseTime);
  const rainy = rainyHours(bundle.hours.forecastHours, zone, now);
  assert.ok(rainy.length >= 3);
  assert.ok(rainy.every((hour) => hour.precipitation.probability.percent > 30));
  assert.equal(dateKeyInZone(now, zone), "2026-11-19");
  assert.equal(weekdayFromCivil(2026, 11, 19), "Thu");
});

test("civil time conversion uses the location offset", () => {
  const utc = zonedTimeToUtc(2026, 11, 19, 10, 0, "Asia/Jerusalem");
  assert.equal(utc.toISOString(), "2026-11-19T08:00:00.000Z");
});

test("settings keep keys out of the public config", () => {
  const resolved = resolveSettings(null, {}, { apiKey: "secret", proxyBase: "https://proxy.example" });
  assert.equal(resolved.apiKey, "");
  assert.equal(resolved.proxyBase, "https://proxy.example");
  const stored = resolveSettings(
    { saved: true, apiKey: "", proxyBase: "" },
    { apiKey: "file-key" },
    { proxyBase: "https://proxy.example" },
  );
  assert.equal(stored.apiKey, "");
  assert.equal(stored.proxyBase, "https://proxy.example");
  const fileKey = resolveSettings(null, { apiKey: "file-key", proxyBase: "" }, {});
  assert.equal(fileKey.apiKey, "file-key");
  assert.equal(hasLiveCredential(fileKey), true);
  assert.equal(hasLiveCredential(resolveSettings(null, {}, {})), false);
});

test("proxy URL must be https unless it is localhost", () => {
  assert.equal(normalizeProxyBase("https://sunny.example/weather/"), "https://sunny.example/weather");
  assert.equal(normalizeProxyBase("http://localhost:8787"), "http://localhost:8787");
  assert.throws(() => normalizeProxyBase("http://example.com"), /https/);
});

test("nearby search names Ramat Gan and widens the radius before geocoding", async () => {
  const body = nearbySearchBody(32.068, 34.824, 5000);
  assert.deepEqual(body, {
    includedTypes: ["locality"],
    maxResultCount: 1,
    locationRestriction: {
      circle: { center: { latitude: 32.068, longitude: 34.824 }, radius: 5000 },
    },
  });
  assert.equal(NEARBY_FIELD_MASK, "places.displayName,places.formattedAddress,places.types");
  const named = placeFromNearby({
    places: [{
      displayName: { text: "Ramat Gan" },
      formattedAddress: "Ramat Gan, Israel",
      types: ["locality"],
    }],
  }, 32.068, 34.824);
  assert.equal(named.name, "Ramat Gan");
  assert.equal(named.region, "Israel");

  const radii = [];
  const firstHit = await nameFromLookups(32.068, 34.824, {
    nearby: async (radius) => {
      radii.push(radius);
      return radius === 5000 ? named : null;
    },
    geocode: async () => { throw new Error("geocoding should not run"); },
  });
  assert.equal(firstHit.name, "Ramat Gan");
  assert.deepEqual(radii, [5000]);

  const widened = [];
  const secondHit = await nameFromLookups(0, 0, {
    nearby: async (radius) => {
      widened.push(radius);
      return radius === 20000 ? { name: "Far town", region: "Elsewhere", lat: 0, lng: 0, unnamed: false } : null;
    },
    geocode: async () => null,
  });
  assert.equal(secondHit.name, "Far town");
  assert.deepEqual(widened, [5000, 20000]);

  const fallback = await nameFromLookups(1, 2, {
    nearby: async () => null,
    geocode: async () => ({ name: "Geocoded", region: "Country", lat: 1, lng: 2, unnamed: false }),
  });
  assert.equal(fallback.name, "Geocoded");

  const coords = await nameFromLookups(1, 2, {
    nearby: async () => null,
    geocode: async () => null,
  });
  assert.equal(coords.unnamed, true);
  assert.equal(coords.name, "Current location");
});

test("the proxy forwards Places Nearby Search", () => {
  assert.equal(
    routeUpstream("https://proxy.example/places/v1/places:searchNearby", "POST"),
    "https://places.googleapis.com/v1/places:searchNearby",
  );
  assert.equal(
    routeUpstream("/geocode/json?latlng=32.068,34.824", "GET"),
    "https://maps.googleapis.com/maps/api/geocode/json?latlng=32.068,34.824",
  );
  assert.equal(routeUpstream("/places/v1/places:searchNearby", "PUT"), null);
});

test("hourly chart renders three modes", () => {
  const { hours } = buildMockResponses(DEFAULT_PLACE, new Date("2026-11-19T08:03:00Z"));
  const slice = hours.forecastHours.slice(0, 24);
  for (const mode of ["temp", "precip", "wind"]) {
    const svg = renderChart({ hours: slice, mode, unit: "c", selectedIndex: 1 });
    assert.match(svg, /<svg/);
    assert.match(svg, /data-hour="0"/);
  }
  assert.match(renderChart({ hours: slice, mode: "temp", unit: "f", selectedIndex: 0 }), /°/);
});

test("temperature change reads against yesterday", () => {
  assert.equal(formatTempChange(1.2, "c"), "1° hotter than yesterday");
  assert.equal(formatTempChange(-2.4, "c"), "2° cooler than yesterday");
  assert.equal(formatTempChange(0.3, "c"), "Same as yesterday");
  assert.equal(formatTempChange(-0.6, "f"), "1° cooler than yesterday");
  assert.equal(formatTempChange(null, "c"), "");
});
