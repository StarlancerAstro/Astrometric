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

const merc = (lat, lon, world) => { const phi = lat * Math.PI / 180; return [(lon + 180) / 360 * world, (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * world]; };
const img = (url, cors = true) => new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");

async function times(layer, tms) {
  const end = Date.now(), start = end - 4 * 3600e3;
  try {
    const xml = await (await fetch(`${BASE}/1.0.0/${layer}/default/${tms}/all/${iso(start)}--${iso(end)}.xml`)).text();
    const m = xml.match(/<Domain>([\s\S]*?)<\/Domain>/); if (!m) return [];
    const out = [];
    for (const part of m[1].split(",")) {
      const [a, b] = part.trim().split("/"); let t = Date.parse(a); const e = b ? Date.parse(b) : t;
      while (t <= e) { out.push(t); t += 600e3; }
    }
    return out.sort((a, b) => a - b).slice(-FRAMES);
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
    jobs.push(img(url).then(i => [tx, ty, i]));
  }
  const tiles = await Promise.all(jobs);
  if (!tiles.some(t => t[2])) return null;
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

function eumetsat(layer, time, lat, lon, z) {
  const r = 6378137, phi = lat * Math.PI / 180, cx = lon * Math.PI / 180 * r, cy = r * Math.log(Math.tan(Math.PI / 4 + phi / 2));
  const half = OUT / 2 * (2 * Math.PI * r / (256 * 2 ** z));
  const q = new URLSearchParams({ service: "WMS", version: "1.3.0", request: "GetMap", layers: layer, styles: "", format: "image/png", crs: "EPSG:3857",
    bbox: [cx - half, cy - half, cx + half, cy + half].map(v => v.toFixed(0)).join(","), width: OUT, height: OUT, time: iso(time) });
  return img("https://view.eumetsat.int/geoserver/wms?" + q, false);
}

/** Loads frames into `onFrame(list)` as they arrive. Returns {source, note, infraredOnly}. `cancelled()` stops early. */
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
    return { source: `${sat.name} Infrared · EUMETSAT`, infraredOnly: true, zoom };
  }
  let prod = sat.goes ? product : "Infrared", note = null;
  if (prod === "GeoColor") {
    const gt = await times(`${sat.name}_ABI_GeoColor`, "GoogleMapsCompatible_Level7");
    const age = gt.length ? (Date.now() - gt[gt.length - 1]) / 1000 : Infinity;
    if (age > 90 * 60) {
      prod = "Infrared";
      note = isFinite(age) ? `NASA's GeoColor feed is ${Math.floor(age / 3600)} h behind, so this is the live infrared loop instead.` : "NASA's GeoColor feed isn't updating right now, so this is the live infrared loop instead.";
    }
  }
  const layer = sat.name === "Himawari" ? "Himawari_AHI_Band13_Clean_Infrared" : `${sat.name}_${prod === "GeoColor" ? "ABI_GeoColor" : "ABI_Band13_Clean_Infrared"}`;
  const maxZ = sat.name === "Himawari" ? 6 : prod === "GeoColor" ? 7 : 6, z = Math.min(zoom, maxZ), tms = `GoogleMapsCompatible_Level${maxZ}`;
  const view = OUT / 2 ** (zoom - z), finish = c => prod === "Infrared" ? whiteClouds(c) : c;
  const info = { source: `${sat.name} ${prod} · NASA GIBS`, note, infraredOnly: !sat.goes, zoom, product: prod };
  const ts = await times(layer, tms);
  if (cancelled()) return info;
  if (!ts.length) {
    const c = await mosaic(layer, null, tms, z, maxZ, site.lat, site.lon, view);
    if (c) { frames.push({ t: Date.now() / 1000, img: finish(c) }); setStatus(null); onFrame(frames, true); }
    else setStatus("Satellite images couldn't load. Check your connection and try again.");
    return info;
  }
  for (const [k, t] of [...ts].reverse().entries()) {
    if (cancelled()) return info;
    const c = await mosaic(layer, t, tms, z, maxZ, site.lat, site.lon, view);
    if (c) { frames.unshift({ t: t / 1000, img: finish(c) }); if (k === 0) setStatus(null); onFrame(frames, k === 0); }
  }
  if (!frames.length) setStatus("Satellite images couldn't load. Check your connection and try again.");
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
