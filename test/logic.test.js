import assert from "node:assert/strict";
import test from "node:test";
import { buildMockResponses } from "../js/mock.js";
import {
  DEFAULT_PLACE,
  dateKeyInZone,
  formatTemp,
  rainyHours,
  weekdayFromCivil,
  zonedTimeToUtc,
} from "../js/format.js";
import { normalizeProxyBase, resolveSettings } from "../js/settings.js";
import { renderChart } from "../js/chart.js";

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
    { saved: true, apiKey: "", proxyBase: "", forceDemo: false },
    { apiKey: "file-key" },
    { proxyBase: "https://proxy.example" },
  );
  assert.equal(stored.apiKey, "");
  assert.equal(stored.proxyBase, "");
});

test("proxy URL must be https unless it is localhost", () => {
  assert.equal(normalizeProxyBase("https://sunny.example/weather/"), "https://sunny.example/weather");
  assert.equal(normalizeProxyBase("http://localhost:8787"), "http://localhost:8787");
  assert.throws(() => normalizeProxyBase("http://example.com"), /https/);
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
