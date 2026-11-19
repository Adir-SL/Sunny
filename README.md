# Sunny

Sunny is a weather app for the browser. It shows current conditions, an hourly chart, a 10-day forecast, and public alerts from **Google Weather** — the same Maps Platform data behind Google’s weather results. Place search and the device’s city name use Places API (New). No other weather provider is used.

The site is static and is published with GitHub Pages at [https://adir-sl.github.io/Sunny/](https://adir-sl.github.io/Sunny/).

On every visit Sunny asks for this device’s location and names it with Places API (New) Nearby Search (`places:searchNearby`, type `locality`, 5 km, then 20 km). If that finds nothing, it tries the Geocoding API, then shows the coordinates. It uses **Ramat Gan, Israel** only when location access is denied or unavailable, and it says so on the page.

Live Google Weather is used whenever a key or proxy is configured. The labeled sample forecast appears only when neither is set, with a prompt to add a key. Sample numbers are not live weather.

## What you can do

- Current temperature, feels-like, condition icon ([Meteocons](https://meteocons.com) by Bas Milius, MIT, self-hosted in `icons/meteocons`), humidity, wind, UV, and precipitation chance
- Hourly chart with Temperature, Precipitation, and Wind tabs, plus the next 24 hours
- 10-day forecast with highs and lows
- Rain warning that lists every hour **today** with more than 30% precipitation chance
- Sunrise and sunset when the daily forecast includes them
- Device location on load, city search, and saved cities. The header chip names the city from Places Nearby Search.
- One settings control for search, units, theme (system, light, or dark), the API key, and the order of the weather cards. Those choices are saved in this browser.
- °C / °F. Celsius is the default. Every temperature is shown with a ° symbol
- Light and dark themes
- Installable PWA, with an offline view of the last forecast saved in this browser
- Alerts from `publicAlerts:lookup`, with the publishing agency named and linked

Times use the location’s time zone from the Weather API. Ramat Gan is the fallback city, not the default.

## Set up a Google Maps Platform key

The key is required for live data. It is **not** stored in this repository.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. Enable billing for the project. Maps Platform requires it.
3. Enable these APIs:
   - [Weather API](https://console.cloud.google.com/apis/library/weather.googleapis.com)
   - [Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com)
   - [Geocoding API](https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com) (optional fallback if Nearby Search returns no locality)
4. Create an API key: **APIs & Services → Credentials → Create credentials → API key**.
5. Edit the key and restrict it:
   - **Application restrictions:** HTTP referrers (websites).
   - Add `https://adir-sl.github.io/*` for GitHub Pages.
   - For local preview, also add `http://localhost:*/*` and `http://127.0.0.1:*/*`.
   - **API restrictions:** restrict the key to the Weather API and Places API (New). Add the Geocoding API only if you want the fallback. A key with Places but not Geocoding is enough to name the city.
6. Set a quota or budget alert on the project. A referrer-restricted key still spends the project’s quota for anyone who uses the site with that key.

### Where to put the key

Do not commit a real key. Sunny reads it in this order:

1. **Settings in the app (best for GitHub Pages).** Open the gear icon, paste the key, and it is stored in this browser as you type. It is sent only to Google (or to your proxy). Each browser you use needs the key once. Other visitors stay on the sample forecast unless you deploy the proxy below.
2. **Gitignored `config.json` for local development.** Copy `config.example.json` to `config.json` and set `apiKey`. `config.json` is listed in `.gitignore`.
3. **Optional proxy.** Deploy `proxy/cloudflare-worker.js`, store the key as the worker secret `API_KEY`, and set `ALLOWED_ORIGINS` (for example `https://adir-sl.github.io,http://localhost:8080`). Put the worker’s `https` origin in Settings, or in `config.public.json` as `proxyBase` if every visitor should get live data. `config.public.json` is public — never put an API key in it. Sunny ignores `apiKey` in that file.

A configured key or proxy always loads live data. Sample data is not a mode you can leave turned on beside a key.

Direct browser calls work: `weather.googleapis.com` and `places.googleapis.com` respond with CORS headers. The proxy is only there so the key does not have to live in the page. It forwards `POST /places/v1/places:searchNearby` to Places Nearby Search.

## Run it locally

No build step and no dependencies.

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Opening `index.html` as a file will not register the service worker and may block `config.json`.

```bash
npm test
```

That runs the unit tests for units, the rain-hour rule, settings, and the demo payload. It does not call Google.

## Project structure

```
.
├── index.html              # App shell
├── css/app.css             # Layout, themes, chart
├── js/                     # Weather client, demo data, chart, UI
├── sw.js                   # Offline cache of the app shell
├── manifest.webmanifest    # Installable PWA
├── sunny.png               # Icon
├── icons/meteocons/        # Weather icons (animated + static, MIT)
├── config.example.json     # Template for a local key
├── config.public.json      # Optional public proxy URL only
├── proxy/cloudflare-worker.js
└── test/logic.test.js
```

Live requests, all metric (the °F view is converted in the browser):

| Data | Endpoint |
| --- | --- |
| Current conditions | `GET https://weather.googleapis.com/v1/currentConditions:lookup` |
| Hourly forecast | `GET https://weather.googleapis.com/v1/forecast/hours:lookup` |
| Daily forecast | `GET https://weather.googleapis.com/v1/forecast/days:lookup` |
| Alerts | `GET https://weather.googleapis.com/v1/publicAlerts:lookup` |
| City search | `POST https://places.googleapis.com/v1/places:autocomplete` |
| Place location | `GET https://places.googleapis.com/v1/places/{placeId}` |
| Device location name | `POST https://places.googleapis.com/v1/places:searchNearby` |
| Location name fallback | `GET https://maps.googleapis.com/maps/api/geocode/json` |

## Deployment

GitHub Pages serves the `main` branch from the site root. A push to `main` updates [https://adir-sl.github.io/Sunny/](https://adir-sl.github.io/Sunny/). Paths are relative, so the same files work at that project URL and on a local server.

Published site: [https://adir-sl.github.io/Sunny/](https://adir-sl.github.io/Sunny/)
