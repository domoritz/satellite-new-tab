# Contributing

Thanks for helping out! This repo contains two things:

- **Frontend** (repo root) — the browser extension and the website. TypeScript in
  `src/` is bundled to `bundle.js` with [Vite](https://vitejs.dev/).
- **Proxy** (`proxy/`) — a Cloudflare Worker that adds CORS headers to
  [CIRA SLIDER](https://rammb-slider.cira.colostate.edu/) so the website can load its
  imagery. See [`proxy/README.md`](proxy/README.md).

Prerequisites: [Node.js](https://nodejs.org/) (which includes `npm`).

## Frontend (extension + website)

Install dependencies from the repo root:

```bash
npm install
```

### Run the website

```bash
npm run dev
```

This starts the Vite dev server and prints a local URL. Some extension-only features
(the options page, `browser.storage.sync`) are not available on the website — switch
satellites there with a `?satellite=<key>` query parameter instead (see the satellite
list in the [README](README.md#switch-satellites-on-the-web)).

### Run the extension

Build the bundle continuously:

```bash
npm run watch
```

Then load the repo as an unpacked extension:

- **Chrome:** `cp manifest.chrome.json manifest.json`, open `chrome://extensions`, enable
  **Developer mode**, click **Load unpacked**, and select the repo root. Open a new tab.
- **Firefox:** `cp manifest.firefox.json manifest.json`, open `about:debugging` → **This
  Firefox** → **Load Temporary Add-on**, and select `manifest.json`. Open a new tab.

### Other commands

```bash
npm run build    # production build → bundle.js (+ bundle.js.map) at the repo root
npm run lint     # eslint
npm run format   # eslint --fix
```

## Proxy (Cloudflare Worker)

The worker lives in `proxy/`. The **extension does not use it** (it fetches SLIDER
directly via host permissions) — only the **website** proxies through it.

```bash
cd proxy
npm install
npm run dev      # runs the worker locally at http://localhost:8787
```

Test the local worker (it only allows SLIDER hosts):

```bash
curl "http://localhost:8787/?$(node -e 'process.stdout.write(encodeURIComponent("https://slider.cira.colostate.edu/data/json/goes-19/full_disk/geocolor/latest_times.json"))')"
```

Deploy it (requires Cloudflare auth — run `npx wrangler login` once):

```bash
cd proxy
npm run deploy   # deploys to slider-proxy.domoritz.workers.dev
```

## Releasing

### Website

Deployed automatically by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on
every push to `main` (the repo's GitHub Pages source is set to **GitHub Actions**). No
manual step.

### Extension

1. Bump the version in `package.json`, `manifest.chrome.json`, and `manifest.firefox.json`.
2. Add a Changelog entry in the [README](README.md#changelog).
3. Commit and tag the release.
4. Build the store archives: `npm run bundle` (produces `himawari_chrome.zip` and
   `himawari_firefox.zip`).
5. Upload to the [Chrome Web Store](https://chrome.google.com/webstore/devconsole) and
   [Firefox Add-ons](https://addons.mozilla.org/developers/).

### Proxy

```bash
cd proxy && npm run deploy
```
