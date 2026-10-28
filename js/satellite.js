// Geostationary cloud loop centred on the site, from whichever satellite sees it best:
// GOES-East/West (GeoColor or infrared, NASA GIBS), Meteosat MTG and Indian Ocean (EUMETSAT), Himawari (NASA GIBS).
const BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best", OUT = 768, FRAMES = 8;

function satellite(lat, lon) {
  if (Math.abs(lat) > 62) return null;
  if (lon >= -106 && lon <= -20) return { name: "GOES-East", goes: true };
  if (lon >= -175 && lon < -106) return { name: "GOES-West", goes: true };
  if (lon >= -20 && lon < 40) return { name: "Meteosat MTG", eum: ["mtg_fd:ir105_hrfi", 600] };
  if (lon >= 40 && lon < 85) return { name: "Meteosat Indian Ocean", eum: ["msg_iodc:ir108", 900] };
  return { name: "Himawari" };
}
export const geoColorAvailable = site => !!satellite(site.lat, site.lon)?.goes;

import { sunAlt } from "./astro.js";

/** What each band shows. */
const HOW = {
  GeoColor: "GeoColor is true colour by day; after dark it shows infrared cloud over city lights. Low cloud and fog can be hard to see at night.",
  Infrared: "Infrared shows cloud day and night: the whiter the cloud, the colder and higher its top. Low cloud is close to ground temperature and can look faint.",
  "Air Mass": "Air Mass colours the upper air: thick high cloud shows white, mid-level cloud tan, dry air red-orange and moist air green. Low cloud barely shows.",
  Visible: "Visible light, daytime only: cloud and snow show white, clear ground dark. Low cloud and fog show well.",
};
const merc = (lat, lon, world) => { const phi = lat * Math.PI / 180; return [(lon + 180) / 360 * world, (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * world]; };
const img = (url, cors = true) => new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
/** NASA's tile servers sometimes answer "not found" for tiles that exist, so try a few times (bypassing the cached miss). */
async function tileImg(url) {
  for (let k = 0; k < 4; k++) { const i = await img(k ? `${url}?try=${k}` : url); if (i) return i; await new Promise(r => setTimeout(r, 250)); }
  return null;
}
const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");

// Looks back a day, so when NASA's feed stalls the loop still shows its latest real frames, with their true times.
async function times(layer, tms) {
  const end = Date.now(), start = end - 24 * 3600e3;
  try {
    const xml = await (await fetch(`${BASE}/1.0.0/${layer}/default/${tms}/all/${iso(start)}--${iso(end)}.xml`)).text();
    const m = xml.match(/<Domain>([\s\S]*?)<\/Domain>/); if (!m) return [];
    const out = [];
    for (const part of m[1].split(",")) {
      const [a, b] = part.trim().split("/"); let t = Date.parse(a); const e = b ? Date.parse(b) : t;
      while (t <= e) { out.push(t); t += 600e3; }
    }
    return out.sort((a, b) => a - b);
  } catch { return []; }
}

async function mosaic(layer, time, tms, z, maxZ, lat, lon, viewPx) {
  const world = 256 * 2 ** z, [px, py] = merc(lat, lon, world), half = viewPx / 2;
  const x0 = Math.floor((px - half) / 256), x1 = Math.floor((px + half) / 256), y0 = Math.floor((py - half) / 256), y1 = Math.floor((py + half) / 256);
  const n = 1 << z, jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (ty < 0 || ty >= n) continue;
    const col = ((tx % n) + n) % n, t = time ? iso(time) : "default";
    const url = time ? `${BASE}/${layer}/default/${t}/${tms}/${z}/${ty}/${col}.png` : `${BASE}/${layer}/default/${tms}/${z}/${ty}/${col}.png`;
    jobs.push(tileImg(url).then(i => [tx, ty, i]));
  }
  const tiles = await Promise.all(jobs);
  // NASA sometimes lists a time before all its tiles exist; a frame with holes in it is no use.
  if (tiles.some(t => !t[2])) return null;
  const c = document.createElement("canvas"); c.width = c.height = OUT;
  const ctx = c.getContext("2d"), s = OUT / viewPx, cx = px - half, cy = py - half;
  for (const [tx, ty, i] of tiles) if (i) ctx.drawImage(i, (tx * 256 - cx) * s, (ty * 256 - cy) * s, 256 * s, 256 * s);
  return c;
}

/** NASA colours the coldest infrared cloud tops cyan/blue; remap to white clouds on dark ground. */
function whiteClouds(c) {
  const ctx = c.getContext("2d"), d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const out = Math.max(r, g, b) - Math.min(r, g, b) >= 12 ? 255 : r <= 140 ? 50 + Math.max(0, r - 110) / 30 * 30 : Math.min(255, 80 + (r - 140) / 60 * 175);
    p[i] = p[i + 1] = p[i + 2] = out;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** Red-mode version of a frame: cloud brightness stretched to full contrast and tinted deep red. Air Mass is a colour
 *  product (white = thick cloud), so there the least saturated channel stands in for cloud brightness. */
export function nightImage(src, band) {
  const c = document.createElement("canvas"); c.width = src.width; c.height = src.height;
  const ctx = c.getContext("2d"); ctx.drawImage(src, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data, n = p.length / 4, v = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2]; v[i] = band === "Air Mass" ? Math.min(r, g, b) : 0.3 * r + 0.59 * g + 0.11 * b; }
  const s = Float32Array.from(v).sort(), lo = s[Math.floor(n * 0.02)], hi = Math.max(s[Math.floor(n * 0.995)], lo + 1);
  for (let i = 0; i < n; i++) {
    const k = Math.pow(Math.min(1, Math.max(0, (v[i] - lo) / (hi - lo))), 0.9);
    p[i * 4] = 12 + k * 156; p[i * 4 + 1] = 2 + k * 26; p[i * 4 + 2] = 1 + k * 15; p[i * 4 + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

function eumetsat(layer, time, lat, lon, z) {
  const r = 6378137, phi = lat * Math.PI / 180, cx = lon * Math.PI / 180 * r, cy = r * Math.log(Math.tan(Math.PI / 4 + phi / 2));
  const half = OUT / 2 * (2 * Math.PI * r / (256 * 2 ** z));
  const q = new URLSearchParams({ service: "WMS", version: "1.3.0", request: "GetMap", layers: layer, styles: "", format: "image/png", crs: "EPSG:3857",
    bbox: [cx - half, cy - half, cx + half, cy + half].map(v => v.toFixed(0)).join(","), width: OUT, height: OUT, time: iso(time) });
  return img("https://view.eumetsat.int/geoserver/wms?" + q, false);
}

/** Loads frames into `onFrame(list)` as they arrive. Returns {source, note, how, infraredOnly, staleSince}. `cancelled()` stops early. */
export async function loadLoop(site, product, zoomName, onFrame, setStatus, cancelled) {
  const sat = satellite(site.lat, site.lon), zoom = zoomName === "Local" ? 7 : 5;
  const frames = [];
  if (!sat) { setStatus("Geostationary satellites don't see this far toward the pole, so there's no satellite view for this site."); return {}; }
  setStatus("Loading satellite images…");
  if (sat.eum) {
    const [layer, step] = sat.eum;
    let t = Math.floor((Date.now() / 1000 - 1200) / step) * step, newest = null;
    const oldest = t - 6 * 3600;
    while (!newest && t >= oldest && !cancelled()) { const i = await eumetsat(layer, t * 1000, site.lat, site.lon, zoom); if (i) newest = [t, i]; else t -= Math.max(step, 1800); }
    if (!newest) { setStatus("Satellite images couldn't load. Check your connection and try again."); return {}; }
    frames.push({ t: newest[0], img: newest[1] }); setStatus(null); onFrame(frames, true);
    for (let k = 1; k < FRAMES && !cancelled(); k++) {
      const tt = newest[0] - k * step, i = await eumetsat(layer, tt * 1000, site.lat, site.lon, zoom);
      if (i) { frames.unshift({ t: tt, img: i }); onFrame(frames); }
    }
    return { source: `${sat.name} Infrared · EUMETSAT`, how: HOW.Infrared, infraredOnly: true, zoom };
  }
  // Bands in order of preference. NASA's feeds stall now and then, one band at a time, so use the first that's
  // under an hour old; if none is, the freshest. Visible light is only offered while the sun is up at the site.
  const want = sat.goes ? product : "Infrared";
  const cands = (sat.goes ? [want, want === "GeoColor" ? "Infrared" : "GeoColor"] : ["Infrared"]).concat("Air Mass");
  if (sunAlt(Date.now() / 1000, site.lat, site.lon) > 5) cands.push("Visible");
  const pre = sat.name === "Himawari" ? "Himawari_AHI" : `${sat.name}_ABI`;
  const band = b => {
    const [suffix, maxZ] = { GeoColor: ["GeoColor", 7], Infrared: ["Band13_Clean_Infrared", 6], "Air Mass": ["Air_Mass", 6],
      Visible: [sat.name === "Himawari" ? "Band3_Red_Visible_1km" : "Band2_Red_Visible_1km", 7] }[b];
    return { name: b, layer: `${pre}_${suffix}`, maxZ, tms: `GoogleMapsCompatible_Level${maxZ}` };
  };
  const found = await Promise.all(cands.map(async b => { const d = band(b); return { ...d, ts: await times(d.layer, d.tms) }; }));
  if (cancelled()) return {};
  const geo = c => { const z = Math.min(zoom, c.maxZ); return { z, view: OUT / 2 ** (zoom - z) }; };
  const load = (c, t) => { const { z, view } = geo(c); return mosaic(c.layer, t, c.tms, z, c.maxZ, site.lat, site.lon, view); };

  // A band is live if one of its frames from the last hour loads in full.
  let pick = null, first = null;
  for (const c of found) {
    for (const t of c.ts.filter(t => Date.now() - t <= 60 * 60e3).reverse().slice(0, 3)) {
      if (cancelled()) return {};
      const img = await load(c, t);
      if (img) { pick = c; first = { t, img }; break; }
    }
    if (pick) break;
  }
  // None is: use the band with the freshest list (an earlier band wins unless clearly fresher).
  const newest = c => c.ts.length ? c.ts[c.ts.length - 1] : -Infinity;
  if (!pick) for (const c of found) if (!pick || newest(c) - newest(pick) > 30 * 60e3) pick = c;

  const prod = pick.name, finish = c => prod === "Infrared" ? whiteClouds(c) : c;
  const skipped = found.slice(0, found.indexOf(pick)).map(c => c.name === "GeoColor" ? c.name : c.name.toLowerCase());
  const note = skipped.length ? `NASA's ${skipped.join(" and ")} ${skipped.length > 1 ? "feeds are" : "feed is"} behind, so this is the ${prod} band instead.` : null;
  const info = { source: `${sat.name} ${prod} · NASA GIBS`, note, how: HOW[prod], infraredOnly: !sat.goes, zoom, product: prod };
  if (!pick.ts.length) {
    const c = await load(pick, null);
    if (c) { frames.push({ t: null, img: finish(c), band: prod }); setStatus(null); onFrame(frames, true); }
    else setStatus("Satellite images couldn't load. Check your connection and try again.");
    return info;
  }
  // Newest complete frame first so something shows quickly, then fill in the loop, skipping frames with holes.
  const add = (t, img) => { frames.unshift({ t: t / 1000, img: finish(img), band: prod }); const one = frames.length === 1; if (one) setStatus(null); onFrame(frames, one); };
  if (first) add(first.t, first.img);
  for (const t of pick.ts.filter(t => !first || t < first.t).reverse().slice(0, FRAMES * 3)) {
    if (cancelled() || frames.length >= FRAMES) break;
    if (frames.length && frames[frames.length - 1].t - t / 1000 > 3 * 3600) break;   // keep the loop to the last 3 hours
    const img = await load(pick, t);
    if (img) add(t, img);
  }
  if (!frames.length) setStatus("Satellite images couldn't load. Check your connection and try again.");
  else if (Date.now() / 1000 - frames[frames.length - 1].t > 3600) info.staleSince = frames[frames.length - 1].t;
  return info;
}

// State, province and country borders (Natural Earth), drawn over the image.
let BORDERS = null;
export async function drawBorders(ctx, site, zoom, size, color) {
  BORDERS ??= fetch("data/Borders.json").then(r => r.json()).catch(() => null);
  const B = await BORDERS; if (!B) { BORDERS = null; return; }
  const world = 256 * 2 ** zoom, [cx, cy] = merc(site.lat, site.lon, world), k = size / OUT, x0 = cx - OUT / 2, y0 = cy - OUT / 2;
  const path = lines => {
    const p = new Path2D();
    for (const line of lines) {
      const pts = line.map(q => { const [mx, my] = merc(Math.max(-85, Math.min(85, q[1])), q[0], world); return [(mx - x0) * k, (my - y0) * k]; });
      if (!pts.some(([x, y]) => x > -20 && y > -20 && x < size + 20 && y < size + 20)) continue;
      p.moveTo(...pts[0]);
      for (let i = 1; i < pts.length; i++) Math.abs(line[i][0] - line[i - 1][0]) > 180 ? p.moveTo(...pts[i]) : p.lineTo(...pts[i]);
    }
    return p;
  };
  ctx.lineCap = ctx.lineJoin = "round";
  for (const [lines, w, a] of [[B.coast, 1, .55], [B.states, .9, .6], [B.countries, 1.4, .75]]) {
    const p = path(lines);
    ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = w + 1.6; ctx.stroke(p);
    ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(p); ctx.globalAlpha = 1;
  }
}
