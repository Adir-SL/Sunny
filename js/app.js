import { fetchWeather, loadConfigFiles, lookupPlace, reverseGeocode, searchCities } from "./api.js";
import { renderChart } from "./chart.js";
import {
  RAIN_THRESHOLD,
  DEFAULT_PLACE,
  cardinalLabel,
  dateKey,
  dateKeyInZone,
  degreesOf,
  escapeHtml,
  formatAmount,
  formatClock,
  formatDistance,
  formatHourLabel,
  formatLongDate,
  formatSpeed,
  formatTemp,
  formatTempSpoken,
  placeKey,
  precipPercent,
  rainyHours,
  skyFromCondition,
  uvCategory,
  weekdayFromCivil,
  zoneOffsetLabel,
} from "./format.js";
import { fallbackIconSvg, iconUrl } from "./icons.js";
import {
  hasLiveCredential,
  normalizeProxyBase,
  readStoredSettings,
  resolveSettings,
  writeStoredSettings,
} from "./settings.js";

const HOURS_SHOWN = 24;
const state = {
  settings: { apiKey: "", proxyBase: "", forceDemo: false, source: "file" },
  demo: true,
  place: loadPlace(),
  favorites: loadFavorites(),
  unit: localStorage.getItem("sunny.unit") === "f" ? "f" : "c",
  theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  bundle: null,
  fetchedAt: null,
  stale: false,
  loading: false,
  updating: false,
  error: "",
  offline: !navigator.onLine,
  chartTab: "temp",
  selectedHour: 0,
  searchResults: [],
  searchActive: -1,
  searchTimer: 0,
  searchSeq: 0,
  weatherAbort: null,
  installPrompt: null,
};

const els = {
  banners: document.querySelector("#banners"),
  main: document.querySelector("#main"),
  live: document.querySelector("#live"),
  search: document.querySelector("#search"),
  searchList: document.querySelector("#search-list"),
  settings: document.querySelector("#settings-dialog"),
  favorites: document.querySelector("#favorites-dialog"),
  favoriteList: document.querySelector("#favorite-list"),
  settingsForm: document.querySelector("#settings-form"),
  keyInput: document.querySelector("#api-key"),
  proxyInput: document.querySelector("#proxy-base"),
  forceDemo: document.querySelector("#force-demo"),
  settingsError: document.querySelector("#settings-error"),
  themeButton: document.querySelector("#theme-toggle"),
  installButton: document.querySelector("#install"),
};

boot();

async function boot() {
  applyTheme(state.theme);
  syncUnitButtons();
  const { fileConfig, publicConfig } = await loadConfigFiles();
  state.settings = resolveSettings(readStoredSettings(), fileConfig, publicConfig);
  state.demo = forcedDemo();
  bind();
  registerWorker();
  await loadWeather();
  maybeAutoLocate();
}

function forcedDemo() {
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") return true;
  if (state.settings.forceDemo) return true;
  return !hasLiveCredential(state.settings);
}

function bind() {
  document.querySelector("#locate").addEventListener("click", locate);
  document.querySelector("#refresh-page")?.addEventListener("click", () => loadWeather());
  document.querySelectorAll("[data-unit]").forEach((button) => {
    button.addEventListener("click", () => setUnit(button.dataset.unit));
  });
  els.themeButton.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    render();
  });
  document.querySelector("#settings-open").addEventListener("click", openSettings);
  document.querySelector("#favorites-open").addEventListener("click", openFavorites);
  document.querySelector("#settings-cancel").addEventListener("click", () => els.settings.close());
  document.querySelector("#favorites-close").addEventListener("click", () => els.favorites.close());
  document.querySelector("#clear-key").addEventListener("click", () => {
    els.keyInput.value = "";
    els.forceDemo.checked = false;
  });
  els.settingsForm.addEventListener("submit", saveSettings);
  els.search.addEventListener("input", onSearchInput);
  els.search.addEventListener("keydown", onSearchKeydown);
  document.querySelector("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    chooseSearch(state.searchActive >= 0 ? state.searchActive : 0);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search")) closeSearch();
  });
  els.searchList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-result]");
    if (!button) return;
    chooseSearch(Number(button.dataset.result));
  });
  els.main.addEventListener("click", onMainClick);
  els.main.addEventListener("keydown", onMainKeydown);
  els.main.addEventListener("error", onIconError, true);
  els.favoriteList.addEventListener("click", onFavoriteClick);
  els.installButton.addEventListener("click", install);
  window.addEventListener("online", () => {
    state.offline = false;
    loadWeather();
  });
  window.addEventListener("offline", () => {
    state.offline = true;
    renderBanners();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    els.installButton.hidden = false;
  });
}

function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (new URLSearchParams(location.search).get("nosw") === "1") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

async function maybeAutoLocate() {
  if (localStorage.getItem("sunny.place")) return;
  if (!navigator.permissions?.query || !navigator.geolocation) return;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state === "granted") locate();
  } catch {
    /* The button remains available. */
  }
}

function locate() {
  if (!navigator.geolocation) {
    announce("This browser cannot share your location.");
    return;
  }
  announce("Finding your location…");
  navigator.geolocation.getCurrentPosition(async (position) => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    let place = { name: "Current location", region: "", lat, lng };
    try {
      place = await reverseGeocode(lat, lng, requestSettings(), new AbortController().signal);
    } catch {
      /* Coordinates still work when reverse geocoding is unavailable. */
    }
    selectPlace(place);
  }, () => {
    announce("Location permission was denied. Showing the current city.");
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
}

function selectPlace(place) {
  state.place = {
    name: place.name || "Selected place",
    region: place.region || "",
    lat: Number(place.lat),
    lng: Number(place.lng),
    timeZone: place.timeZone || state.place.timeZone || DEFAULT_PLACE.timeZone,
  };
  localStorage.setItem("sunny.place", JSON.stringify(state.place));
  state.selectedHour = 0;
  closeSearch();
  els.search.value = "";
  loadWeather();
}

async function loadWeather() {
  state.weatherAbort?.abort();
  const abort = new AbortController();
  state.weatherAbort = abort;
  state.error = "";
  state.demo = forcedDemo();
  const cached = state.demo ? null : readCache(state.place);
  if (cached) {
    state.bundle = cached.bundle;
    state.fetchedAt = cached.fetchedAt;
    state.stale = true;
    state.loading = false;
    state.updating = true;
    render();
  } else if (!state.bundle) {
    state.loading = true;
    state.updating = false;
    render();
  } else {
    state.updating = true;
    renderBanners();
  }

  try {
    const bundle = await fetchWeather(state.place, requestSettings(), abort.signal);
    if (abort.signal.aborted) return;
    state.bundle = bundle;
    state.fetchedAt = Date.now();
    state.stale = false;
    state.loading = false;
    state.updating = false;
    state.error = "";
    if (!state.demo) writeCache(state.place, bundle, state.fetchedAt);
    const zone = timeZone();
    if (zone && state.place.timeZone !== zone) {
      state.place = { ...state.place, timeZone: zone };
      localStorage.setItem("sunny.place", JSON.stringify(state.place));
    }
    render();
    const where = state.place.region ? `${state.place.name}, ${state.place.region}` : state.place.name;
    announce(`${state.demo ? "Demo forecast" : "Forecast"} for ${where}.`);
  } catch (error) {
    if (error?.name === "AbortError" || abort.signal.aborted) return;
    state.loading = false;
    state.updating = false;
    state.error = error.message || "Weather could not be loaded.";
    if (!state.bundle) state.stale = false;
    render();
  }
}

function requestSettings() {
  return { ...state.settings, demo: state.demo };
}

function render() {
  const scrollY = window.scrollY;
  renderBanners();
  if (state.loading && !state.bundle) {
    els.main.innerHTML = skeletonHtml();
    els.main.setAttribute("aria-busy", "true");
    return;
  }
  els.main.setAttribute("aria-busy", state.updating ? "true" : "false");
  document.body.dataset.sky = skyFromCondition(
    state.bundle?.current?.weatherCondition?.type,
    state.bundle?.current?.isDaytime !== false,
  );
  if (!state.bundle) {
    els.main.innerHTML = `<section class="panel empty"><h1>Weather unavailable</h1><p>${escapeHtml(state.error || "Something went wrong.")}</p><div class="empty-actions"><button type="button" class="btn" data-action="retry">Try again</button>${state.demo ? "" : `<button type="button" class="btn btn-quiet" data-action="demo">Preview sample data</button>`}</div></section>`;
    return;
  }
  els.main.innerHTML = layoutHtml();
  if (scrollY) window.scrollTo(0, scrollY);
}

function renderBanners() {
  const items = [];
  if (state.demo) {
    items.push(`<div class="banner banner-demo" role="status"><strong>Demo mode.</strong> This is sample weather so you can preview Sunny. It is not live Google data. Add a key in Settings for live conditions.</div>`);
  }
  if (state.offline) {
    items.push(`<div class="banner banner-offline" role="status">${state.bundle ? "You are offline. Showing the last saved forecast." : "You are offline."}</div>`);
  }
  if (state.stale && state.error) {
    items.push(`<div class="banner banner-stale" role="status">Could not refresh (${escapeHtml(state.error)}). Showing saved data.</div>`);
  } else if (state.error && state.bundle && !state.stale) {
    items.push(`<div class="banner banner-error" role="alert">${escapeHtml(state.error)}</div>`);
  }
  if (state.updating) {
    items.push(`<div class="banner banner-update" role="status">Updating forecast…</div>`);
  }
  els.banners.innerHTML = items.join("");
}

function layoutHtml() {
  const bundle = state.bundle;
  const zone = timeZone();
  const current = bundle.current || {};
  const hours = (bundle.hours?.forecastHours || []).slice(0, HOURS_SHOWN);
  const days = bundle.days?.forecastDays || [];
  const selected = hours[state.selectedHour] || hours[0];
  const rainy = rainyHours(bundle.hours?.forecastHours || [], zone, new Date(), RAIN_THRESHOLD);
  const dark = state.theme === "dark";
  const saved = isFavorite(state.place);
  const condition = current.weatherCondition?.description?.text || "Conditions unavailable";
  const temp = formatTemp(degreesOf(current.temperature), state.unit);
  const feels = formatTemp(degreesOf(current.feelsLikeTemperature), state.unit);
  const updated = state.fetchedAt ? `Updated ${formatClock(new Date(state.fetchedAt), zone)}` : "";

  return `<div class="layout">
    <div class="primary">
      <section class="hero" aria-labelledby="place-name">
        <div class="hero-top">
          <div>
            <p class="eyebrow">${escapeHtml(formatLongDate(new Date(), zone))} · ${escapeHtml(zoneOffsetLabel(new Date(), zone))}</p>
            <h1 id="place-name">${escapeHtml(state.place.name)}</h1>
            ${state.place.region ? `<p class="region">${escapeHtml(state.place.region)}</p>` : ""}
          </div>
          <button type="button" class="btn btn-save" data-action="favorite" aria-pressed="${saved ? "true" : "false"}">${saved ? "Saved" : "Save"}</button>
        </div>
        <div class="hero-main">
          ${iconImg(current.weatherCondition, current.isDaytime !== false, dark, "hero-icon")}
          <div>
            <p class="temp" aria-label="${escapeHtml(formatTempSpoken(degreesOf(current.temperature), state.unit))}">${temp}</p>
            <p class="feels">Feels like ${feels}</p>
            <p class="condition">${escapeHtml(condition)}</p>
          </div>
        </div>
        <dl class="stats">
          ${stat("Humidity", current.relativeHumidity != null ? `${current.relativeHumidity}%` : "—")}
          ${stat("Wind", windLabel(current.wind))}
          ${stat("UV", uvLabel(current.uvIndex))}
          ${stat("Precipitation", popLabel(current.precipitation))}
        </dl>
        ${sunHtml(days[0], zone)}
        <p class="updated"><span>${escapeHtml(updated)}</span> <button type="button" class="btn btn-quiet" data-action="retry">Refresh</button></p>
      </section>
      ${rainHtml(rainy)}
    </div>
    <aside class="side">
      ${alertsHtml(bundle, zone)}
      ${detailsHtml(current)}
    </aside>
    <section class="panel hourly" aria-labelledby="hourly-title">
      <div class="panel-head">
        <h2 id="hourly-title">Hourly</h2>
        <div class="tabs" role="tablist" aria-label="Hourly chart">
          ${tab("temp", "Temperature")}
          ${tab("precip", "Precipitation")}
          ${tab("wind", "Wind")}
        </div>
      </div>
      <div class="rail" role="listbox" aria-label="Next 24 hours" tabindex="0">${hours.map((hour, index) => railItem(hour, index, dark)).join("")}</div>
      <div class="chart-wrap" role="tabpanel">${renderChart({ hours, mode: state.chartTab, unit: state.unit, selectedIndex: state.selectedHour })}</div>
      ${selected ? `<p class="hour-detail">${hourDetail(selected)}</p>` : ""}
      ${hoursTable(hours)}
    </section>
    <section class="panel daily" aria-labelledby="daily-title">
      <div class="panel-head"><h2 id="daily-title">10-day forecast</h2></div>
      <ol class="day-list">${days.slice(0, 10).map((day, index) => dayRow(day, index, zone, dark)).join("")}</ol>
    </section>
  </div>`;
}

function stat(label, value) {
  return `<div class="stat"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function tab(id, label) {
  const selected = state.chartTab === id;
  return `<button type="button" class="tab" role="tab" data-chart-tab="${id}" aria-selected="${selected ? "true" : "false"}">${label}</button>`;
}

function windLabel(wind) {
  if (!wind?.speed) return "—";
  const speed = formatSpeed(wind.speed.value, state.unit);
  const dir = cardinalLabel(wind.direction?.cardinal);
  return dir ? `${speed} ${dir}` : speed;
}

function uvLabel(index) {
  if (index == null || index === "") return "—";
  const category = uvCategory(index);
  return category ? `${index} ${category}` : String(index);
}

function popLabel(precipitation) {
  const percent = precipPercent(precipitation);
  if (percent == null) return "—";
  return `${percent}%`;
}

function sunHtml(day, zone) {
  const sun = day?.sunEvents;
  if (!sun?.sunriseTime && !sun?.sunsetTime) return "";
  const rise = sun.sunriseTime ? formatClock(new Date(sun.sunriseTime), zone) : "—";
  const set = sun.sunsetTime ? formatClock(new Date(sun.sunsetTime), zone) : "—";
  return `<div class="sun-row"><span>Sunrise <strong>${escapeHtml(rise)}</strong></span><span>Sunset <strong>${escapeHtml(set)}</strong></span></div>`;
}

function rainHtml(hours) {
  if (!hours.length) return "";
  const chips = hours.map((hour) => {
    const percent = precipPercent(hour.precipitation);
    return `<li><span>${escapeHtml(formatHourLabel(hour))}</span> <strong>${percent}%</strong></li>`;
  }).join("");
  return `<section class="rain" aria-label="Rain warning">
    <h2>Rain likely today</h2>
    <p>These hours are above ${RAIN_THRESHOLD}% precipitation chance.</p>
    <ul class="rain-hours">${chips}</ul>
  </section>`;
}

function alertsHtml(bundle, zone) {
  const alerts = bundle.alerts?.weatherAlerts || [];
  if (bundle.alertsError && !alerts.length) {
    return `<section class="panel"><h2>Alerts</h2><p class="muted">Weather alerts could not be loaded. ${escapeHtml(bundle.alertsError.message || "")}</p></section>`;
  }
  if (!alerts.length) {
    return `<section class="panel"><h2>Alerts</h2><p class="muted">No active weather alerts for this location.</p></section>`;
  }
  const cards = alerts.map((alert) => {
    const title = alert.alertTitle?.text || alert.eventType || "Weather alert";
    const severity = String(alert.severity || "unknown").toLowerCase();
    const tone = ["extreme", "severe", "moderate", "minor"].includes(severity) ? severity : "unknown";
    const when = alertTime(alert, zone);
    const instructions = asList(alert.instruction).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const safety = (alert.safetyRecommendations || []).map((item) => `<li><strong>${escapeHtml(item.directive || "")}</strong> ${escapeHtml(item.subtext || "")}</li>`).join("");
    const source = alert.dataSource?.authorityUri
      ? `<a href="${escapeHtml(alert.dataSource.authorityUri)}" rel="noopener noreferrer">${escapeHtml(alert.dataSource.name || "Source")}</a>`
      : escapeHtml(alert.dataSource?.name || "");
    return `<article class="alert alert-${tone}">
      <p class="alert-kicker">${escapeHtml(severity === "unknown" ? "Alert" : severity)}</p>
      <h3>${escapeHtml(title)}</h3>
      ${alert.areaName ? `<p class="muted">${escapeHtml(alert.areaName)}</p>` : ""}
      ${when ? `<p class="muted">${escapeHtml(when)}</p>` : ""}
      ${alert.description ? `<p class="alert-body">${escapeHtml(alert.description)}</p>` : ""}
      ${instructions}
      ${safety ? `<ul class="safety">${safety}</ul>` : ""}
      ${source ? `<p class="source">Source: ${source}</p>` : ""}
    </article>`;
  }).join("");
  return `<section class="alerts" aria-labelledby="alerts-title"><h2 id="alerts-title">Alerts</h2>${cards}</section>`;
}

function detailsHtml(current) {
  const rows = [
    ["Dew point", formatTemp(degreesOf(current.dewPoint), state.unit)],
    ["Pressure", current.airPressure?.meanSeaLevelMillibars ? `${Math.round(current.airPressure.meanSeaLevelMillibars)} hPa` : "—"],
    ["Cloud cover", current.cloudCover != null ? `${current.cloudCover}%` : "—"],
    ["Visibility", formatDistance(current.visibility?.distance, state.unit)],
    ["Gusts", current.wind?.gust ? formatSpeed(current.wind.gust.value, state.unit) : "—"],
    ["Thunderstorm", current.thunderstormProbability != null ? `${current.thunderstormProbability}%` : "—"],
  ];
  return `<section class="panel details"><h2>Details</h2><dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><p class="source">Conditions and forecast from Google Weather.</p></section>`;
}

function railItem(hour, index, dark) {
  const selected = index === state.selectedHour;
  const pop = precipPercent(hour.precipitation);
  return `<button type="button" class="rail-item${selected ? " is-selected" : ""}" data-hour="${index}" role="option" aria-selected="${selected ? "true" : "false"}">
    <span>${escapeHtml(formatHourLabel(hour))}</span>
    ${iconImg(hour.weatherCondition, hour.isDaytime !== false, dark, "rail-icon")}
    <strong>${formatTemp(degreesOf(hour.temperature), state.unit)}</strong>
    <span class="rail-pop">${pop == null ? "" : `${pop}%`}</span>
  </button>`;
}

function hourDetail(hour) {
  const desc = hour.weatherCondition?.description?.text || "";
  const amount = formatAmount(hour.precipitation?.qpf?.quantity, state.unit);
  const bits = [
    formatHourLabel(hour),
    desc,
    formatTemp(degreesOf(hour.temperature), state.unit),
    `feels like ${formatTemp(degreesOf(hour.feelsLikeTemperature), state.unit)}`,
    precipPercent(hour.precipitation) != null ? `${precipPercent(hour.precipitation)}% chance of precipitation` : "",
    amount ? amount : "",
    `wind ${windLabel(hour.wind)}`,
  ].filter(Boolean);
  return escapeHtml(bits.join(" · "));
}

function hoursTable(hours) {
  const rows = hours.map((hour) => `<tr>
    <td>${escapeHtml(formatHourLabel(hour))}</td>
    <td>${escapeHtml(hour.weatherCondition?.description?.text || "")}</td>
    <td>${formatTemp(degreesOf(hour.temperature), state.unit)}</td>
    <td>${precipPercent(hour.precipitation) == null ? "—" : `${precipPercent(hour.precipitation)}%`}</td>
    <td>${escapeHtml(windLabel(hour.wind))}</td>
  </tr>`).join("");
  return `<div class="sr-only"><table><caption>Next 24 hours</caption><thead><tr><th>Time</th><th>Condition</th><th>Temperature</th><th>Precipitation probability</th><th>Wind</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function dayRow(day, index, zone, dark) {
  const date = day.displayDate || {};
  const key = date.year ? dateKey(date.year, date.month, date.day) : "";
  const today = dateKeyInZone(new Date(), zone);
  const tomorrowDate = new Date(Date.now() + 86400000);
  const tomorrow = dateKeyInZone(tomorrowDate, zone);
  let label = date.year ? weekdayFromCivil(date.year, date.month, date.day) : "";
  if (key && key === today) label = "Today";
  else if (key && key === tomorrow) label = "Tomorrow";
  const part = day.daytimeForecast || day.fullDayForecast || day.nighttimeForecast || {};
  const night = day.nighttimeForecast || {};
  const pop = Math.max(precipPercent(part.precipitation) ?? 0, precipPercent(night.precipitation) ?? 0);
  const high = formatTemp(degreesOf(day.maxTemperature), state.unit);
  const low = formatTemp(degreesOf(day.minTemperature), state.unit);
  return `<li class="day-row">
    <span class="day-name">${escapeHtml(label)}</span>
    ${iconImg(part.weatherCondition, true, dark, "day-icon")}
    <span class="day-pop">${pop}%</span>
    <span class="day-temps"><strong>${high}</strong><span>${low}</span></span>
  </li>`;
}

function iconImg(condition, isDaytime, dark, className) {
  const url = iconUrl(condition, { isDaytime, dark });
  return `<img class="${className}" src="${escapeHtml(url)}" alt="" width="48" height="48" data-fallback="${escapeHtml(condition?.type || "")}" data-daytime="${isDaytime ? "1" : "0"}">`;
}

function skeletonHtml() {
  return `<div class="layout" aria-hidden="true">
    <div class="primary"><div class="hero skeleton-card"><div class="skeleton sk-line"></div><div class="skeleton sk-temp"></div><div class="skeleton sk-stats"></div></div></div>
    <div class="side"><div class="panel skeleton-card"><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div></div></div>
    <div class="panel skeleton-card"><div class="skeleton sk-chart"></div></div>
  </div>`;
}

function onMainClick(event) {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "retry") loadWeather();
  if (action === "favorite") toggleFavorite();
  if (action === "demo") useDemo();
  const tab = event.target.closest("[data-chart-tab]")?.dataset.chartTab;
  if (tab && tab !== state.chartTab) {
    state.chartTab = tab;
    render();
  }
  const hourButton = event.target.closest("[data-hour]");
  if (hourButton && !hourButton.closest(".chart")) {
    state.selectedHour = Number(hourButton.dataset.hour);
    render();
  }
  const hit = event.target.closest(".chart .hit");
  if (hit) {
    state.selectedHour = Number(hit.dataset.hour);
    render();
    document.querySelector(`.rail-item[data-hour="${state.selectedHour}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }
}

function onMainKeydown(event) {
  const rail = event.target.closest(".rail");
  if (!rail) return;
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const count = state.bundle?.hours?.forecastHours?.slice(0, HOURS_SHOWN).length || 0;
  const next = state.selectedHour + (event.key === "ArrowRight" ? 1 : -1);
  state.selectedHour = Math.max(0, Math.min(count - 1, next));
  render();
  const selected = document.querySelector(".rail-item.is-selected");
  selected?.focus();
  selected?.scrollIntoView({ inline: "center", block: "nearest" });
}

function onIconError(event) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.src.includes("_dark") && !img.dataset.triedLight) {
    img.dataset.triedLight = "1";
    img.src = img.src.replace("_dark.svg", ".svg");
    return;
  }
  img.outerHTML = fallbackIconSvg(img.dataset.fallback || "");
}

function toggleFavorite() {
  const key = placeKey(state.place);
  if (isFavorite(state.place)) {
    state.favorites = state.favorites.filter((place) => placeKey(place) !== key);
    announce(`${state.place.name} removed from saved cities.`);
  } else {
    state.favorites = [{ ...state.place }, ...state.favorites].slice(0, 16);
    announce(`${state.place.name} saved.`);
  }
  localStorage.setItem("sunny.favorites", JSON.stringify(state.favorites));
  render();
}

function isFavorite(place) {
  const key = placeKey(place);
  return state.favorites.some((item) => placeKey(item) === key);
}

function setUnit(unit) {
  if (unit !== "c" && unit !== "f") return;
  state.unit = unit;
  localStorage.setItem("sunny.unit", unit);
  syncUnitButtons();
  if (state.bundle) render();
}

function syncUnitButtons() {
  document.querySelectorAll("[data-unit]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.unit === state.unit ? "true" : "false");
  });
}

function applyTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("sunny.theme", state.theme);
  const color = state.theme === "dark" ? "#10141a" : "#f3efe6";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  els.themeButton.textContent = state.theme === "dark" ? "Light" : "Dark";
  els.themeButton.setAttribute("aria-label", state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  const type = state.bundle?.current?.weatherCondition?.type;
  const daytime = state.bundle?.current?.isDaytime !== false;
  document.body.dataset.sky = skyFromCondition(type, daytime);
}

function openSettings() {
  els.keyInput.value = state.settings.apiKey || "";
  els.proxyInput.value = state.settings.proxyBase || "";
  els.forceDemo.checked = Boolean(state.settings.forceDemo);
  els.settingsError.textContent = "";
  els.settings.showModal();
  els.keyInput.focus();
}

function saveSettings(event) {
  event.preventDefault();
  let proxyBase = "";
  try {
    proxyBase = normalizeProxyBase(els.proxyInput.value);
  } catch (error) {
    els.settingsError.textContent = error.message;
    return;
  }
  state.settings = writeStoredSettings({
    apiKey: els.keyInput.value,
    proxyBase,
    forceDemo: els.forceDemo.checked,
  });
  state.settings = resolveSettings(state.settings, {}, {});
  els.settings.close();
  state.bundle = null;
  loadWeather();
}

function useDemo() {
  state.settings = writeStoredSettings({ ...state.settings, forceDemo: true });
  state.settings = resolveSettings(state.settings, {}, {});
  state.bundle = null;
  loadWeather();
}

function openFavorites() {
  renderFavorites();
  els.favorites.showModal();
}

function renderFavorites() {
  if (!state.favorites.length) {
    els.favoriteList.innerHTML = `<li class="muted">No saved cities yet. Use Save on a forecast to keep it here.</li>`;
    return;
  }
  els.favoriteList.innerHTML = state.favorites.map((place, index) => `<li>
    <button type="button" data-fav-open="${index}"><span>${escapeHtml(place.name)}</span><span class="muted">${escapeHtml(place.region || "")}</span></button>
    <button type="button" class="btn btn-quiet" data-fav-remove="${index}">Remove</button>
  </li>`).join("");
}

function onFavoriteClick(event) {
  const open = event.target.closest("[data-fav-open]");
  const remove = event.target.closest("[data-fav-remove]");
  if (open) {
    const place = state.favorites[Number(open.dataset.favOpen)];
    els.favorites.close();
    if (place) selectPlace(place);
  }
  if (remove) {
    state.favorites.splice(Number(remove.dataset.favRemove), 1);
    localStorage.setItem("sunny.favorites", JSON.stringify(state.favorites));
    renderFavorites();
    render();
  }
}

function onSearchInput() {
  window.clearTimeout(state.searchTimer);
  const query = els.search.value;
  state.searchTimer = window.setTimeout(() => runSearch(query), 250);
}

async function runSearch(query) {
  const seq = ++state.searchSeq;
  if (query.trim().length < 2) {
    closeSearch();
    return;
  }
  try {
    const results = await searchCities(query, requestSettings(), new AbortController().signal);
    if (seq !== state.searchSeq) return;
    state.searchResults = results;
    state.searchActive = results.length ? 0 : -1;
    renderSearch();
  } catch (error) {
    if (seq !== state.searchSeq) return;
    state.searchResults = [];
    els.searchList.hidden = false;
    els.search.setAttribute("aria-expanded", "true");
    els.searchList.innerHTML = `<li class="muted" role="presentation">${escapeHtml(error.message || "Search failed.")}</li>`;
  }
}

function renderSearch() {
  if (!state.searchResults.length) {
    els.searchList.hidden = false;
    els.search.setAttribute("aria-expanded", "true");
    els.searchList.innerHTML = `<li class="muted" role="presentation">${state.demo ? "No matching sample cities." : "No matching cities."}</li>`;
    return;
  }
  els.searchList.hidden = false;
  els.search.setAttribute("aria-expanded", "true");
  els.searchList.innerHTML = state.searchResults.map((place, index) => `<li role="option" id="search-opt-${index}" aria-selected="${index === state.searchActive ? "true" : "false"}">
    <button type="button" data-result="${index}"><span>${escapeHtml(place.name)}</span><span class="muted">${escapeHtml(place.region || "")}</span></button>
  </li>`).join("") + (state.demo ? `<li class="search-note" role="presentation">Sample cities in demo mode</li>` : `<li class="search-note" role="presentation">Search by Google</li>`);
  const active = state.searchActive >= 0 ? `search-opt-${state.searchActive}` : "";
  if (active) els.search.setAttribute("aria-activedescendant", active);
}

function onSearchKeydown(event) {
  if (event.key === "Escape") {
    closeSearch();
    return;
  }
  if (!state.searchResults.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const count = state.searchResults.length;
    state.searchActive = (state.searchActive + delta + count) % count;
    renderSearch();
  }
}

async function chooseSearch(index) {
  const result = state.searchResults[index];
  if (!result) return;
  closeSearch();
  els.search.value = result.name;
  if (result.placeId && !state.demo) {
    try {
      const place = await lookupPlace(result.placeId, requestSettings(), new AbortController().signal);
      selectPlace(place);
      return;
    } catch (error) {
      state.error = error.message || "That city could not be opened.";
      renderBanners();
      return;
    }
  }
  if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) selectPlace(result);
}

function closeSearch() {
  state.searchResults = [];
  state.searchActive = -1;
  els.searchList.hidden = true;
  els.searchList.innerHTML = "";
  els.search.setAttribute("aria-expanded", "false");
  els.search.removeAttribute("aria-activedescendant");
}

async function install() {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  els.installButton.hidden = true;
}

function timeZone() {
  return state.bundle?.current?.timeZone?.id
    || state.bundle?.hours?.timeZone?.id
    || state.bundle?.days?.timeZone?.id
    || state.place.timeZone
    || "UTC";
}

function alertTime(alert, zone) {
  const start = alert.startTime ? formatClock(new Date(alert.startTime), zone) : "";
  const end = alert.expirationTime ? formatClock(new Date(alert.expirationTime), zone) : "";
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  return "";
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function announce(message) {
  els.live.textContent = "";
  window.setTimeout(() => {
    els.live.textContent = message;
  }, 30);
}

function loadPlace() {
  try {
    const saved = JSON.parse(localStorage.getItem("sunny.place") || "null");
    if (saved && Number.isFinite(Number(saved.lat)) && Number.isFinite(Number(saved.lng))) {
      return { ...DEFAULT_PLACE, ...saved, lat: Number(saved.lat), lng: Number(saved.lng) };
    }
  } catch {
    /* Use the default city. */
  }
  return { ...DEFAULT_PLACE };
}

function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem("sunny.favorites") || "[]");
    return Array.isArray(saved) ? saved.filter((place) => Number.isFinite(Number(place?.lat))) : [];
  } catch {
    return [];
  }
}

function cacheId(place) {
  return `sunny.forecast.${placeKey(place)}`;
}

function readCache(place) {
  try {
    const saved = JSON.parse(localStorage.getItem(cacheId(place)) || "null");
    if (!saved?.bundle) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeCache(place, bundle, fetchedAt) {
  try {
    const alerts = (bundle.alerts?.weatherAlerts || []).map(({ polygon, ...alert }) => alert);
    const slim = { ...bundle, alerts: { ...bundle.alerts, weatherAlerts: alerts } };
    localStorage.setItem(cacheId(place), JSON.stringify({ fetchedAt, bundle: slim }));
  } catch {
    /* A full cache is optional. */
  }
}

document.body.dataset.sky = "clear";
