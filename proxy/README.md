# slider-proxy

A Cloudflare Worker that CORS-proxies [CIRA SLIDER](https://slider.cira.colostate.edu/)
imagery for the Himawari/Satellite new-tab website. SLIDER sends no CORS headers, so
the browser cannot fetch its tiles/JSON directly; this worker adds
`Access-Control-Allow-Origin: *`.

It replaces the old Google AppEngine proxies (`himawari-8.appspot.com` and
`meteosat-url.appspot.com`) — everything the website needs now comes from SLIDER.

## Contract

`GET /?<url-encoded slider URL>` — only `slider.cira.colostate.edu` and
`rammb-slider.cira.colostate.edu` are allowed (not an open proxy). Tiles are cached
for 7 days (immutable); `latest_times.json` for 60s.

The **browser extension** does not use this worker — it fetches SLIDER directly via
`host_permissions`. Only the website proxies through here.

## Develop / deploy

```bash
cd proxy
npm install
npm run dev      # local worker at http://localhost:8787
npm run deploy   # deploys to slider-proxy.domoritz.workers.dev
```

## Satellite config note

The client's per-satellite `tileSize`/`maxLevel` table (in `src/index.ts`) is derived
from SLIDER's catalog `https://slider.cira.colostate.edu/js/define-products---rammb-slider.js`:
for each satellite with a `full_disk` sector, `tileSize = sectors.full_disk.tile_size`
and `maxLevel = sectors.full_disk.max_zoom_level − products.geocolor.zoom_level_adjust`.
Regenerate it if CIRA adds/removes satellites.
