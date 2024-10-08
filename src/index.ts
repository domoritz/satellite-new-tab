import { utcFormat, utcParse } from "d3-time-format";

// base url for images
const HIMAWARI_BASE_URL = "https://himawari8-dl.nict.go.jp/himawari8/img/";
const DSCOVR_BASE_URL = "https://epic.gsfc.nasa.gov/";

const SLIDER_BASE_URL = "https://rammb-slider.cira.colostate.edu/data/";

// links to online image explorers
const HIMAWARI_EXPLORER = "https://himawari8.nict.go.jp/himawari8-image.htm?sI=D531106";
const DSCOVR_EXPLORER = "https://epic.gsfc.nasa.gov";
const DSCOVR_EXPLORER_ENHANCED = DSCOVR_EXPLORER + "/enhanced";
const SLIDER_EXPLORER = "https://rammb-slider.cira.colostate.edu/";
const METEOSAT_EXPLORER = "https://eumetview.eumetsat.int/static-images/";

// image types
const INFRARED = "INFRARED_FULL";
const VISIBLE_LIGHT = "D531106";
const DSCOVR_EPIC = "EPIC";
const DSCOVR_EPIC_ENHANCED = "EPIC_ENHANCED";
const GOES_16 = "GOES_16";
const GOES_16_NATURAL = "GOES_16_NATURAL";
const GOES_18 = "GOES_18";
const GOES_18_NATURAL = "GOES_18_NATURAL";
const GOES_19 = "GOES_19";
const GOES_19_NATURAL = "GOES_19_NATURAL";
const METEOSAT = "METEOSAT";
const METEOSAT_IODC = "METEOSAT_IODC";
const HIMAWARI_9 = "HIMAWARI_9";

type ImageType = typeof INFRARED | typeof VISIBLE_LIGHT | typeof DSCOVR_EPIC |
  typeof DSCOVR_EPIC_ENHANCED |
  typeof GOES_16 | typeof GOES_16_NATURAL | typeof GOES_18 | typeof GOES_18_NATURAL | typeof GOES_19 | typeof GOES_19_NATURAL |
  typeof METEOSAT | typeof METEOSAT_IODC |
  typeof HIMAWARI_9;

const HIMAWARI_WIDTH = 550;
const HIMAWARI_BLOCK_SIZES = [1, 4, 8, 16, 20];

const SLIDER_WIDTH = 678;
const SLIDER_BLOCK_SIZES = [1, 2, 4, 8, 16];

const DSCOVR_WIDTH = 2048;

const METEOSAT_WIDTH = 3712;
const METEOSAT_HEIGHT = 3630;  // cut off white bar, credit in options

const IMAGE_QUALITY = 0.95;
const RELOAD_INTERVAL = 1 * 60 * 1000;  // 1 minutes
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
  imageType: VISIBLE_LIGHT,
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

/**
 * Returns an array of objects containing URLs and metadata
 * for Himawari 8 image tiles based on a given date.
 * Options:
 * - date: Date object
 * - type: boolean (default: visible light)
 * - blocks: alternative to zoom, how many images per row/column (default: 1)
 *      Has to be a valid block number (1, 4, 8, 16, 20)
 *
 * @param  {Object}       options
 */
function himawariURLs(options: {date: Date; type?: ImageType; blocks: number}) {
  const baseURL = HIMAWARI_BASE_URL + (options.type || VISIBLE_LIGHT);
  const date = options.date;

  // Define some image parameters
  const blocks = options.blocks;

  // compose URL
  const tilesURL = `${baseURL}/${blocks}d/${HIMAWARI_WIDTH}/${utcFormat("%Y/%m/%d/%H%M%S")(date)}`;
  const tiles: Tile[] = [];

  for (let y = 0; y < blocks; y++) {
    for (let x = 0; x < blocks; x++) {
      const url = `${tilesURL}_${x}_${y}.png`;

      tiles.push({
        url,
        x,
        y,
      });
    }
  }

  return {
    blocks,
    date,
    tiles,
  };
}

function sliderURLs(options: {date: Date; type: ImageType; blocks: number; level: number}) {
  const date = options.date;

  const blocks = options.blocks;
  const level = options.level;

  const typePath = {
    GOES_16: "geocolor",
    GOES_16_NATURAL: "natural_color",
    GOES_18: "geocolor",
    GOES_18_NATURAL: "natural_color",
    GOES_19: "geocolor",
    GOES_19_NATURAL: "natural_color",
    HIMAWARI_9: "geocolor",
  }[options.type];

  const which = {
    GOES_16: "goes-16",
    GOES_16_NATURAL: "goes-16",
    GOES_18: "goes-17",
    GOES_18_NATURAL: "goes-17",
    GOES_19: "goes-19",
    GOES_19_NATURAL: "goes-19",
    HIMAWARI_9: "himawari",
  }[options.type];

  const formattedDate = utcFormat("%Y/%m/%d")(options.date);
  const formattedDateTime = utcFormat("%Y%m%d%H%M%S")(options.date);

  const tilesURL = `${SLIDER_BASE_URL}imagery/${formattedDate}/${which}---full_disk/${typePath}/${formattedDateTime}/`;
  const tiles: Tile[] = [];

  for (let y = 0; y < blocks; y++) {
    for (let x = 0; x < blocks; x++) {
      const url = `${tilesURL}${pad(level, 2)}/${pad(y, 3)}_${pad(x, 3)}.png`;

      tiles.push({
        url,
        x,
        y,
      });
    }
  }

  return {
    blocks,
    date,
    tiles,
  };
}

/**
 * Get the date of the latest Himawari image by making an Ajax request.
 * @param   {string}  imageType  The type of image
 * @returns {date}  The parsed date
 */
async function getLatestHimawariDate(imageType: ImageType) {
  const raw = await fetch(`https://himawari-8.appspot.com/latest${imageType === INFRARED ? "?infrared=true" : ""}`);
  const data: {date: string} = await raw.json();

  const latest = data.date;
  return utcParse("%Y-%m-%d %H:%M:%S")(latest)
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

async function getLatestSliderDate(imageType: ImageType) {
  const which = {
    GOES_16: "goes-16",
    GOES_16_NATURAL: "goes-16",
    GOES_18: "goes-17",
    GOES_18_NATURAL: "goes-17",
    GOES_19: "goes-19",
    GOES_19_NATURAL: "goes-19",
    HIMAWARI_9: "himawari",
  }[imageType];

  const raw = await fetch(sliderProxy(`${SLIDER_BASE_URL}json/${which}/full_disk/geocolor/latest_times.json`));
  const data: {timestamps_int: string[]} = await raw.json();

  return utcParse("%Y%m%d%H%M%S")(data.timestamps_int[0]);
}

async function getLatestMeteosatDate(imageType: ImageType) {
  const raw = await fetch(`https://meteosat-url.appspot.com/msg${imageType === METEOSAT_IODC ? "iodc" : ""}`);
  const data: {url: string; date: string} = await raw.json();

  return {
    date: utcParse("%Y-%m-%d %H:%M:%S")(data.date),
    image: data.url,
  }
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
 * Set the right class on the body so that we can have different css.
 */
function setBodyClass(imageType: ImageType) {
  document.body.classList.remove("himawari");
  document.body.classList.remove("dscovr");
  document.body.classList.remove("goes");
  document.body.classList.remove("goes16");
  document.body.classList.remove("meteosat");

  switch (imageType) {
    case INFRARED:
    case VISIBLE_LIGHT:
    case HIMAWARI_9:
      document.body.classList.add("himawari");
      break;
    case DSCOVR_EPIC:
    case DSCOVR_EPIC_ENHANCED:
      document.body.classList.add("dscovr");
      break;
    case GOES_16:
    case GOES_16_NATURAL:
    case GOES_18:
    case GOES_18_NATURAL:
    case GOES_19:
    case GOES_19_NATURAL:
      document.body.classList.add("goes");
      break;
    case METEOSAT:
    case METEOSAT_IODC:
      document.body.classList.add("meteosat");
      break;
    default:
      console.warn("Unknown image type", imageType);
  }
}

function updateStateAndUI(date: Date, imageType: ImageType) {
  updateTimeAgo(date);
  loadedDate = date;
  setBodyClass(imageType);
  loadedType = imageType;
}

/**
 * Cache the image.
 */
function storeCanvas(date: Date, imageType: ImageType, quality = IMAGE_QUALITY) {
  // put date and image data in cache
  const canvas = document.getElementById("output") as HTMLCanvasElement;
  const imageData = canvas.toDataURL("image/jpeg", quality);
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

/**
 * Creates an image composed of tiles.
 * @param {Date object} date  The date for which to load the data.
 */
function setHimawariImages(date: Date, imageType: ImageType) {
  // no need to set images if we have up to date images and the image type has not changed
  if (loadedDate && date.getTime() === loadedDate.getTime() && loadedType === imageType) {
    return;
  }

  // if we haven't loaded images before, we want to show progress
  const initialLoad = !localStorage.getItem(CACHED_DATE_KEY);

  // immediately set the type and body class because we are not loading in the background
  if (initialLoad) {
    updateStateAndUI(date, imageType);
  }

  // get the URLs for all tiles
  const result = himawariURLs({
    blocks: getOptimalNumberOfBlocks(HIMAWARI_WIDTH, HIMAWARI_BLOCK_SIZES).blocks,
    date,
    type: imageType,
  });

  const pixels = result.blocks * HIMAWARI_WIDTH;

  const canvas = initialLoad ? document.getElementById("output") as HTMLCanvasElement : document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.canvas.width = pixels;
  ctx.canvas.height = pixels;

  // add image to canvas
  function addImage(tile: Tile) {
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.setAttribute("crossOrigin", "anonymous");
      img.onload = () => {
        ctx.drawImage(img, tile.x * HIMAWARI_WIDTH, tile.y * HIMAWARI_WIDTH, HIMAWARI_WIDTH, HIMAWARI_WIDTH);
        resolve();
      };
      img.src = tile.url;
    });
  }

  Promise.all(result.tiles.map(tile => addImage(tile)))
    .catch(error => {
      throw error;
    })
    .then(() => {
      if (!initialLoad) {
        // copy canvas into output in one step
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

function setSliderImages(date: Date, imageType: ImageType) {
  // no need to set images if we have up to date images and the image type has not changed
  if (loadedDate && date.getTime() === loadedDate.getTime() && loadedType === imageType) {
    return;
  }

  // if we haven't loaded images before, we want to show progress
  const initialLoad = !localStorage.getItem(CACHED_DATE_KEY);

  // immediately set the type and body class because we are not loading in the background
  if (initialLoad) {
    updateStateAndUI(date, imageType);
  }

  // get the URLs for all tiles
  const result = sliderURLs({
    date,
    type: imageType,
    ...getOptimalNumberOfBlocks(SLIDER_WIDTH, SLIDER_BLOCK_SIZES),
  });

  const pixels = result.blocks * SLIDER_WIDTH;

  const canvas = initialLoad ? document.getElementById("output") as HTMLCanvasElement : document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.canvas.width = pixels;
  ctx.canvas.height = pixels;

  // add image to canvas
  function addImage(tile: Tile) {
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.setAttribute("crossOrigin", "anonymous");
      img.onload = () => {
        ctx.drawImage(img, tile.x * SLIDER_WIDTH, tile.y * SLIDER_WIDTH, SLIDER_WIDTH, SLIDER_WIDTH);
        resolve();
      };
      img.src = sliderProxy(tile.url);
    });
  }

  Promise.all(result.tiles.map(tile => addImage(tile)))
    .catch(error => {
      throw error;
    })
    .then(() => {
      if (!initialLoad) {
        // copy canvas into output in one step
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

function setMeteosatImages(latest: {date: Date; image: string}, imageType: ImageType) {
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
  ctx.canvas.width = METEOSAT_WIDTH;
  ctx.canvas.height = METEOSAT_HEIGHT;

  const img = new Image();
  img.setAttribute("crossOrigin", "anonymous");
  img.onload = () => {
    ctx.drawImage(img, 0, 0);

    if (!initialLoad) {
      // copy canvas into output in one step
      const output = document.getElementById("output") as HTMLCanvasElement;
      const outCtx = output.getContext("2d");
      outCtx.canvas.width = METEOSAT_WIDTH;
      outCtx.canvas.height = METEOSAT_HEIGHT;
      outCtx.drawImage(canvas, 0, 0);
    }

    updateStateAndUI(latest.date, imageType);

    storeCanvas(latest.date, imageType);
  };

  img.src = latest.image;
}

/* Load latest image(s) date and images for that date */
async function setLatestImage() {
  if (!navigator.onLine) {
    // browser is offline, no need to do this
    return;
  }

  if (isExtension) {
    document.title = "New Tab";

    const {imageType} = await browser.storage.sync.get(DEFAULT_OPTIONS)

    switch (imageType) {
      case DSCOVR_EPIC:
      case DSCOVR_EPIC_ENHANCED:
        setDscovrImage(await getLatestDscovrDate(imageType), imageType);
        break;
      case GOES_16:
      case GOES_16_NATURAL:
      case GOES_18:
      case GOES_18_NATURAL:
      case GOES_19:
      case GOES_19_NATURAL:
        setSliderImages(await getLatestSliderDate(imageType), imageType);
        break;
      case METEOSAT:
      case METEOSAT_IODC:
        setMeteosatImages(await getLatestMeteosatDate(imageType), imageType)
        break;
      case INFRARED:
      case VISIBLE_LIGHT:
        setHimawariImages(await getLatestHimawariDate(imageType), imageType)
        break;
      case HIMAWARI_9:
      default:
        setSliderImages(await getLatestSliderDate(imageType), imageType)
        break;
    }
  } else {
    // if we are not in the extension, let's always load visible light
    setSliderImages(await getLatestSliderDate(HIMAWARI_9), HIMAWARI_9)
  }
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
    case GOES_16:
    case GOES_16_NATURAL:
    case GOES_18:
    case GOES_18_NATURAL:
    case GOES_19:
    case GOES_19_NATURAL:
    case HIMAWARI_9:
      window.open(SLIDER_EXPLORER, "_self");
      break;
    case INFRARED:
    case VISIBLE_LIGHT:
      window.open(HIMAWARI_EXPLORER, "_self");
      break;
    case METEOSAT:
    case METEOSAT_IODC:
      window.open(METEOSAT_EXPLORER, "_self");
      break;
    default:
      window.alert("No explorer found.");
      break;
  }
});
