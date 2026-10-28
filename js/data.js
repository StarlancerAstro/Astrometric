// Forecast, scoring, nights, light pollution and the sky-brightness model (ported from the Astrometric app).
import * as A from "./astro.js";
const { clamp } = A;

export const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};

export const siteKey = s => `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`;
export const sameSite = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lon - b.lon) < 0.002;
export const shortName = n => n.split(",")[0];

// MARK: Formatting in the site's own time zone
export class Fmt {
  constructor(off) { this.off = off; }
  d(t) { return new Date((t + this.off) * 1000); }
  time(t) {
    if (t == null) return "—";
    const d = this.d(t), h = d.getUTCHours(), m = d.getUTCMinutes();
    return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? "a" : "p");
  }
  hour(t) { const h = this.d(t).getUTCHours(); return (h % 12 || 12) + (h < 12 ? "a" : "p"); }
  hourOfDay(t) { return this.d(t).getUTCHours(); }
  dow(t) { return DOW[this.d(t).getUTCDay()]; }
  monthDay(t) { const d = this.d(t); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); }
  day(t) { return this.dow(t) + " " + this.monthDay(t); }
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const hrs = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h + "h" + (m ? " " + String(m).padStart(2, "0") + "m" : ""); };

// MARK: Scoring
const lin = (x, good, bad) => clamp((x - bad) / (good - bad), 0, 1);
export function factors(h) {
  const cloudEff = Math.max(h.cc, h.ccl * 1.15, h.pp > 60 ? 80 : 0);
  let dark = h.sun > -6 ? 0 : h.sun > -18 ? 0.25 + 0.5 * (-6 - h.sun) / 12 : 1;
  if (h.moon > 0) dark *= 1 - h.illum * (0.55 + 0.4 * Math.min(h.moon / 40, 1));
  return {
    clouds: Math.pow(1 - clamp(cloudEff, 0, 100) / 100, 1.4),
    transp: lin(h.rh, 45, 97),
    seeing: h.jet == null ? 0.6 : lin(h.jet, 20, 100),
    wind: lin(h.gust, 10, 32),
    dark,
  };
}
export const score = f => Math.round(100 * f.clouds * (0.30 * f.transp + 0.22 * f.seeing + 0.13 * f.wind + 0.35 * f.dark));
export const verdict = s => s >= 75 ? "Excellent night" : s >= 55 ? "Good night" : s >= 35 ? "Patchy night" : "Poor night";

// MARK: Network
const VARS = "temperature_2m,dew_point_2m,relative_humidity_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_gusts_10m,wind_speed_10m,precipitation_probability,visibility,surface_pressure";

async function fetchT(url, ms = 45000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { signal: c.signal }); } finally { clearTimeout(t); }
}

export async function fetchForecast(site) {
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${site.lat.toFixed(4)}&longitude=${site.lon.toFixed(4)}` +
    "&timezone=auto&timeformat=unixtime&past_days=1&forecast_days=8&temperature_unit=fahrenheit&wind_speed_unit=mph&daily=sunrise&hourly=";
  let r;
  try {
    r = await fetchT(base + VARS + ",wind_speed_250hPa");
    if (!r.ok) r = await fetchT(base + VARS);
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "The forecast service took more than 45 seconds to answer." : "No response from the forecast service.");
  }
  if (!r.ok) {
    let reason = ""; try { reason = (await r.json()).reason || ""; } catch { }
    throw new Error(`The forecast service returned error ${r.status}${reason ? ": " + reason : ""}.`);
  }
  const j = await r.json(), H = j.hourly, visM = /ft/.test((j.hourly_units || {}).visibility || "") ? 0.3048 : 1;
  const g = (k, i, d) => H[k] && H[k][i] != null ? H[k][i] : d;
  return {
    off: j.utc_offset_seconds, midnights: j.daily.time, fetched: Date.now(),
    hours: H.time.map((t, i) => ({
      t, temp: g("temperature_2m", i, 50), dew: g("dew_point_2m", i, 40), rh: g("relative_humidity_2m", i, 60),
      cc: g("cloud_cover", i, 0), ccl: g("cloud_cover_low", i, 0), ccm: g("cloud_cover_mid", i, 0), cch: g("cloud_cover_high", i, 0),
      gust: g("wind_gusts_10m", i, 0), wind: g("wind_speed_10m", i, 0), pp: g("precipitation_probability", i, 0),
      vis: H.visibility && H.visibility[i] != null ? H.visibility[i] * visM : null, pres: g("surface_pressure", i, null),
      jet: H.wind_speed_250hPa ? H.wind_speed_250hPa[i] : null,
    })),
  };
}

/** Made-up but plausible week, used before a site is chosen or when offline. */
export function sampleForecast() {
  const off = -5 * 3600, now = Date.now() / 1000;
  const mid0 = Math.floor((now + off) / 86400) * 86400 - off - 86400;
  const midnights = [...Array(9)].map((_, k) => mid0 + k * 86400), hours = [];
  const fronts = [[1.4, 90], [3.1, 70], [5.6, 95]];
  for (let i = 0; i < 9 * 24; i++) {
    const t = mid0 + i * 3600, x = i / 24;
    let c = 8 + 10 * Math.sin(i / 4.1);
    for (const [fx, a] of fronts) c += a * Math.exp(-Math.pow((x - fx) / 0.45, 2));
    c = clamp(c, 0, 100);
    const di = Math.sin((i % 24 - 9) / 24 * 2 * Math.PI), rh = clamp(62 - 18 * di + c * 0.25, 30, 99), temp = 52 + 11 * di - x;
    hours.push({
      t, temp, dew: temp - clamp((100 - rh) / 4.5, 1, 20), rh, cc: c, ccl: c * 0.5, ccm: c * 0.7, cch: clamp(c * 0.6 + 12 * Math.sin(i / 7), 0, 100),
      gust: clamp(9 + 6 * Math.sin(i / 9) + c * 0.08, 2, 40), wind: clamp(5 + 4 * Math.sin(i / 9), 1, 30), pp: c > 80 ? 55 : 5,
      vis: clamp(40000 - c * 250, 2000, 50000), pres: 1012 + 4 * Math.sin(x), jet: clamp(55 + 35 * Math.sin(x * 1.3), 15, 120),
    });
  }
  return { off, midnights, hours, fetched: Date.now(), sample: true };
}

export async function fetchKp() {
  const j = await (await fetchT("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json", 20000)).json();
  const rows = [];
  const parse = (t, k) => { const ts = Date.parse(t.replace(" ", "T") + (t.endsWith("Z") ? "" : "Z")) / 1000, kp = +k; if (!isNaN(ts) && !isNaN(kp)) rows.push({ ts, kp }); };
  if (Array.isArray(j) && Array.isArray(j[0])) j.slice(1).forEach(r => parse(r[0], r[1]));
  else if (Array.isArray(j)) j.forEach(r => r.time_tag && parse(r.time_tag, r.kp));
  const now = Date.now() / 1000, fut = rows.filter(r => r.ts >= now - 3 * 3600 && r.ts <= now + 24 * 3600);
  const mx = fut.reduce((b, r) => !b || r.kp > b.kp ? r : b, null);
  const past = rows.filter(r => r.ts <= now);
  return { max: mx ? mx.kp : 0, at: mx ? mx.ts : null, now: past.length ? past[past.length - 1].kp : null };
}

export async function searchPlaces(q) {
  const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  return (await (await fetchT(u, 20000)).json()).results || [];
}

// MARK: Nights
export function enrich(f, site) {
  for (const h of f.hours) {
    h.sun = A.sunAlt(h.t, site.lat, site.lon); h.moon = A.moonAlt(h.t, site.lat, site.lon);
    h.illum = A.moonIllum(h.t).fraction; h.f = factors(h); h.score = score(h.f);
  }
}
function crossings(sm, key, th) {
  let down = null, up = null;
  for (let k = 1; k < sm.length; k++) {
    const a = sm[k - 1][key], b = sm[k][key];
    if (a >= th && b < th && down == null) down = sm[k].t;
    if (a < th && b >= th) up = sm[k].t;
  }
  return { down, up };
}
export function hourAt(f, t) { const k = Math.floor((t - f.hours[0].t) / 3600); return f.hours[clamp(k, 0, f.hours.length - 1)]; }

export function buildNights(f, site, { max = 7, extra = [], dewSpread = 3, catalog = [] } = {}) {
  const nights = [], now = Date.now() / 1000;
  let first = f.midnights.findIndex(m => m + 36 * 3600 > now); if (first < 0) first = 0;
  // Once morning nautical twilight is over (past midnight, sun above −12°), last night is done: start with the coming one.
  if (first + 2 < f.midnights.length && now > f.midnights[first + 1] && A.sunAlt(now, site.lat, site.lon) >= -12) first++;
  for (let i = first; i < Math.min(first + max, f.midnights.length - 1); i++) {
    const start = f.midnights[i] + 12 * 3600, end = start + 86400, sm = [];
    for (let t = start; t <= end; t += 300) sm.push({ t, s: A.sunAlt(t, site.lat, site.lon), m: A.moonAlt(t, site.lat, site.lon) });
    const sunset = crossings(sm, "s", -0.833), civ = crossings(sm, "s", -6), nau = crossings(sm, "s", -12), ast = crossings(sm, "s", -18);
    const astro = ast.down != null && ast.up != null;
    const dS = astro ? ast.down : nau.down, dE = astro ? ast.up : nau.up, thr = astro ? -18 : -12;
    const moonEv = [];
    for (let k = 1; k < sm.length; k++) if ((sm[k - 1].m < 0) !== (sm[k].m < 0)) moonEv.push({ t: sm[k].t, rise: sm[k].m >= 0 });
    const darkS = sm.filter(x => x.s < -18), moonUp = darkS.filter(x => x.m > 0).length;
    const hrsN = f.hours.filter(h => h.t >= start && h.t < end), dark = hrsN.filter(h => h.sun < thr);
    const gs = sunset.down != null ? Math.floor(sunset.down / 3600) * 3600 : start + 6 * 3600;
    const ge = sunset.up != null ? Math.ceil(sunset.up / 3600) * 3600 : end - 6 * 3600;
    const grid = hrsN.filter(h => h.t >= gs - 3600 && h.t <= ge);
    const sc = dark.length ? Math.round(dark.reduce((a, h) => a + h.score, 0) / dark.length) : 0;
    let best = null, run = null;
    for (const h of dark) {
      if (h.score >= 55) {
        if (run && h.t === run.e) run.e += 3600; else run = { s: h.t, e: h.t + 3600 };
        if (!best || run.e - run.s > best.e - best.s) best = { ...run };
      } else run = null;
    }
    const midT = i + 1 < f.midnights.length ? f.midnights[i + 1] : start + 12 * 3600, mi = A.moonIllum(midT);
    const n = {
      i: i - first, start, end, sm, sunset, civ, nau, ast, astro, dS, dE, dark, grid, score: sc, best,
      moon: { fraction: mi.fraction, phase: mi.phase, ev: moonEv, upFrac: darkS.length ? moonUp / darkS.length : 0 },
      dewH: dark.find(h => h.temp - h.dew <= dewSpread) || null,
    };
    details(n, f, site, extra, catalog);
    nights.push(n);
  }
  return nights;
}

function details(n, f, site, extra, catalog) {
  const obs = n.sm.filter(x => x.s < -6);
  n.planets = A.PLANETS.map(name => {
    const p = { name, max: -90, tMax: null, first: null, last: null };
    for (const x of obs) {
      const a = A.altOf(A.planet(name, x.t), x.t, site.lat, site.lon);
      if (a > p.max) { p.max = a; p.tMax = x.t; }
      if (a > 5) { if (p.first == null) p.first = x.t; p.last = x.t; }
    }
    return p;
  }).filter(p => p.max > 8);
  const dk = n.sm.filter(x => x.s < (n.astro ? -18 : -12));
  const md = A.moon(((n.dS ?? n.start) + (n.dE ?? n.end)) / 2);
  const list = catalog.concat(extra.filter(e => !catalog.some(d => d.id === e.id)));
  n.allTargets = list.map(o => {
    const e = A.eq(o.raH, o.decD), tg = { id: o.id, dso: o, max: -90, tMax: null, above: 0, clear: 0, moonSep: A.sepEq(e, md) };
    for (const x of dk) {
      const a = A.altOf(e, x.t, site.lat, site.lon);
      if (a > tg.max) { tg.max = a; tg.tMax = x.t; }
      if (a >= 30) { tg.above += 300; tg.clear += 300 * hourAt(f, x.t).score / 100; }
    }
    return tg;
  }).sort((a, b) => a.clear !== b.clear ? b.clear - a.clear : b.above - a.above);
  n.targets = n.allTargets.filter(t => t.above >= 1800).slice(0, 15);
}

export function advice(n, fmt, dewSpread) {
  const adv = [];
  if (n.score >= 35) {
    if (n.moon.fraction > 0.6 && n.moon.upFrac > 0.5) adv.push("Bright moon for most of the dark hours. Narrowband targets will do best.");
    else if (n.moon.fraction < 0.25 || n.moon.upFrac < 0.15) adv.push("Dark moon. Good night for galaxies and faint nebulae.");
    const jet = n.dark.map(h => h.jet).filter(j => j != null);
    if (jet.length) {
      const j = jet.reduce((a, b) => a + b, 0) / jet.length;
      if (j > 80) adv.push(`Jet stream near ${Math.round(j)} mph overhead. Expect soft stars; favor wide fields over planets.`);
      else if (j < 35) adv.push(`Calm air aloft (${Math.round(j)} mph jet). Steady seeing for planets and close doubles.`);
    }
  }
  if (n.dewH) adv.push(`Dew likely from ${fmt.time(n.dewH.t)} (temperature within ${dewSpread}°F of the dew point). Run your dew heater.`);
  if (n.dark.length && Math.max(...n.dark.map(h => h.gust)) > 22) adv.push("Gusty at times. Keep exposures short or shelter the mount.");
  if (!n.astro) adv.push("The sun never gets 18° below the horizon tonight, so this uses nautical darkness.");
  return adv;
}

export function nextPhases() {
  let nw = null, full = null, prev = null;
  const now = Date.now() / 1000;
  for (let k = 0; k < 35 * 8; k++) {
    const t = now + k * 3 * 3600, p = A.moonIllum(t).phase;
    if (prev != null) { if (full == null && prev < 0.5 && p >= 0.5) full = t; if (nw == null && prev > 0.9 && p < 0.1) nw = t; }
    prev = p;
    if (nw && full) break;
  }
  return { new: nw, full };
}

// MARK: Light pollution (NASA VIIRS night lights via GIBS)
export const NATURAL_SQM = 21.8;
const B0 = 251, GAIN = 8, DMIN = 2, RADIUS = 150, ZOOM = 7, HSCALE = 175, FAINT = 0.2;

export class LightPollution {
  constructor(o) { Object.assign(this, o); }
  get sqm() { return NATURAL_SQM - 2.5 * Math.log10(1 + this.zenithRatio); }
  get bortle() {
    const s = this.sqm;
    return s >= 21.75 ? 2 : s >= 21.5 ? 3 : s >= 20.5 ? 4 : s >= 19.5 ? 5 : s >= 18.94 ? 6 : s >= 18.38 ? 7 : s >= 17.8 ? 8 : 9;
  }
  get bortleLabel() {
    return ({ 2: "truly dark", 3: "rural", 4: "rural/suburban", 5: "suburban", 6: "bright suburban", 7: "suburban/urban", 8: "city" })[this.bortle] || "inner city";
  }
  get domes() {
    const h = this.horizon, peaks = [];
    for (let k = 0; k < 36; k++) {
      const v = h[k], l = h[(k + 35) % 36], r = h[(k + 1) % 36];
      if (v >= l && v > r && v >= FAINT) peaks.push({ az: k * 10 + 5, strength: v });
    }
    return peaks.sort((a, b) => b.strength - a.strength).slice(0, 3);
  }
  domeWord(az) { const g = this.horizon[Math.floor((((az % 360) + 360) % 360) / 10) % 36]; return g >= 5 ? "strong" : g >= 1 ? "moderate" : "faint"; }
  domeBrightness(alt, az) {
    const a = (((az % 360) + 360) % 360) / 10 - 0.5, i = Math.floor(a), fr = a - i;
    const h = this.horizon[(i + 36) % 36] * (1 - fr) + this.horizon[(i + 37) % 36] * fr;
    return h * Math.exp(-(alt - 10) / 12);
  }
  brightness(alt, az) {
    const x = Math.min(1 / Math.max(Math.sin(alt * A.rad), 0.08), 6);
    return this.zenithRatio * Math.pow(x, 0.7) + this.domeBrightness(alt, az);
  }
}

export async function loadLightPollution(site) {
  const key = "lp3-" + siteKey(site), c = LS.get(key);
  if (c) return new LightPollution(c);
  const lp = await computeLP(site);
  if (lp) LS.set(key, { zenithRatio: lp.zenithRatio, nearShare: lp.nearShare, horizon: lp.horizon });
  return lp;
}

function tilePixels(x, y) {
  const n = 1 << ZOOM;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const col = ((x % n) + n) % n;
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Night_Lights/default/default/GoogleMapsCompatible_Level8/${ZOOM}/${y}/${col}.png`;
  return new Promise(res => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      try { res(ctx.getImageData(0, 0, 256, 256).data); } catch { res(null); }
    };
    img.onerror = () => res(null);
    img.src = url;
  });
}

async function computeLP(site) {
  const n = 256 * Math.pow(2, ZOOM), phi = site.lat * A.rad;
  const px = (site.lon + 180) / 360 * n, py = (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * n;
  const kmPerPx = 40075 * Math.cos(phi) / n, rp = Math.floor(RADIUS / kmPerPx) + 1;
  const tx0 = Math.floor((px - rp) / 256), tx1 = Math.floor((px + rp) / 256), ty0 = Math.floor((py - rp) / 256), ty1 = Math.floor((py + rp) / 256);
  const tiles = {}, jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) jobs.push(tilePixels(tx, ty).then(d => { if (d) tiles[tx + "," + ty] = d; }));
  await Promise.all(jobs);
  if (!Object.keys(tiles).length) return null;
  let total = 0, near = 0;
  const bins = new Array(36).fill(0);
  for (let yy = Math.floor(py) - rp; yy <= Math.floor(py) + rp; yy++) {
    for (let xx = Math.floor(px) - rp; xx <= Math.floor(px) + rp; xx++) {
      const dx = (xx + 0.5 - px) * kmPerPx, dy = (yy + 0.5 - py) * kmPerPx, d = Math.hypot(dx, dy);
      if (d > RADIUS) continue;
      const tx = Math.floor(xx / 256), ty = Math.floor(yy / 256), t = tiles[tx + "," + ty];
      if (!t) continue;
      const i = ((yy - ty * 256) * 256 + (xx - tx * 256)) * 4;
      const v = t[i] * t[i + 3] / 65025;
      if (v <= 0) continue;
      const e = Math.exp(GAIN * v) - 1, w = e * Math.pow(Math.max(d, DMIN), -2.5);
      total += w;
      if (d < 10) near += w;
      else { let az = Math.atan2(dx, -dy) / A.rad; if (az < 0) az += 360; bins[Math.floor(az / 10) % 36] += e * Math.pow(d, -1.5); }
    }
  }
  const sm = bins.map((_, k) => 0.25 * bins[(k + 35) % 36] + 0.5 * bins[k] + 0.25 * bins[(k + 1) % 36]);
  return new LightPollution({ zenithRatio: total / B0, nearShare: total > 0 ? near / total : 1, horizon: sm.map(v => v / HSCALE) });
}

export const lpDarkFactor = lp => lp ? clamp((lp.sqm - 16.5) / (NATURAL_SQM - 16.5), 0.1, 1) : null;
export function scoreLP(h, lp) { const k = lpDarkFactor(lp); if (k == null) return null; return score({ ...h.f, dark: h.f.dark * k }); }
export function nightScoreLP(n, lp) {
  if (!lp || !n.dark.length) return null;
  return Math.round(n.dark.reduce((a, h) => a + scoreLP(h, lp), 0) / n.dark.length);
}

// MARK: Sky brightness over the dome
export class SkyField {
  constructor(t, site, lp = null) {
    this.sun = A.horizontal(A.sun(t), t, site.lat, site.lon);
    this.moon = A.horizontal(A.moon(t), t, site.lat, site.lon);
    this.illum = A.moonIllum(t).fraction;
    this.lp = lp;
  }
  brightness(p) {
    const x = Math.min(1 / Math.max(Math.sin(p.alt * A.rad), 0.08), 6);
    let b = 0.3 * (x - 1);
    if (this.moon.alt > -4) {
      const rho = A.sepH(p, this.moon), cr = Math.cos(rho * A.rad);
      const m = Math.pow(this.illum, 1.3) * Math.min(1, (this.moon.alt + 4) / 20);
      b += 20 * m * (3 * Math.exp(-rho / 18) + 0.8 * (1.06 + cr * cr) / 2.06) * (0.6 + 0.4 * Math.min(x, 4) / 4);
    }
    if (this.sun.alt > -18) {
      const s = Math.pow((this.sun.alt + 18) / 18, 2.2);
      b += 20 * s * (4 * Math.exp(-A.sepH(p, this.sun) / 40) + 1);
    }
    if (this.lp) b += this.lp.brightness(p.alt, p.az);
    return b;
  }
  darkness(p) { return 1 / (1 + this.brightness(p)); }
  darkest(coarse = false) {
    let best = { pos: { alt: 90, az: 0 }, darkness: this.darkness({ alt: 90, az: 0 }) };
    for (let alt = 30; alt <= 88; alt += coarse ? 4 : 2)
      for (let az = 0; az < 360; az += coarse ? 8 : 4) {
        const p = { alt, az }, d = this.darkness(p);
        if (d > best.darkness + 1e-6) best = { pos: p, darkness: d };
      }
    return best;
  }
}

export const magOf = d => NATURAL_SQM - 2.5 * Math.log10(1 / Math.max(d, 1e-6));

/** Tonight's sky-brightness range over the dome, for the local-contrast colours. */
export function skyContrast(field) {
  const mags = [];
  for (let alt = 3; alt <= 89; alt += 3) for (let az = 0; az < 360; az += 6) mags.push([magOf(field.darkness({ alt, az })), { alt, az }]);
  const sorted = mags.map(m => m[0]).sort((a, b) => a - b);
  const p5 = sorted[Math.floor((sorted.length - 1) * 0.05)], darker = sorted[Math.floor((sorted.length - 1) * 0.95)];
  const minSpan = 1.5 + 1.5 * clamp((darker - 18) / 3.5, 0, 1), polluted = Math.min(p5, darker - minSpan);
  const b = mags.reduce((x, y) => y[0] < x[0] ? y : x);
  return { polluted, darker, brightest: b[1], brightestMag: b[0], t: m => clamp((m - polluted) / (darker - polluted), 0, 1) };
}

/** Average zenith sky brightness over the dark hours. */
export function averageSQM(n, site, lp) {
  if (!lp || !n.dark.length) return null;
  const v = n.dark.map(h => NATURAL_SQM - 2.5 * Math.log10(1 + new SkyField(h.t + 1800, site, lp).brightness({ alt: 90, az: 0 })));
  return v.reduce((a, b) => a + b, 0) / v.length;
}
