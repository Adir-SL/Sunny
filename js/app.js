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
  DEFAULT_SECTIONS,
  defaultLayout,
  moveSection,
  readLayout,
  reorderSection,
  setSectionVisible,
  writeLayout,
} from "./layout.js";
import {
  hasLiveCredential,
  normalizeProxyBase,
  readStoredSettings,
  resolveSettings,
  writeStoredSettings,
} from "./settings.js";

const HOURS_SHOWN = 24;
const state = {
  settings: { apiKey: "", proxyBase: "", source: "file" },
  fileConfig: {},
  publicConfig: {},
  demo: true,
  place: { ...DEFAULT_PLACE },
  locating: true,
  locationSource: "pending",
  locationNote: "",
  favorites: loadFavorites(),
  unit: localStorage.getItem("sunny.unit") === "f" ? "f" : "c",
  themePref: document.documentElement.dataset.themePref || "system",
  theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  layout: readLayout(localStorage),
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
  favoriteList: document.querySelector("#favorite-list"),
  sectionList: document.querySelector("#section-list"),
  keyInput: document.querySelector("#api-key"),
  proxyInput: document.querySelector("#proxy-base"),
  settingsError: document.querySelector("#settings-error"),
  locationChip: document.querySelector("#location-chip"),
  installButton: document.querySelector("#install"),
  savePlace: document.querySelector("#save-place"),
  places: document.querySelector("#places"),
  placesTabs: document.querySelector("#places-tabs"),
  placesSearch: document.querySelector("#places-search"),
  placesInput: document.querySelector("#places-input"),
  placesList: document.querySelector("#places-list"),
  confirmClose: document.querySelector("#confirm-close"),
};
/** Which search box the shared search logic drives: the settings sheet or the places popover. */
let searchTarget = "settings";
const popoverSupported = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;
let drag = null;
let lastRenderedBundle = null;
/** Bumped whenever a place is chosen, so a slow device-location lookup can't override a newer choice. */
let locateSeq = 0;
let chipHtml = "";
let keyTimer = 0;

boot();

async function boot() {
  applyTheme(state.themePref, { persist: false });
  syncUnitButtons();
  const { fileConfig, publicConfig } = await loadConfigFiles();
  state.fileConfig = fileConfig;
  state.publicConfig = publicConfig;
  state.settings = resolveSettings(readStoredSettings(), fileConfig, publicConfig);
  state.demo = !hasLiveCredential(state.settings);
  bind();
  registerWorker();
  renderSectionList();
  renderFavorites();
  const saved = readPlace();
  if (saved) {
    state.place = saved.place;
    state.locationSource = saved.source;
    state.locationNote = saved.note;
    state.locating = false;
    renderLocationChip();
    await loadWeather();
    return;
  }
  renderLocationChip();
  await locate();
}

function bind() {
  document.querySelector("#locate").addEventListener("click", locate);
  document.querySelector("#refresh-forecast").addEventListener("click", () => loadWeather());
  document.querySelector("#save-place").addEventListener("click", toggleFavorite);
  document.querySelectorAll("[data-unit]").forEach((button) => {
    button.addEventListener("click", () => setUnit(button.dataset.unit));
  });
  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.theme);
      render();
    });
  });
  document.querySelector("#settings-open").addEventListener("click", openSettings);
  document.querySelector("#settings-close").addEventListener("click", () => els.settings.close());
  document.querySelector("#reset-layout").addEventListener("click", () => {
    state.layout = defaultLayout();
    writeLayout(state.layout, localStorage);
    renderSectionList();
    render();
  });
  document.querySelector("#clear-key").addEventListener("click", () => {
    els.keyInput.value = "";
    els.proxyInput.value = "";
    commitKeys();
  });
  els.keyInput.addEventListener("input", scheduleKeySave);
  els.proxyInput.addEventListener("input", scheduleKeySave);
  els.keyInput.addEventListener("change", commitKeys);
  els.proxyInput.addEventListener("change", commitKeys);
  bindSectionList();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.themePref === "system") {
      applyTheme("system");
      render();
    }
  });
  els.search.addEventListener("input", onSearchInput);
  els.search.addEventListener("keydown", onSearchKeydown);
  els.search.addEventListener("focus", () => { searchTarget = "settings"; });
  bindPlaces();
  document.querySelector("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    searchTarget = "settings";
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

function readDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error("Geolocation is unavailable."), { code: 2 }));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 60000,
    });
  });
}

async function locate() {
  const run = ++locateSeq;
  state.locating = true;
  state.locationSource = "pending";
  state.locationNote = "";
  renderLocationChip();
  renderBanners();
  if (!state.bundle) els.main.innerHTML = `<p class="muted">Finding your location…</p>`;
  announce("Finding your location…");
  try {
    const position = await readDevicePosition();
    if (run !== locateSeq) return;
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    let place = { name: "Current location", region: "", lat, lng, unnamed: true };
    try {
      place = await reverseGeocode(lat, lng, requestSettings(), new AbortController().signal);
    } catch {
      place = { ...place, unnamed: true };
    }
    if (run !== locateSeq) return;
    state.locating = false;
    const unnamed = place.unnamed || place.name === "Current location";
    state.locationNote = unnamed && !state.demo
      ? "Google could not name these coordinates. The forecast still uses your location."
      : "";
    selectPlace({ ...place, unnamed }, "device", { fromLocate: true });
  } catch (error) {
    if (run !== locateSeq) return;
    state.locating = false;
    const denied = error?.code === 1;
    state.locationSource = "fallback";
    state.locationNote = denied
      ? "Location access was denied, so this forecast is for Ramat Gan, Israel."
      : "Your location is unavailable, so this forecast is for Ramat Gan, Israel.";
    state.place = { ...DEFAULT_PLACE };
    state.selectedHour = 0;
    announce(state.locationNote);
    writePlace();
    renderLocationChip();
    loadWeather();
  }
}

function selectPlace(place, source = "search", { fromLocate = false } = {}) {
  if (!fromLocate) locateSeq += 1; // cancel any pending locate()
  state.locationSource = source;
  if (source !== "device") state.locationNote = "";
  state.locating = false;
  state.place = {
    name: place.name || "Selected place",
    region: place.region || "",
    lat: Number(place.lat),
    lng: Number(place.lng),
    timeZone: place.timeZone || state.place.timeZone || DEFAULT_PLACE.timeZone,
    unnamed: Boolean(place.unnamed) || place.name === "Current location",
  };
  state.selectedHour = 0;
  closeSearch();
  if (els.search) els.search.value = "";
  if (els.placesInput) els.placesInput.value = "";
  if (source === "search" && !state.place.unnamed && !isFavorite(state.place)) {
    state.favorites.push({ ...state.place });
    saveFavorites();
    renderFavorites();
  }
  writePlace();
  renderLocationChip();
  syncSaveButton();
  loadWeather();
}

async function loadWeather() {
  state.weatherAbort?.abort();
  const abort = new AbortController();
  state.weatherAbort = abort;
  state.error = "";
  state.demo = !hasLiveCredential(state.settings);
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
    renderLocationChip();
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
  renderLocationChip();
  syncSaveButton();
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
    els.main.innerHTML = `<section class="panel empty"><h1>Weather unavailable</h1><p>${escapeHtml(state.error || "Something went wrong.")}</p><div class="empty-actions"><button type="button" class="btn" data-action="retry">Try again</button></div></section>`;
    return;
  }
  // Re-rendering replaces the hourly rail, so carry its scroll position (and focus)
  // over when it's the same forecast, e.g. after tapping an hour.
  const sameForecast = state.bundle === lastRenderedBundle;
  const oldRail = els.main.querySelector(".rail");
  const railScroll = sameForecast && oldRail ? oldRail.scrollLeft : 0;
  const railFocused = sameForecast && Boolean(document.activeElement?.closest?.(".rail"));
  els.main.innerHTML = layoutHtml();
  lastRenderedBundle = state.bundle;
  const rail = els.main.querySelector(".rail");
  if (rail && railScroll) rail.scrollLeft = railScroll;
  if (rail && railFocused) rail.querySelector(".rail-item.is-selected")?.focus({ preventScroll: true });
  if (scrollY) window.scrollTo(0, scrollY);
}

function renderBanners() {
  const items = [];
  if (state.demo) {
    items.push(`<div class="banner banner-demo" role="status"><strong>Sample forecast.</strong> Add a Google API key in Settings to load live Google Weather. A key also names your location. This page stays on sample data until a key or proxy is set.</div>`);
  }
  if (state.locationNote) {
    items.push(`<div class="banner banner-fallback" role="status">${escapeHtml(state.locationNote)}</div>`);
  }
  if (state.offline) {
    items.push(`<div class="banner banner-offline" role="status">${state.bundle ? "You are offline. Showing the last saved forecast." : "You are offline."}</div>`);
  }
  if (state.stale && state.error) {
    items.push(`<div class="banner banner-stale" role="status">Could not refresh (${escapeHtml(state.error)}). Showing saved data.</div>`);
  } else if (state.error && state.bundle && !state.stale) {
    items.push(`<div class="banner banner-error" role="alert">${escapeHtml(state.error)}</div>`);
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
  const condition = current.weatherCondition?.description?.text || "Conditions unavailable";
  const temp = formatTemp(degreesOf(current.temperature), state.unit);
  const feels = formatTemp(degreesOf(current.feelsLikeTemperature), state.unit);
  const high = formatTemp(degreesOf(days[0]?.maxTemperature), state.unit);
  const low = formatTemp(degreesOf(days[0]?.minTemperature), state.unit);
  const feelsLine = feels === "—" ? "" : `Feels like ${feels}`;
  const highSpoken = formatTempSpoken(degreesOf(days[0]?.maxTemperature), state.unit);
  const lowSpoken = formatTempSpoken(degreesOf(days[0]?.minTemperature), state.unit);
  const extremes = high === "—" && low === "—" ? "" : `<div class="hl" role="group" aria-label="High ${escapeHtml(highSpoken)}, low ${escapeHtml(lowSpoken)}">
            <p><span class="hl-k">High</span> <strong>${high}</strong></p>
            <p><span class="hl-k">Low</span> <strong>${low}</strong></p>
          </div>`;

  const blocks = {
    current: () => `<section class="hero" aria-labelledby="place-name">
        <div class="hero-body">
          <div class="hero-readout">
            <p class="eyebrow">${escapeHtml(formatLongDate(new Date(), zone))} <span class="zone">· ${escapeHtml(zoneOffsetLabel(new Date(), zone))}</span></p>
            <h1 id="place-name">${escapeHtml(placeTitle(state.place))}</h1>
            ${state.place.unnamed ? `<p class="region">Your location</p>` : state.place.region ? `<p class="region">${escapeHtml(state.place.region)}</p>` : ""}
            <p class="temp" aria-label="${escapeHtml(formatTempSpoken(degreesOf(current.temperature), state.unit))}">${temp}</p>
            ${extremes}
            ${feelsLine ? `<p class="feels">${escapeHtml(feelsLine)}</p>` : ""}
          </div>
          <div class="hero-side">
            ${iconImg(current.weatherCondition, current.isDaytime !== false, "hero-icon", { animated: true })}
            <p class="condition">${escapeHtml(condition)}</p>
            ${todayHtml(days[0], zone)}
          </div>
        </div>
        <dl class="stats">
          ${stat("Humidity", current.relativeHumidity != null ? `${current.relativeHumidity}%` : "—")}
          ${stat("Wind", windLabel(current.wind))}
          ${stat("UV", uvLabel(current.uvIndex))}
          ${stat("Precipitation", popLabel(current.precipitation))}
        </dl>
      </section>`,
    rain: () => rainHtml(rainy),
    alerts: () => alertsHtml(bundle, zone),
    hourly: () => `<section class="panel hourly" aria-labelledby="hourly-title">
      <div class="panel-head">
        <h2 id="hourly-title">Hourly</h2>
        <div class="tabs" role="tablist" aria-label="Hourly chart">
          ${tab("temp", "Temp", "Temperature")}
          ${tab("precip", "Precip", "Precipitation")}
          ${tab("wind", "Wind")}
        </div>
      </div>
      <div class="rail" role="listbox" aria-label="Next 24 hours" tabindex="0">${hours.map((hour, index) => railItem(hour, index)).join("")}</div>
      <div class="chart-wrap" role="tabpanel">${renderChart({ hours, mode: state.chartTab, unit: state.unit, selectedIndex: state.selectedHour })}</div>
      ${selected ? `<p class="hour-detail">${hourDetail(selected)}</p>` : ""}
      ${hoursTable(hours)}
    </section>`,
    daily: () => `<section class="panel daily" aria-labelledby="daily-title">
      <div class="panel-head"><h2 id="daily-title">10-day forecast</h2></div>
      <ol class="day-list">${days.slice(0, 10).map((day, index) => dayRow(day, index, zone)).join("")}</ol>
    </section>`,
    details: () => detailsHtml(current),
  };
  const cards = state.layout
    .filter((section) => section.visible && blocks[section.id])
    .map((section) => blocks[section.id]())
    .join("");
  return `<div class="cards">${cards || `<p class="muted">All cards are hidden. Open settings to show one.</p>`}</div>`;
}

function stat(label, value) {
  return `<div class="stat"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function tab(id, label, spoken = label) {
  const selected = state.chartTab === id;
  return `<button type="button" class="tab" role="tab" data-chart-tab="${id}" aria-selected="${selected ? "true" : "false"}" aria-label="${escapeHtml(spoken)}">${escapeHtml(label)}</button>`;
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

function sunGlyph(kind) {
  const path = kind === "rise"
    ? "M2.5 11.5h11M5 11.5a3 3 0 0 1 6 0M8 2.2v3.1M6.5 4.1 8 2.6l1.5 1.5"
    : "M2.5 10.2h11M5 10.2a3 3 0 0 1 6 0M8 13.8V10.7M6.5 12 8 13.5 9.5 12";
  const label = kind === "rise" ? "Sunrise" : "Sunset";
  return `<svg class="sun-mini" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><title>${label}</title><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="${path}"/></svg>`;
}

function todayHtml(day, zone) {
  const sun = day?.sunEvents;
  if (!sun?.sunriseTime && !sun?.sunsetTime) return "";
  const rise = sun.sunriseTime ? formatClock(new Date(sun.sunriseTime), zone) : "—";
  const set = sun.sunsetTime ? formatClock(new Date(sun.sunsetTime), zone) : "—";
  const sunLine = (kind, value) => `<p>${sunGlyph(kind)}<strong>${escapeHtml(value)}</strong><span class="sr-only">${kind === "rise" ? "sunrise" : "sunset"}</span></p>`;
  return `<div class="sun-stack">${sunLine("rise", rise)}${sunLine("set", set)}</div>`;
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

function railItem(hour, index) {
  const selected = index === state.selectedHour;
  const pop = precipPercent(hour.precipitation);
  return `<button type="button" class="rail-item${selected ? " is-selected" : ""}" data-hour="${index}" role="option" aria-selected="${selected ? "true" : "false"}">
    <span>${escapeHtml(formatHourLabel(hour))}</span>
    ${iconImg(hour.weatherCondition, hour.isDaytime !== false, "rail-icon")}
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

function dayRow(day, index, zone) {
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
    ${iconImg(part.weatherCondition, true, "day-icon")}
    <span class="day-pop">${pop}%</span>
    <span class="day-temps"><strong>${high}</strong><span>${low}</span></span>
  </li>`;
}

function iconImg(condition, isDaytime, className, { animated = false } = {}) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const url = iconUrl(condition, { isDaytime, animated: animated && !reduceMotion });
  return `<img class="${className}" src="${escapeHtml(url)}" alt="" width="64" height="64" decoding="async" data-fallback="${escapeHtml(condition?.type || "")}">`;
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
  saveFavorites();
  renderFavorites();
  syncSaveButton();
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

function applyTheme(pref, { persist = true } = {}) {
  state.themePref = pref === "light" || pref === "dark" ? pref : "system";
  state.theme = state.themePref === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : state.themePref;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.themePref = state.themePref;
  if (persist) localStorage.setItem("sunny.theme", state.themePref);
  const color = state.theme === "dark" ? "#000000" : "#ffffff";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  const faviconLight = document.getElementById("favicon-light");
  const faviconDark = document.getElementById("favicon-dark");
  if (faviconLight && faviconDark) {
    faviconLight.media = state.theme === "dark" ? "not all" : "all";
    faviconDark.media = state.theme === "dark" ? "all" : "not all";
  }
  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.theme === state.themePref ? "true" : "false");
  });
  const type = state.bundle?.current?.weatherCondition?.type;
  const daytime = state.bundle?.current?.isDaytime !== false;
  document.body.dataset.sky = skyFromCondition(type, daytime);
}

function openSettings() {
  els.keyInput.value = state.settings.apiKey || "";
  els.proxyInput.value = state.settings.proxyBase || "";
  els.settingsError.textContent = "";
  renderSectionList();
  renderFavorites();
  syncSaveButton();
  if (!els.settings.open) els.settings.showModal();
}

function scheduleKeySave() {
  window.clearTimeout(keyTimer);
  keyTimer = window.setTimeout(() => { commitKeys(); }, 400);
}

async function commitKeys() {
  window.clearTimeout(keyTimer);
  let proxyBase = state.settings.proxyBase;
  try {
    proxyBase = normalizeProxyBase(els.proxyInput.value);
    els.settingsError.textContent = "";
  } catch (error) {
    els.settingsError.textContent = error.message;
    return;
  }
  const nextKey = els.keyInput.value.trim();
  if (nextKey === state.settings.apiKey && proxyBase === state.settings.proxyBase) return;
  const stored = writeStoredSettings({ apiKey: nextKey, proxyBase });
  state.settings = resolveSettings(stored, state.fileConfig, state.publicConfig);
  state.demo = !hasLiveCredential(state.settings);
  if (state.locationSource === "device") {
    try {
      const named = await reverseGeocode(state.place.lat, state.place.lng, requestSettings(), new AbortController().signal);
      state.place = { ...state.place, ...named, unnamed: Boolean(named.unnamed) || named.name === "Current location" };
      state.locationNote = state.place.unnamed && !state.demo
        ? "Google could not name these coordinates. The forecast still uses your location."
        : "";
      writePlace();
    } catch {
      /* Keep the coordinates already on screen. */
    }
  }
  state.bundle = null;
  renderLocationChip();
  loadWeather();
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
    els.settings.close();
    if (place) selectPlace(place);
  }
  if (remove) {
    state.favorites.splice(Number(remove.dataset.favRemove), 1);
    saveFavorites();
    renderFavorites();
    renderPlaces();
    render();
  }
}

function sx() {
  return searchTarget === "places"
    ? { input: els.placesInput, list: els.placesList }
    : { input: els.search, list: els.searchList };
}

function onSearchInput() {
  window.clearTimeout(state.searchTimer);
  const query = sx().input.value;
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
    sx().list.hidden = false;
    sx().input.setAttribute("aria-expanded", "true");
    sx().list.innerHTML = `<li class="muted" role="presentation">${escapeHtml(error.message || "Search failed.")}</li>`;
  }
}

function renderSearch() {
  if (!state.searchResults.length) {
    sx().list.hidden = false;
    sx().input.setAttribute("aria-expanded", "true");
    sx().list.innerHTML = `<li class="muted" role="presentation">${state.demo ? "No matching sample cities." : "No matching cities."}</li>`;
    return;
  }
  sx().list.hidden = false;
  sx().input.setAttribute("aria-expanded", "true");
  sx().list.innerHTML = state.searchResults.map((place, index) => `<li role="option" id="${searchTarget}-opt-${index}" aria-selected="${index === state.searchActive ? "true" : "false"}">
    <button type="button" data-result="${index}"><span>${escapeHtml(place.name)}</span><span class="muted">${escapeHtml(place.region || "")}</span></button>
  </li>`).join("") + (state.demo ? `<li class="search-note" role="presentation">Sample cities in demo mode</li>` : `<li class="search-note" role="presentation">Search by Google</li>`);
  const active = state.searchActive >= 0 ? `${searchTarget}-opt-${state.searchActive}` : "";
  if (active) sx().input.setAttribute("aria-activedescendant", active);
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
  sx().input.value = result.name;
  if (result.placeId && !state.demo) {
    try {
      const place = await lookupPlace(result.placeId, requestSettings(), new AbortController().signal);
      closePanels();
      selectPlace(place);
      return;
    } catch (error) {
      state.error = error.message || "That city could not be opened.";
      renderBanners();
      return;
    }
  }
  if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
    closePanels();
    selectPlace(result);
  }
}

function closeSearch() {
  state.searchResults = [];
  state.searchActive = -1;
  sx().list.hidden = true;
  sx().list.innerHTML = "";
  sx().input.setAttribute("aria-expanded", "false");
  sx().input.removeAttribute("aria-activedescendant");
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

function syncSaveButton() {
  if (!els.savePlace) return;
  const saved = isFavorite(state.place);
  els.savePlace.textContent = saved ? "Saved" : "Save place";
  els.savePlace.setAttribute("aria-pressed", saved ? "true" : "false");
}

function renderSectionList() {
  if (!els.sectionList) return;
  els.sectionList.innerHTML = state.layout.map((item, index) => {
    const label = DEFAULT_SECTIONS.find((section) => section.id === item.id)?.label || item.id;
    const last = index === state.layout.length - 1;
    return `<li class="section-row" data-id="${escapeHtml(item.id)}">
      <button type="button" class="drag-handle" data-drag aria-label="Reorder ${escapeHtml(label)}. Use the arrow keys to move it."><svg class="grip" viewBox="0 0 20 14" width="20" height="14" aria-hidden="true"><path d="M2 2.25h16M2 7h16M2 11.75h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg></button>
      <span class="section-label">${escapeHtml(label)}</span>
      <button type="button" class="btn btn-quiet move" data-move="-1" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(label)} up">Up</button>
      <button type="button" class="btn btn-quiet move" data-move="1" ${last ? "disabled" : ""} aria-label="Move ${escapeHtml(label)} down">Down</button>
      <button type="button" class="switch" role="switch" data-visible aria-checked="${item.visible ? "true" : "false"}" aria-label="${item.visible ? "Hide" : "Show"} ${escapeHtml(label)}"><span class="switch-knob"></span></button>
    </li>`;
  }).join("");
}

function commitLayout() {
  writeLayout(state.layout, localStorage);
  render();
}

function bindSectionList() {
  const list = els.sectionList;
  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    const move = event.target.closest("[data-move]");
    if (move) {
      state.layout = moveSection(state.layout, id, Number(move.dataset.move));
      commitLayout();
      renderSectionList();
      list.querySelector(`[data-id="${CSS.escape(id)}"] [data-move="${move.dataset.move}"]`)?.focus();
      return;
    }
    if (event.target.closest("[data-visible]")) {
      const item = state.layout.find((section) => section.id === id);
      state.layout = setSectionVisible(state.layout, id, !item.visible);
      commitLayout();
      renderSectionList();
      list.querySelector(`[data-id="${CSS.escape(id)}"] [data-visible]`)?.focus();
    }
  });
  list.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-drag]");
    if (!handle || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const id = handle.closest("[data-id]").dataset.id;
    state.layout = moveSection(state.layout, id, event.key === "ArrowUp" ? -1 : 1);
    commitLayout();
    renderSectionList();
    list.querySelector(`[data-id="${CSS.escape(id)}"] [data-drag]`)?.focus();
  });
  list.addEventListener("pointerdown", onSectionPointerDown);
  list.addEventListener("pointermove", onSectionPointerMove);
  list.addEventListener("pointerup", endSectionDrag);
  list.addEventListener("pointercancel", endSectionDrag);
}

function onSectionPointerDown(event) {
  const handle = event.target.closest("[data-drag]");
  if (!handle || event.button > 0) return;
  const row = handle.closest("[data-id]");
  drag = { id: row.dataset.id, pointerId: event.pointerId };
  row.classList.add("is-dragging");
  handle.setPointerCapture(event.pointerId);
}

function onSectionPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const list = els.sectionList;
  const rows = [...list.querySelectorAll(".section-row")];
  const dragRow = list.querySelector(`[data-id="${CSS.escape(drag.id)}"]`);
  if (!dragRow) return;
  let newIndex = rows.length - 1;
  for (let index = 0; index < rows.length; index += 1) {
    const box = rows[index].getBoundingClientRect();
    if (event.clientY < box.top + box.height / 2) {
      newIndex = index;
      break;
    }
  }
  const current = rows.indexOf(dragRow);
  if (newIndex === current) return;
  state.layout = reorderSection(state.layout, drag.id, newIndex);
  const nextRow = rows[newIndex];
  list.insertBefore(dragRow, newIndex > current ? nextRow.nextSibling : nextRow);
  writeLayout(state.layout, localStorage);
  render();
}

function endSectionDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  els.sectionList.querySelector(`[data-id="${CSS.escape(drag.id)}"]`)?.classList.remove("is-dragging");
  drag = null;
}

function readPlace() {
  try {
    const saved = JSON.parse(localStorage.getItem("sunny.place") || "null");
    const place = saved?.place;
    if (!place || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) return null;
    if (!["device", "search", "fallback"].includes(saved.source)) return null;
    return {
      source: saved.source,
      note: typeof saved.note === "string" ? saved.note : "",
      place: { ...DEFAULT_PLACE, ...place, lat: Number(place.lat), lng: Number(place.lng) },
    };
  } catch {
    return null;
  }
}

function writePlace() {
  localStorage.setItem("sunny.place", JSON.stringify({
    source: state.locationSource,
    note: state.locationNote,
    place: state.place,
  }));
}

function placeTitle(place) {
  if (place?.unnamed) return `${Number(place.lat).toFixed(2)}, ${Number(place.lng).toFixed(2)}`;
  return place?.name || "Selected place";
}

function renderLocationChip() {
  if (!els.locationChip) return;
  if (isPlacesOpen() && !els.placesTabs.hidden) renderPlaces();
  let kicker = "Your location";
  let name = "";
  if (state.locationSource === "fallback") {
    kicker = "Fallback";
    name = "Ramat Gan, Israel";
  } else if (state.locationSource === "device" || state.locationSource === "search") {
    kicker = state.locationSource === "device" ? "Your location" : "Selected city";
    name = state.place.unnamed
      ? placeTitle(state.place)
      : [state.place.name, state.place.region].filter(Boolean).join(", ");
  }
  const busy = !name || state.loading || state.updating;
  const busyText = name ? "Updating forecast" : "Finding your location";
  const spinner = busy ? `<span class="spinner" aria-hidden="true"></span><span class="sr-only">${busyText}…</span>` : "";
  const label = name ? `<span class="location-name">${escapeHtml(name)}</span>${CHEVRON}` : "";
  const html = `<span class="location-kicker">${escapeHtml(kicker)}</span><span class="location-row">${label}${spinner}</span>`;
  // Only touch the DOM when something changed, so a tap isn't interrupted by an identical redraw.
  if (html !== chipHtml) {
    els.locationChip.innerHTML = html;
    chipHtml = html;
  }
}

const CHEVRON = `<svg class="chip-chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PIN = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13.6 2.4 2.6 7l4.6 1.8 1.8 4.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const CLOSE = `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

function saveFavorites() {
  localStorage.setItem("sunny.favorites", JSON.stringify(state.favorites));
}

function bindPlaces() {
  if (!els.places) return;
  if (popoverSupported) {
    // Native toggling avoids the light-dismiss-then-reopen race when tapping the chip again.
    els.locationChip.setAttribute("popovertarget", "places");
    els.places.addEventListener("beforetoggle", (event) => {
      if (event.newState === "open") showPlacesTabs({ focus: false });
    });
    els.places.addEventListener("toggle", (event) => {
      els.locationChip.setAttribute("aria-expanded", event.newState === "open" ? "true" : "false");
      if (event.newState === "open") els.placesTabs.querySelector('[aria-current="true"]')?.focus();
      else onPlacesClosed();
    });
  } else {
    els.locationChip.addEventListener("click", () => (isPlacesOpen() ? closePlaces() : openPlaces()));
  }
  els.placesTabs.addEventListener("click", onPlacesTabClick);
  els.placesInput.addEventListener("input", () => { searchTarget = "places"; onSearchInput(); });
  els.placesInput.addEventListener("keydown", (event) => {
    searchTarget = "places";
    if (event.key === "Escape" && !state.searchResults.length) {
      event.preventDefault();
      showPlacesTabs();
      return;
    }
    onSearchKeydown(event);
  });
  els.placesSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    searchTarget = "places";
    chooseSearch(state.searchActive >= 0 ? state.searchActive : 0);
  });
  els.placesList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-result]");
    if (!button) return;
    searchTarget = "places";
    chooseSearch(Number(button.dataset.result));
  });
  document.querySelector("#places-cancel").addEventListener("click", showPlacesTabs);
  if (!popoverSupported) {
    document.addEventListener("click", (event) => {
      if (isPlacesOpen() && !event.target.closest("#places, #location-chip")) closePlaces();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isPlacesOpen()) closePlaces();
    });
  }
}

function isPlacesOpen() {
  if (!els.places) return false;
  return popoverSupported ? els.places.matches(":popover-open") : els.places.classList.contains("is-open");
}

/** Fallback for browsers without the Popover API. */
function openPlaces() {
  showPlacesTabs({ focus: false });
  els.places.classList.add("is-open");
  els.locationChip.setAttribute("aria-expanded", "true");
  els.placesTabs.querySelector('[aria-current="true"]')?.focus();
}

function closePlaces() {
  if (!isPlacesOpen()) return;
  if (popoverSupported) els.places.hidePopover();
  else {
    els.places.classList.remove("is-open");
    onPlacesClosed();
  }
}

function onPlacesClosed() {
  els.locationChip.setAttribute("aria-expanded", "false");
  if (searchTarget === "places") closeSearch();
  searchTarget = "settings";
}

/** Close whichever place picker is open (settings sheet or places popover). */
function closePanels() {
  if (els.settings.open) els.settings.close();
  closePlaces();
}

function showPlacesTabs({ focus = true } = {}) {
  if (searchTarget === "places") closeSearch();
  els.placesInput.value = "";
  els.placesSearch.hidden = true;
  els.placesTabs.hidden = false;
  renderPlaces();
  if (focus) els.placesTabs.querySelector("[data-place-new]")?.focus();
}

function showPlacesSearch() {
  searchTarget = "places";
  els.placesTabs.hidden = true;
  els.placesSearch.hidden = false;
  els.placesInput.value = "";
  els.placesInput.focus();
}

function activePlaceIndex() {
  if (state.locationSource !== "search") return -1;
  const key = placeKey(state.place);
  return state.favorites.findIndex((place) => placeKey(place) === key);
}

function renderPlaces() {
  if (!els.placesTabs) return;
  const active = activePlaceIndex();
  const hereActive = state.locationSource !== "search";
  const tabs = state.favorites.map((place, index) => {
    const current = index === active;
    const name = escapeHtml(place.name || "Saved city");
    return `<li class="place-tab${current ? " is-active" : ""}">
      <button type="button" class="place-open" data-place-open="${index}" aria-current="${current ? "true" : "false"}">${name}</button>
      <button type="button" class="place-close" data-place-close="${index}" aria-label="Close ${name}">${CLOSE}</button>
    </li>`;
  }).join("");
  els.placesTabs.innerHTML = `<li class="place-tab place-here${hereActive ? " is-active" : ""}">
      <button type="button" class="place-open" data-place-here aria-current="${hereActive ? "true" : "false"}">${PIN}Your location</button>
    </li>${tabs}<li class="place-tab place-new">
      <button type="button" class="place-open" data-place-new><span aria-hidden="true">+</span> New</button>
    </li>`;
}

function onPlacesTabClick(event) {
  if (event.target.closest("[data-place-new]")) {
    showPlacesSearch();
    return;
  }
  if (event.target.closest("[data-place-here]")) {
    closePlaces();
    if (state.locationSource === "search") locate();
    return;
  }
  const open = event.target.closest("[data-place-open]");
  if (open) {
    const index = Number(open.dataset.placeOpen);
    const place = state.favorites[index];
    closePlaces();
    if (place && index !== activePlaceIndex()) selectPlace(place);
    return;
  }
  const close = event.target.closest("[data-place-close]");
  if (close) confirmClosePlace(Number(close.dataset.placeClose));
}

/** Ask before closing a city tab. Opening a modal dialog dismisses the popover, so reopen it afterwards. */
async function confirmClosePlace(index) {
  const place = state.favorites[index];
  if (!place) return;
  const dialog = els.confirmClose;
  dialog.querySelector("#confirm-text").textContent =
    `${place.name || "This city"} will be removed from your tabs and saved cities.`;
  const answer = await new Promise((resolve) => {
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
  if (answer === "confirm") closePlaceTab(index);
  if (!isPlacesOpen()) {
    if (popoverSupported) els.places.showPopover();
    else openPlaces();
  } else {
    renderPlaces();
  }
  const next = answer === "confirm"
    ? els.placesTabs.querySelectorAll("[data-place-close]")[Math.max(0, index - 1)]
    : els.placesTabs.querySelectorAll("[data-place-close]")[index];
  (next || els.placesTabs.querySelector("[data-place-new]"))?.focus();
}

function closePlaceTab(index) {
  const wasActive = index === activePlaceIndex();
  state.favorites.splice(index, 1);
  saveFavorites();
  renderFavorites();
  syncSaveButton();
  if (wasActive) {
    // Fall back to the tab on the left, like closing a browser tab.
    const left = state.favorites[index - 1];
    if (left) selectPlace(left);
    else locate();
  }
  renderPlaces();
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
