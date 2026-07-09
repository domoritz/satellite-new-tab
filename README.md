# 🛰 Satellite New Tab Page (Chrome and Firefox)

Experience the latest full-disk image of Earth from a [geostationary](https://en.wikipedia.org/wiki/Geostationary_orbit) weather satellite every time you open a new tab in Chrome or Firefox. The imagery updates every few minutes. Since the new tab page is a simple web page, you can also [try it online](https://domoritz.github.io/himawari-8-chrome).

**Supports multiple satellites — Himawari-9, GOES-East/West, Meteosat (0° and IODC), MTG, GK2A, and DSCOVR — in both the extension and [on the web](https://domoritz.github.io/himawari-8-chrome).**

## Installation

### Chrome Users:

<a href="https://chrome.google.com/webstore/detail/himawari-8-new-tab-page/llelgapflianaapmnpncgakfjhfhnojm">
  <img src="icons/download_chrome.png" alt="Download for Chrome" style="width: 206px; height: 58px">
</a>

### Firefox Users:

<a href="https://addons.mozilla.org/en-US/firefox/addon/satellite-new-tab-page">
  <img src="icons/download_moz.png" alt="Download for Firefox" style="width: 172px; height: 60px">
</a>

![screenshot](screenshots/main.png "Screenshot of the browser with the new tab page")

Below are examples of the satellite imagery supported (Himawari, GOES, Meteosat, and DSCOVR).

<p align="center">
  <img src="screenshots/himawari.png" width="160">
  <img src="screenshots/goes16.png" width="160">
  <img src="screenshots/meteosat.png" width="160">
  <img src="screenshots/meteosat_iodc.png" width="160">
  <img src="screenshots/dscovr.png" width="160">
  <img src="screenshots/dscovr_enhanced.png" width="160">
</p>

This extension is inspired by https://glittering.blue/, https://github.com/jakiestfu/himawari.js/ and https://github.com/ungoldman/himawari-urls.

## Features

* Switch between full-disk GeoColor imagery (true color by day, infrared at night) from [Himawari-9](https://en.wikipedia.org/wiki/Himawari_9), [GOES-East/West](https://en.wikipedia.org/wiki/Geostationary_Operational_Environmental_Satellite), [Meteosat](https://www.eumetsat.int/meteosat-second-generation) (0° and Indian Ocean), [MTG](https://www.eumetsat.int/meteosat-third-generation), and [GK2A](https://en.wikipedia.org/wiki/GEO-KOMPSAT-2) — plus whole-Earth images from the EPIC camera on [DSCOVR](https://www.nesdis.noaa.gov/DSCOVR/). Switch in the extension options, or on the web with a [`?satellite=` URL parameter](#switch-satellites-on-the-web).
* Loads the latest image, updates automatically.
* Automatically loads images at the optimal resolution (including retina resolutions). If more than one image is needed, the app automatically downloads tiles.
* Caches last version in local storage (compressed JPEG) and immediately displays it when you load the page. Then loads the latest image.
* A small [Cloudflare Worker](proxy/) adds CORS headers so the website can load [CIRA SLIDER](https://rammb-slider.cira.colostate.edu/) imagery; the extension fetches SLIDER directly via host permissions. Tiles are cached at the edge. DSCOVR/EPIC is fetched directly.
* Full offline support.
* Images are drawn on a canvas so that we can cache and load it easily.
* The Earth always stay centered, thanks to CSS magic.
* Earth is animated when it moves in (optional).

Here is a screenshot of the options dialog in Chrome:

<img src="screenshots/options.png" width="200">

## Switch satellites on the web

The website loads Himawari-9 by default. Add a `?satellite=<key>` query parameter to pick a different one:

| Key | Satellite |
| --- | --- |
| `himawari` | Himawari-9 (default) |
| `goes-east` | GOES-East |
| `goes-west` | GOES-West |
| `meteosat` | Meteosat 0° |
| `meteosat-iodc` | Meteosat IODC |
| `mtg` | Meteosat-12 / MTG |
| `gk2a` | GK2A |
| `epic` | DSCOVR EPIC |
| `epic-enhanced` | DSCOVR EPIC Enhanced |

Direct preview links:

- [Himawari-9](https://domoritz.github.io/himawari-8-chrome/?satellite=himawari)
- [GOES-East](https://domoritz.github.io/himawari-8-chrome/?satellite=goes-east)
- [GOES-West](https://domoritz.github.io/himawari-8-chrome/?satellite=goes-west)
- [Meteosat 0°](https://domoritz.github.io/himawari-8-chrome/?satellite=meteosat)
- [Meteosat IODC](https://domoritz.github.io/himawari-8-chrome/?satellite=meteosat-iodc)
- [Meteosat-12 / MTG](https://domoritz.github.io/himawari-8-chrome/?satellite=mtg)
- [GK2A](https://domoritz.github.io/himawari-8-chrome/?satellite=gk2a)
- [DSCOVR EPIC](https://domoritz.github.io/himawari-8-chrome/?satellite=epic)
- [DSCOVR EPIC Enhanced](https://domoritz.github.io/himawari-8-chrome/?satellite=epic-enhanced)

## How it works

The website and extension render full-disk satellite imagery from [CIRA SLIDER](https://rammb-slider.cira.colostate.edu/) (product: GeoColor). SLIDER sends no CORS headers, so the **website** routes tile and metadata requests through a small [Cloudflare Worker](proxy/) (deployed at `slider-proxy.domoritz.workers.dev`) that adds them. The **extension** fetches SLIDER directly using its host permissions. DSCOVR/EPIC already sends CORS headers and is fetched directly in both.

See [`proxy/README.md`](proxy/README.md) for the worker; deploy it with `cd proxy && npm run deploy`.

Imagery credit: NOAA / CIRA / RAMMB SLIDER, JMA, NASA, KMA. Meteosat imagery contains modified EUMETSAT data.

## Changelog

```
0.24.0 (next) Consolidate the proxies into a single Cloudflare Worker; serve all imagery from CIRA SLIDER (GeoColor). Add website satellite switching via ?satellite=. Add GOES-East/West, Meteosat IODC, MTG, and GK2A. Switch the build to Vite and the package manager to npm; deploy the site via GitHub Actions. Remove the native Himawari (visible/infrared) feeds and the AppEngine proxies.
0.23.0 Update URLs.
0.22.0 Update to new proxy, add GOES 19 and Himawari 9.
0.21.0 Update RAMMB URL format. Move to manifest v3 for Chrome.
0.20.0 Support natural variant for GOES 17 west.
0.19.1, 0.19.2 Fix Himawari base URL.
0.19.0 Disable unreliable image cache in extension.
0.18.1 Fix GOES URLs. Thanks to @mattijn.
0.18.0 Remove d3-request and d3-queue and instead use fetch and async
0.17.0 Add GOES 17
0.16.1 Store large images with reduced quality until they fit
0.16.0 Add Meteosat images thanks to @erget
0.15.0 Add GOES 16 natural image thanks to @TheNeuralBit
0.14.0 Remove GOES 13 and 15 as NASA does not support them anymore
0.13.1 Faster time ago update
0.12.0 Improve animation initialization
0.11.1 Faster animation
0.11.0 Add GOES 16 and animation
0.10.0 Firefox support
0.9.0 Fix web extension compatibility. Immediately load new image when settings change.
0.8.0 Compatible with web extensions for Firefox
0.6.1, 0.7.0: Fix GOES caching
0.6.0: Add GOES 13 and GOES 15 images (see options). Fix issues with DSCOVR.
0.5.0: Fix issues with DSCOVR. Add enhanced images for DSCOVR.
0.4.3: Fix issue with latest date for himawari color image
0.4.2: Fix DSCOVR EPIC base url
0.4.0: Add DSCOVR images and link to explore online
0.3.2: Improve styling
0.3.1: Fix issue with options.html and options.js missing
0.3.0: Add option to choose infrared image
0.2.5: New proxy server
0.2.2: Better layout
0.2.1: Faster loading, offline support
```

## Planned features

**Contributions welcome**

* Automatically download a better image if the window is resized
* Time travel
* Actual logo/ icon
* Error handling


## Demo

Have a look at the [live satellite image](https://domoritz.github.io/himawari-8-chrome).


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the frontend (extension + website) and the proxy, and for the release process. The website is deployed automatically to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main`.
