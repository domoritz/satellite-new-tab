# Cloudflare Proxy Rewrite + Satellite Switching — Design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)

## Problem

The website and extension depend on two Google AppEngine proxies, each on its own
git branch, that are painful to maintain:

- **`proxy` branch** — Go/AppEngine app at `himawari-8.appspot.com/latest`. Wraps
  Himawari-8 `latest.json` from `himawari8-dl.nict.go.jp` with memcache caching and
  adds `Access-Control-Allow-Origin: *`. Currently alive.
- **`meteosat` branch** — Python/AppEngine app at `meteosat-url.appspot.com/msg`
  (and `/msgiodc`). Scrapes `eumetview.eumetsat.int` HTML to extract the current
  Meteosat image URL. **Already dead (HTTP 404); its source site now 301-redirects
  to a different app at `view.eumetsat.int`.** Meteosat support is broken today.

A third proxy already exists as a Cloudflare Worker — `slider-proxy.domoritz.workers.dev`
— that CORS-proxies CIRA SLIDER tiles and `latest_times.json` (its source is not in
the repo).

Additional goals:

- Replace the AppEngine proxies with Cloudflare, with **as few moving pieces as possible**.
- Let the **website** switch satellites (today it hardcodes Himawari-9), not just the extension.
- **No HTML scraping** — prefer clean JSON APIs.
- Composited images must have **no artifacts** (gridlines, borders, labels, burned-in text).

## Research findings (verified 2026-07-09)

CORS was tested live with an `Origin` header against each source:

| Source | API | CORS header | Needs proxy? |
|---|---|---|---|
| `slider.cira.colostate.edu` (CIRA SLIDER) | tiled PNG + `latest_times.json` | **none** | **Yes** |
| `himawari8-dl.nict.go.jp` (native Himawari) | `latest.json` | **none** | Yes (retired) |
| `epic.gsfc.nasa.gov` (DSCOVR EPIC) | JSON | `Access-Control-Allow-Origin: *` | **No** |

Key insight: **CIRA SLIDER hosts every geostationary satellite we care about**, all
through one uniform tiled-PNG scheme plus a `latest_times.json` metadata endpoint —
no scraping. SLIDER full-disk satellite path IDs (from its catalog
`define-products---rammb-slider.js`):

- `goes-19` (GOES-East, 75.2°W), `goes-18` (GOES-West, 137°W)
- `himawari` (now backed by Himawari-9, 140.7°E)
- `meteosat-0deg` (Meteosat prime, 0°), `meteosat-9` (IODC, 45.5°E), `meteosat-12` (MTG, 0°)
- `gk2a` (GEO-KOMPSAT-2A, 128°E)

The current code's GOES options are **already broken**: it maps to `goes-16` /
`goes-17`, both of which now 404 on SLIDER. This rewrite fixes that.

"Proxy-free federated" alternatives (GIBS/EUMETSAT WMS/NOAA STAR) were rejected:
each has a different API and projection, GIBS reprojects to flat lat/lon (loses the
iconic round full-disk look), and NOAA STAR has no JSON manifest — many more moving
pieces on the client for the sake of avoiding one small proxy we already run.

## Decisions

- **Architecture:** SLIDER-unified. One Cloudflare Worker CORS-proxies all tiled
  satellites; DSCOVR/EPIC stays direct.
- **Retire:** the `proxy` and `meteosat` AppEngine apps/branches, and the native NICT
  Himawari code path.
- **Website switching:** URL query param only (no visible UI control).
- **Worker source location:** `proxy/` directory on the `gh-pages` branch.
- **Satellites:** all full-disk SLIDER satellites, product `geocolor` only, plus
  DSCOVR EPIC (natural + enhanced).
- **Website default satellite:** Himawari-9 (unchanged).
- **Worker:** stateless pass-through, no default satellite; keeps the existing
  `slider-proxy.domoritz.workers.dev` name (no DNS/URL churn).
- **Build tooling:** migrate Rollup → **Vite in library mode** (single IIFE
  `bundle.js` at repo root, unchanged packaging/deploy), done as the first task so it
  is reviewable independently of the source changes.

## Architecture

```
                    ┌─ EPIC/DSCOVR ──── direct (CORS ok) ──────────┐
Website (browser) ──┤                                              ├─► <canvas>
                    └─ SLIDER tiles ─► Cloudflare Worker ─► slider ┘
Extension ──────────── SLIDER tiles ─► direct (host_permissions) ──► <canvas>
                       EPIC/DSCOVR ─── direct ──────────────────────►
```

The Worker is the only proxy. The extension continues to hit SLIDER directly via
`host_permissions` (bypasses CORS, avoids proxy load); only the website routes SLIDER
requests through the Worker. This is the existing `sliderProxy(url)` branch behavior.

## Component 1 — Cloudflare Worker (`proxy/`)

**Purpose:** allowlisted CORS pass-through for CIRA SLIDER.

- **Contract:** `GET /?<url-encoded slider URL>` — identical shape to the current
  slider-proxy, so the client change is minimal.
- **Host allowlist:** only `slider.cira.colostate.edu` and
  `rammb-slider.cira.colostate.edu`. Any other host → `403` (prevents an open proxy).
- **CORS:** responds with `Access-Control-Allow-Origin: *`; handles `OPTIONS`
  preflight (SLIDER itself returns 405 for OPTIONS).
- **Caching (replaces the old AppEngine memcache logic):**
  - Tiles (`/data/imagery/...`, served `immutable`) → long edge cache (`cacheEverything`,
    ~7-day TTL).
  - `latest_times.json` → short edge cache (~60s) so we do not hammer CIRA while
    keeping imagery fresh.
- **Files:**
  - `proxy/wrangler.toml` — worker name `slider-proxy`, main `src/worker.ts`, compat date.
  - `proxy/src/worker.ts` — the fetch handler.
  - `proxy/package.json` — wrangler dev/deploy scripts.
  - `proxy/README.md` — what it proxies, deploy instructions, allowlist rationale.
- **Stateless:** no satellite defaults or knowledge; it only validates host + forwards.

## Component 2 — Client satellite config

The client keeps a **static config table**, one row per satellite, because tile pixel
size and max zoom level differ per satellite and must be respected:

| SLIDER path | Title | URL param key | tile px | geocolor max level |
|---|---|---|---|---|
| `goes-19` | GOES-East | `goes-east` | 678 | 4 |
| `goes-18` | GOES-West | `goes-west` | 678 | 4 |
| `himawari` | Himawari-9 | `himawari` | 688 | 4 |
| `meteosat-0deg` | Meteosat 0° | `meteosat` | 464 | 3 |
| `meteosat-9` | Meteosat IODC | `meteosat-iodc` | 464 | 3 |
| `meteosat-12` | Meteosat-12 (MTG) | `mtg` | 696 | 4 |
| `gk2a` | GK2A | `gk2a` | 688 | 4 |
| EPIC (direct) | DSCOVR natural | `epic` | — | — |
| EPIC (direct) | DSCOVR enhanced | `epic-enhanced` | — | — |

- These numbers were read from SLIDER's catalog file
  `https://slider.cira.colostate.edu/js/define-products---rammb-slider.js`:
  `maxLevel = full_disk.max_zoom_level − geocolor.zoom_level_adjust`, `tileSize` =
  the sector's `tile_size`. A code comment records how to regenerate the table when
  CIRA changes satellites.
- **Product is always `geocolor`** — clean imagery (true color by day, IR at night).
  The gridlines/borders/labels seen in the SLIDER web viewer are separate overlay
  layers that the app **never fetches**, so composited images are artifact-free.
- Requested zoom level is **clamped to each satellite's `maxLevel`** (fixes fetching
  nonexistent Meteosat level-4 tiles).

**SLIDER URL shapes (verified):**

- Latest times: `https://slider.cira.colostate.edu/data/json/{sat}/full_disk/geocolor/latest_times.json`
  → `{ "timestamps_int": [20260709142020, ...] }` (ints, newest first; zero-pad to 14).
- Tile: `https://slider.cira.colostate.edu/data/imagery/{YYYY}/{MM}/{DD}/{sat}---full_disk/geocolor/{ts14}/{LL}/{row3}_{col3}.png`
  — level zero-padded to 2 (`00`–`05`); indices zero-padded to 3, ordered `{row}_{col}`;
  grid at level N is `2^N × 2^N` tiles; date path derived from the timestamp (UTC).
- Read `timestamps_int[0]` **per satellite** — feeds are not on a shared timeline and
  some (e.g. Meteosat) can lag several hours.

## Component 3 — Website satellite switching (URL param)

- `?satellite=<key>` selects a satellite by its URL-param key (see table). Unknown or
  missing param → default **Himawari-9**.
- A friendly-key → internal `imageType` map is shared with the extension's satellite
  list so both stay in sync.
- No visible UI control (explicit decision).

## Component 4 — Extension changes

- `options.html` — rebuild the satellite `<select>` to the new set; remove native
  Himawari (visible `D531106` / infrared `INFRARED_FULL`) and the broken `goes-16` /
  `goes-17` entries.
- `manifest.chrome.json` / `manifest.firefox.json` — host permissions become
  `slider.cira.colostate.edu`, `rammb-slider.cira.colostate.edu`, `epic.gsfc.nasa.gov`;
  drop `himawari8-dl.nict.go.jp`.
- `src/index.ts` — remove native Himawari fetch/URL code
  (`HIMAWARI_BASE_URL`, `himawariURLs`, `INFRARED`, `VISIBLE_LIGHT`, related storage),
  drop the AppEngine metadata fetches (`himawari-8.appspot.com`,
  `meteosat-url.appspot.com`), and route Meteosat/GK2A/MTG through the existing SLIDER
  pipeline. Generalize the per-satellite `tileSize` / `maxLevel` handling.

## Component 5 — README / docs

- Update the top-level `README.md`: new architecture diagram, the full satellite list,
  the `?satellite=` URL params, how to deploy the Worker (`cd proxy && wrangler deploy`),
  and required **attribution**:
  - "Imagery: NOAA / CIRA / RAMMB SLIDER"
  - "Meteosat imagery contains modified EUMETSAT data" (mandatory for `meteosat-*` feeds).

## Cleanup / follow-ups (not done automatically)

- Delete the remote `proxy` and `meteosat` git branches — **manual**, since this is a
  remote destructive action and nothing is pushed in this task.
- Decommission the `himawari-8` and `meteosat-url` AppEngine apps in GCP — **manual**.
- No changes are pushed or released as part of this work; local commits only.

## Testing

- **Worker:** `wrangler dev`; assert (1) an allowlisted SLIDER tile URL returns the PNG
  with `Access-Control-Allow-Origin: *`; (2) `latest_times.json` returns JSON with CORS;
  (3) a non-allowlisted host returns 403; (4) `OPTIONS` preflight returns 204/200 with
  CORS headers.
- **Client:** load the site with `?satellite=` for each satellite and confirm a clean,
  artifact-free full disk renders; confirm no param defaults to Himawari-9; confirm
  Meteosat clamps to level 3 (no 404 tiles); confirm DSCOVR/EPIC still loads directly.
- **Extension:** load unpacked, switch each option in `options.html`, confirm SLIDER is
  fetched directly (no proxy) and EPIC loads.

## Non-goals

- No visible satellite-picker UI on the website (URL param only).
- No native NICT Himawari, no EUMETSAT scraping, no GIBS/NOAA-STAR federation.
- No animation/product changes beyond `geocolor`.
