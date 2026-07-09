import { utcFormat, utcParse } from "d3-time-format";

// base urls
const DSCOVR_BASE_URL = "https://epic.gsfc.nasa.gov/";
const SLIDER_BASE_URL = "https://slider.cira.colostate.edu/data/";

// links to online image explorers
const DSCOVR_EXPLORER = "https://epic.gsfc.nasa.gov";
const DSCOVR_EXPLORER_ENHANCED = DSCOVR_EXPLORER + "/enhanced";
const SLIDER_EXPLORER = "https://rammb-slider.cira.colostate.edu/";

// image types
const DSCOVR_EPIC = "EPIC";
const DSCOVR_EPIC_ENHANCED = "EPIC_ENHANCED";
const HIMAWARI_9 = "HIMAWARI_9";
const GOES_EAST = "GOES_EAST";
const GOES_WEST = "GOES_WEST";
const METEOSAT = "METEOSAT";
const METEOSAT_IODC = "METEOSAT_IODC";
const MTG = "MTG";
const GK2A = "GK2A";

type ImageType =
  | typeof DSCOVR_EPIC | typeof DSCOVR_EPIC_ENHANCED
  | typeof HIMAWARI_9 | typeof GOES_EAST | typeof GOES_WEST
  | typeof METEOSAT | typeof METEOSAT_IODC | typeof MTG | typeof GK2A;

// Per-satellite SLIDER config. tileSize and maxLevel come from SLIDER's catalog
// (https://slider.cira.colostate.edu/js/define-products---rammb-slider.js):
//   tileSize = sectors.full_disk.tile_size
//   maxLevel = sectors.full_disk.max_zoom_level − products.geocolor.zoom_level_adjust
// Regenerate if CIRA adds/removes satellites. Product is always "geocolor" (clean
// imagery — no gridlines/borders; those are separate overlay layers we never fetch).
interface SliderSat {
  path: string;      // SLIDER satellite id used in URLs
  tileSize: number;  // native pixel size of one tile
  maxLevel: number;  // highest usable geocolor zoom level
  title: string;
  urlParam: string;  // website ?satellite= key
}

const SLIDER_SATS: Record<string, SliderSat> = {
  [HIMAWARI_9]:    { path: "himawari",      tileSize: 688, maxLevel: 4, title: "Himawari-9",        urlParam: "himawari" },
  [GOES_EAST]:     { path: "goes-19",       tileSize: 678, maxLevel: 4, title: "GOES-East",         urlParam: "goes-east" },
  [GOES_WEST]:     { path: "goes-18",       tileSize: 678, maxLevel: 4, title: "GOES-West",         urlParam: "goes-west" },
  [METEOSAT]:      { path: "meteosat-0deg", tileSize: 464, maxLevel: 3, title: "Meteosat 0°",       urlParam: "meteosat" },
  [METEOSAT_IODC]: { path: "meteosat-9",    tileSize: 464, maxLevel: 3, title: "Meteosat IODC",     urlParam: "meteosat-iodc" },
  [MTG]:           { path: "meteosat-12",   tileSize: 696, maxLevel: 4, title: "Meteosat-12 (MTG)", urlParam: "mtg" },
  [GK2A]:          { path: "gk2a",          tileSize: 688, maxLevel: 4, title: "GK2A",              urlParam: "gk2a" },
};

const SLIDER_BLOCK_SIZES = [1, 2, 4, 8, 16];  // tiles per axis at levels 0..4

const DSCOVR_WIDTH = 2048;

const IMAGE_QUALITY = 0.95;
const RELOAD_INTERVAL = 1 * 60 * 1000;  // 1 minute
const RELOAD_TIME_INTERVAL = 10 * 1000;  // 10 seconds

// local storage keys
const IMAGE_DATA_KEY = "imageData";
const CACHED_DATE_KEY = "cachedDate";
const CACHED_IMAGE_TYPE_KEY = "cachedImageType";

// unknown date
const UNKNOWN: Date = null;

const isExtension = window['browser'] && !!browser.storage;

const DEFAULT_OPTIONS: {animated: boolean; imageType: ImageType} = {
  animated: false,
  imageType: HIMAWARI_9,
};

interface Tile {
  x: number;
  y: number;
  url: string;
}

/**
 * Pads a number with trailing zeros and makes it a string.
 */
function pad(num: string | number, size: number) {
  let s = num + "";
  while (s.length < size) {
    s = "0" + s;
  }
  return s;
}

function sliderURLs(sat: SliderSat, date: Date, blocks: number, level: number) {
  const formattedDate = utcFormat("%Y/%m/%d")(date);
  const formattedDateTime = utcFormat("%Y%m%d%H%M%S")(date);

  const tilesURL = `${SLIDER_BASE_URL}imagery/${formattedDate}/${sat.path}---full_disk/geocolor/${formattedDateTime}/`;
  const tiles: Tile[] = [];

  for (let y = 0; y < blocks; y++) {
    for (let x = 0; x < blocks; x++) {
      const url = `${tilesURL}${pad(level, 2)}/${pad(y, 3)}_${pad(x, 3)}.png`;
      tiles.push({ url, x, y });
    }
  }

  return { blocks, date, tiles };
}

async function getLatestDscovrDate(imageType: ImageType) {
  const raw = await fetch(`${DSCOVR_BASE_URL}api/${imageType === DSCOVR_EPIC_ENHANCED ? "enhanced" : "natural"}`);
  const data: {date: string; image: string}[] = await raw.json();

  if (data.length === 0) { return null; }

  const latest = data[data.length - 1];
  return {
    date: utcParse("%Y-%m-%d %H:%M:%S")(latest.date),
    image: latest.image,
  }
}

function sliderProxy(url: string) {
  if (isExtension) {
    return url;
  }
  return `https://slider-proxy.domoritz.workers.dev/?${encodeURIComponent(url)}`;
}

async function getLatestSliderDate(sat: SliderSat) {
  const raw = await fetch(sliderProxy(`${SLIDER_BASE_URL}json/${sat.path}/full_disk/geocolor/latest_times.json`));
  const data: { timestamps_int: number[] } = await raw.json();

  // timestamps_int are integers, newest first; stringify for parsing.
  return utcParse("%Y%m%d%H%M%S")(String(data.timestamps_int[0]));
}

/**
 * Looks at the screen resolution and figures out a zoom level that returns images at a sufficient resolution.
 */
function getOptimalNumberOfBlocks(width: number, sizes: number[]): {blocks: number; level: number} {
  const height = (document.getElementById("output")!).clientHeight * window.devicePixelRatio;
  const minNumber = height / width;

  for (let level = 0; level < sizes.length; level++) {
    const blocks = sizes[level];
    if (blocks > minNumber) {
      return {blocks, level};
    }
  }

  const lastLevel = sizes.length - 1;
  return {blocks: sizes[lastLevel], level: lastLevel};
}

// the date that is currently loaded
let loadedDate: Date = null;
let loadedType: ImageType = null;

function timeSince(date: Date) {
  const seconds = Math.floor(((new Date()).getTime() - date.getTime()) / 1000);

  let interval = Math.floor(seconds / 31536000);

  if (interval > 1) {
    return interval + " years";
  }
  interval = Math.floor(seconds / 2592000);
  if (interval > 1) {
    return interval + " months";
  }
  interval = Math.floor(seconds / 86400);
  if (interval > 1) {
    return interval + " days";
  }
  interval = Math.floor(seconds / 3600);
  if (interval > 1) {
    return interval + " hours";
  }
  interval = Math.floor(seconds / 60);
  if (interval > 1) {
    return interval + " minutes";
  }
  return Math.floor(seconds) + " seconds";
}

function updateTimeAgo(date: Date) {
  if (date === UNKNOWN) {
    document.getElementById("time").innerHTML = "";
  } else {
    document.getElementById("time").innerHTML = `<abbr title="${date}">${timeSince(date)}</abbr> ago`;
  }
}

/*
 * Set the right class on the body so that we can size the canvas via CSS.
 */
function setBodyClass(imageType: ImageType) {
  document.body.classList.remove("slider");
  document.body.classList.remove("dscovr");

  if (imageType === DSCOVR_EPIC || imageType === DSCOVR_EPIC_ENHANCED) {
    document.body.classList.add("dscovr");
  } else {
    document.body.classList.add("slider");
  }
}

function updateStateAndUI(date: Date, imageType: ImageType) {
  updateTimeAgo(date);
  loadedDate = date;
  setBodyClass(imageType);
  loadedType = imageType;
}

// Whether the browser can encode WebP from a canvas (detected once). WebP is
// ~30% smaller than JPEG at the same quality, so the cache stays crisp for
// longer before the localStorage quota forces the quality down.
let webpSupported: boolean = null;
function cacheMimeType(canvas: HTMLCanvasElement): string {
  if (webpSupported === null) {
    // Unsupported browsers silently fall back to PNG, so check the prefix.
    webpSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupported ? "image/webp" : "image/jpeg";
}

/**
 * Cache the image.
 */
function storeCanvas(date: Date, imageType: ImageType, quality = IMAGE_QUALITY) {
  // put date and image data in cache
  const canvas = document.getElementById("output") as HTMLCanvasElement;
  const imageData = canvas.toDataURL(cacheMimeType(canvas), quality);
  try {
    localStorage.setItem(IMAGE_DATA_KEY, imageData);
  } catch {
    // try again with lower quality
    if (quality > 0.5) {
      quality -= 0.05;
      console.warn(`Couldn't store image. Trying again with lower image quality of ${quality}`);
      return storeCanvas(date, imageType, quality);
    }
  }
  localStorage.setItem(CACHED_DATE_KEY, date.toString());
  localStorage.setItem(CACHED_IMAGE_TYPE_KEY, imageType);
}

function setDscovrImage(latest: {date: Date; image: string}, imageType: ImageType) {
  // no need to set images if we have up to date images and the image type has not changed
  if (loadedDate && latest.date.getTime() === loadedDate.getTime() && loadedType === imageType) {
    return;
  }

  // if we haven't loaded images before, we want to show progress
  const initialLoad = !localStorage.getItem(CACHED_DATE_KEY);

  // immediately set the type and body class because we are not loading in the background
  if (initialLoad) {
    updateStateAndUI(latest.date, imageType);
  }

  const canvas = initialLoad ? document.getElementById("output") as HTMLCanvasElement : document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.canvas.width = DSCOVR_WIDTH;
  ctx.canvas.height = DSCOVR_WIDTH;

  const img = new Image();
  img.setAttribute("crossOrigin", "anonymous");
  img.onload = () => {
    ctx.drawImage(img, 0, 0);

    if (!initialLoad) {
      // copy canvas into output in one step
      const output = document.getElementById("output") as HTMLCanvasElement;
      const outCtx = output.getContext("2d");
      outCtx.canvas.width = DSCOVR_WIDTH;
      outCtx.canvas.height = DSCOVR_WIDTH;
      outCtx.drawImage(canvas, 0, 0);
    }

    updateStateAndUI(latest.date, imageType);

    storeCanvas(latest.date, imageType);
  };

  const type = imageType === DSCOVR_EPIC_ENHANCED ? "enhanced" : "natural";
  const month = pad(latest.date.getMonth() + 1, 2);
  const date = pad(latest.date.getDate(), 2);
  img.src = `${DSCOVR_BASE_URL}archive/${type}/${latest.date.getFullYear()}/${month}/${date}/png/${latest.image}.png`;
}

function setSliderImages(date: Date, sat: SliderSat, imageType: ImageType) {
  // no need to set images if we have up to date images and the type has not changed
  if (loadedDate && date.getTime() === loadedDate.getTime() && loadedType === imageType) {
    return;
  }

  // if we haven't loaded images before, we want to show progress
  const initialLoad = !localStorage.getItem(CACHED_DATE_KEY);

  if (initialLoad) {
    updateStateAndUI(date, imageType);
  }

  // clamp zoom to what this satellite's geocolor product actually has
  const sizes = SLIDER_BLOCK_SIZES.slice(0, sat.maxLevel + 1);
  const { blocks, level } = getOptimalNumberOfBlocks(sat.tileSize, sizes);
  const result = sliderURLs(sat, date, blocks, level);

  const pixels = result.blocks * sat.tileSize;

  const canvas = initialLoad ? document.getElementById("output") as HTMLCanvasElement : document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.canvas.width = pixels;
  ctx.canvas.height = pixels;

  function addImage(tile: Tile) {
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.setAttribute("crossOrigin", "anonymous");
      img.onload = () => {
        ctx.drawImage(img, tile.x * sat.tileSize, tile.y * sat.tileSize, sat.tileSize, sat.tileSize);
        resolve();
      };
      img.src = sliderProxy(tile.url);
    });
  }

  Promise.all(result.tiles.map(tile => addImage(tile)))
    .catch(error => { throw error; })
    .then(() => {
      if (!initialLoad) {
        const output = document.getElementById("output") as HTMLCanvasElement;
        const outCtx = output.getContext("2d");
        outCtx.canvas.width = pixels;
        outCtx.canvas.height = pixels;
        outCtx.drawImage(canvas, 0, 0);
      }
      updateStateAndUI(date, imageType);
      storeCanvas(date, imageType);
    });
}

/** Resolve the satellite for the website from the ?satellite= URL param. */
function getSatelliteFromURL(): ImageType {
  const param = new URLSearchParams(window.location.search).get("satellite");
  if (param) {
    if (param === "epic") { return DSCOVR_EPIC; }
    if (param === "epic-enhanced") { return DSCOVR_EPIC_ENHANCED; }
    for (const key of Object.keys(SLIDER_SATS)) {
      if (SLIDER_SATS[key].urlParam === param) { return key as ImageType; }
    }
  }
  return HIMAWARI_9;
}

/** Reverse of getSatelliteFromURL: the ?satellite= key for an image type. */
function imageTypeToParam(imageType: ImageType): string {
  if (imageType === DSCOVR_EPIC) { return "epic"; }
  if (imageType === DSCOVR_EPIC_ENHANCED) { return "epic-enhanced"; }
  return SLIDER_SATS[imageType] ? SLIDER_SATS[imageType].urlParam : "himawari";
}

/**
 * Populate and wire up the website-only satellite dropdown. Selecting a satellite
 * updates the ?satellite= URL (so the view is shareable) and loads the new image.
 */
function setupSatelliteDropdown() {
  const select = document.getElementById("satellite") as HTMLSelectElement;
  if (!select) { return; }

  const choices: {param: string; label: string}[] = [
    ...Object.keys(SLIDER_SATS).map(key => ({ param: SLIDER_SATS[key].urlParam, label: SLIDER_SATS[key].title })),
    { param: "epic", label: "DSCOVR EPIC" },
    { param: "epic-enhanced", label: "DSCOVR EPIC Enhanced" },
  ];

  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.param;
    option.textContent = choice.label;
    select.appendChild(option);
  }

  select.value = imageTypeToParam(getSatelliteFromURL());

  select.addEventListener("change", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("satellite", select.value);
    history.replaceState(null, "", url.toString());
    setLatestImage();
  });
}

/* Load latest image(s) date and images for that date */
async function setLatestImage() {
  if (!navigator.onLine) {
    return;
  }

  let imageType: ImageType;
  if (isExtension) {
    document.title = "New Tab";
    const options = await browser.storage.sync.get(DEFAULT_OPTIONS);
    imageType = options.imageType;
  } else {
    imageType = getSatelliteFromURL();
  }

  if (imageType === DSCOVR_EPIC || imageType === DSCOVR_EPIC_ENHANCED) {
    setDscovrImage(await getLatestDscovrDate(imageType), imageType);
    return;
  }

  // Any SLIDER satellite (falls back to Himawari-9 for unknown/legacy stored values).
  const sat = SLIDER_SATS[imageType] || SLIDER_SATS[HIMAWARI_9];
  const resolvedType = SLIDER_SATS[imageType] ? imageType : HIMAWARI_9;
  setSliderImages(await getLatestSliderDate(sat), sat, resolvedType);
}

/** Load image from local storage */
function setCachedImage() {
  const canvas = document.getElementById("output") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");
  const date = new Date(localStorage.getItem(CACHED_DATE_KEY));

  const img = new Image();
  img.onload = () => {
    ctx.canvas.width = img.width;
    ctx.canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    updateStateAndUI(date, localStorage.getItem(CACHED_IMAGE_TYPE_KEY) as ImageType);
  };
  img.src = localStorage.getItem(IMAGE_DATA_KEY);
}

// check if there are new images form time to time
window.setInterval(setLatestImage, RELOAD_INTERVAL);

// also load a new image when we come back online
window.addEventListener("online", setLatestImage);

function init() {
  // initial loading
  if (localStorage.getItem(CACHED_DATE_KEY)) {
    setCachedImage();
  }
  setLatestImage();
}

// enable or disable animation
if (isExtension) {
  browser.storage.sync.get(DEFAULT_OPTIONS).then(options => {
    if (options.animated) {
      document.body.classList.add("animated");
    } else {
      document.body.classList.remove("animated");
    }
    init();
  });
} else {
  setupSatelliteDropdown();
  init();
}

// update the time ago
window.setInterval(() => {
  if (loadedDate) {
    updateTimeAgo(loadedDate);
  }
}, RELOAD_TIME_INTERVAL);

// hide some things if we are not an extension
if (isExtension) {
  // when we are in an extension and the storage updates, try to load the new image
  browser.storage.onChanged.addListener(setLatestImage);

  document.body.classList.add("extension");
  document.getElementById("go-to-options").addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });
}

document.getElementById("explore").addEventListener("click", () => {
  switch (loadedType) {
    case DSCOVR_EPIC:
      window.open(DSCOVR_EXPLORER, "_self");
      break;
    case DSCOVR_EPIC_ENHANCED:
      window.open(DSCOVR_EXPLORER_ENHANCED, "_self");
      break;
    default:
      // all SLIDER satellites
      window.open(SLIDER_EXPLORER, "_self");
      break;
  }
});
