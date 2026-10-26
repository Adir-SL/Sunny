# Sunny

Sunny is a one-page static website. Opening it sends the browser to Google’s search results for `weather`. Weather results come from Google after that redirect. This repository does not call a weather API, render a forecast, or store any data.

The site is published with GitHub Pages at [https://adir-sl.github.io/Sunny/](https://adir-sl.github.io/Sunny/).

## Features

- Redirects immediately to `https://www.google.com/search?q=weather`.
- Sets the document title to **Sunny**.
- Uses `sunny.png` (272×272 PNG) as the favicon and the Apple touch icon. The image is a yellow sun on a light-blue background.
- Asks browsers not to cache the page, via `http-equiv` meta tags for `Cache-Control`, `Pragma`, and `Expires`.
- Sets a viewport meta tag so the page scales on small screens.
- Declares the document language as English (`lang="en"`).

## How it works

A browser loads `index.html` from disk or from a static host. The page has no stylesheet and no other scripts. Its only script assigns a new URL:

```html
<script>
    window.location.href = "https://www.google.com/search?q=weather";
</script>
```

That assignment replaces the current page with Google Search. Google runs the `weather` query and shows its own results page. Sunny does not receive those results.

The document body contains only an HTML comment, `LOADING...`. That text is not shown.

`sunny.png` is referenced twice in the document head:

- `<link rel="icon" type="image/png" href="sunny.png">` — the browser tab icon.
- `<link rel="apple-touch-icon" href="sunny.png">` — the icon used when the page is saved to an Apple home screen.

The icon may appear only briefly, because the redirect runs as soon as the script executes.

### Request flow

1. The browser requests `index.html` (locally, or from GitHub Pages at the site root).
2. The page script sets `window.location.href` to `https://www.google.com/search?q=weather`.
3. The browser navigates to that URL. Later requests go to Google.

### Cache hints

The head includes these meta tags:

| Meta | Content |
| --- | --- |
| `Cache-Control` | `no-cache, no-store, must-revalidate` |
| `Pragma` | `no-cache` |
| `Expires` | `0` |

They are `http-equiv` tags inside the HTML, separate from whatever HTTP headers the host sends. GitHub Pages can still attach its own caching headers. Whether a given browser honors the meta tags is up to that browser.

## Tech stack

- HTML
- A few lines of JavaScript in `index.html` (one `window.location.href` assignment)
- One PNG asset, `sunny.png`

The page uses no frameworks, package manager, or other libraries. The only external service is Google Search, and only as the redirect destination.

## Run it locally

Nothing to install, configure, or build. The repository defines no environment variables, and it has no test suite.

Open `index.html` in a browser. The redirect runs as soon as the script does.

To serve the folder over HTTP, point any static file server at the repository root and open the URL it prints. The relative `sunny.png` links resolve either way.

## Project structure

```
.
├── .gitattributes   # Treat files as text and normalize line endings (LF)
├── index.html       # Markup, cache meta tags, icon links, and the redirect
├── sunny.png        # Favicon and Apple touch icon (272×272 PNG)
└── README.md
```

`.gitattributes` contains `* text=auto`, so Git detects text files and checks them out with LF line endings.

## Deployment

GitHub Pages publishes this repository from the `main` branch at the site root (`/`), using the legacy Pages build. HTTPS is enforced. There is no custom domain. The repository has no Pages config file, workflow, Dockerfile, or other deploy script; the Pages source is set in the repository’s GitHub Pages settings.

Published site: [https://adir-sl.github.io/Sunny/](https://adir-sl.github.io/Sunny/)

A push to `main` is what updates the published site.
