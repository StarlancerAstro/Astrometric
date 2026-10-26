// Astrometric for the web: state, rendering and interaction.
import * as A from "./astro.js";
import * as D from "./data.js";
import * as C from "./catalog.js";
import { drawSkyMap } from "./skymap.js";
import { timeline, cloudChart, tempChart, hourGrid } from "./charts.js";
import { loadLoop, drawBorders, geoColorAvailable } from "./satellite.js";
import { THEMES, applyCSS, css, scoreColor, barColor, contrastRGB } from "./theme.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LS = D.LS, clamp = A.clamp;
const SAMPLE_SITE = { name: "Sample sky", lat: 41.67, lon: -88.0 };
const MAX_FAVS = 8;

const S = {
  site: LS.get("site"), mode: "loading", forecast: null, nights: [], sel: 0, selHour: null, selTarget: null,
  lp: null, lpKey: null, kp: null, kpFailed: false, fmt: new D.Fmt(0), banner: null,
  red: !!LS.get("red"), favorites: LS.get("favs", []), favScores: LS.get("favScores", {}),
  pinned: LS.get("pinnedTargets", []), custom: LS.get("customTarget"), lpOn: LS.get("skyLP", true),
  domeStyle: LS.get("domeStyle", "highlighted"), dewSpread: LS.get("dewSpread", 3), scrubbing: false,
  satProduct: LS.get("satProduct", "GeoColor"), satZoom: LS.get("satZoom", "Local"),
};
const site = () => S.mode === "sample" ? SAMPLE_SITE : (S.site || SAMPLE_SITE);
const night = () => S.nights[S.sel] || null;
const hour = () => S.forecast?.hours.find(h => h.t === S.selHour) || null;
const theme = () => S.red ? THEMES.red : THEMES.dark;
const isCustom = id => S.custom && S.custom.id === id;
const isPinned = id => S.pinned.includes(id);

// MARK: Data loading
async function load() {
  loadKp();
  if (!S.site) { use(D.sampleForecast(), SAMPLE_SITE, "sample"); S.banner = "This is example data. Tap the site name to choose where you observe."; render(); return; }
  const cached = LS.get("cache");
  if (cached && D.sameSite(cached.site, S.site)) use(cached.data, S.site, "cached");
  try {
    const f = await D.fetchForecast(S.site);
    LS.set("cache", { site: S.site, data: f });
    S.banner = null;
    use(f, S.site, "live");
  } catch (e) {
    if (cached && D.sameSite(cached.site, S.site)) { S.banner = "Showing the last saved forecast. " + e.message; S.mode = "cached"; render(); }
    else { use(D.sampleForecast(), SAMPLE_SITE, "sample"); S.banner = "Couldn't get a live forecast, so this is example data. " + e.message; render(); }
  }
}

function use(data, st, mode) {
  const f = structuredClone(data);
  D.enrich(f, st);
  S.forecast = f; S.fmt = new D.Fmt(f.off); S.mode = mode;
  rebuildNights();
  if (S.sel >= S.nights.length) S.sel = 0;
  resetHour();
  render();
  scoreFavorites();
  const key = D.siteKey(st);
  if (S.lpKey !== key) {
    S.lpKey = key; S.lp = null;
    D.loadLightPollution(st).then(lp => { if (S.lpKey === key) { S.lp = lp; render(); } }).catch(() => {});
  }
  loadSatellite();
}

function rebuildNights() {
  if (!S.forecast) return;
  const keep = S.sel, h = S.selHour;
  S.nights = D.buildNights(S.forecast, site(), { extra: S.custom ? [S.custom] : [], dewSpread: S.dewSpread, catalog: C.DSOS });
  S.sel = Math.min(keep, Math.max(0, S.nights.length - 1)); S.selHour = h;
}

async function loadKp() { try { S.kp = await D.fetchKp(); } catch { S.kpFailed = true; } renderKp(); }

async function scoreFavorites() {
  for (const fav of S.favorites) {
    if (S.site && D.sameSite(S.site, fav)) continue;
    const c = S.favScores[D.siteKey(fav)];
    if (c && Date.now() - c.t < 45 * 60e3) continue;
    try {
      const f = await D.fetchForecast(fav); D.enrich(f, fav);
      const n = D.buildNights(f, fav, { max: 1 })[0];
      if (n) { S.favScores[D.siteKey(fav)] = { score: n.score, t: Date.now() }; LS.set("favScores", S.favScores); renderFavs(); }
    } catch { }
  }
}
function tonightScore(fav) {
  if (S.mode !== "sample" && S.site && D.sameSite(S.site, fav) && S.nights[0]) return S.nights[0].score;
  const c = S.favScores[D.siteKey(fav)];
  return c && Date.now() - c.t < 12 * 3600e3 ? c.score : null;
}

function setSite(s) {
  S.site = s; LS.set("site", s); S.sel = 0; S.selTarget = null; S.mode = "loading"; S.banner = null;
  render(); load();
}

// MARK: Hours
function resetHour() { const n = night(); S.selHour = n ? (n.best?.s ?? n.dark[0]?.t ?? n.grid[0]?.t ?? null) : null; }
function selectNight(i) { S.sel = i; resetHour(); render(); }
function stepHour(d) {
  const g = night()?.grid || []; if (!g.length) return;
  const k = Math.max(0, g.findIndex(h => h.t === S.selHour));
  S.selHour = g[clamp(k + d, 0, g.length - 1)].t; renderHour();
}
function pickNearestHour(t) {
  const g = night()?.grid || []; if (!g.length) return;
  const h = g.reduce((b, x) => Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b);
  if (h.t !== S.selHour) { S.selHour = h.t; renderHour(); }
}
/** The night and hour that contain now; in the daytime (30 min after sunrise until sunset) the coming night's sunset hour. */
function nowTarget() {
  const now = Date.now() / 1000;
  let k = S.nights.findIndex(n => now >= n.start && now < n.end); if (k < 0) k = S.nights.length ? 0 : -1;
  if (k < 0) return null;
  if (S.nights[k].sunset.up && now >= S.nights[k].sunset.up + 1800 && k + 1 < S.nights.length) k++;
  const n = S.nights[k];
  if (n.sunset.down && now < n.sunset.down) { const st = Math.floor(n.sunset.down / 3600) * 3600; return { k, t: (n.grid.find(h => h.t >= st) || n.grid[0])?.t }; }
  const h = n.grid.reduce((b, x) => Math.abs(x.t + 1800 - now) < Math.abs(b.t + 1800 - now) ? x : b, n.grid[0]);
  return h ? { k, t: h.t } : null;
}
function jumpToNow() { const n = nowTarget(); if (!n) return; if (S.sel !== n.k) { S.sel = n.k; S.selHour = n.t; render(); } else { S.selHour = n.t; renderHour(); } }

// MARK: Targets
function targetList(n) {
  const ids = (S.custom ? [S.custom.id] : []).concat(S.pinned.filter(id => !isCustom(id)));
  const head = ids.map(id => n.allTargets.find(t => t.id === id)).filter(Boolean);
  const rest = n.targets.filter(t => !ids.includes(t.id));
  return head.concat(rest.slice(0, Math.max(0, 15 - head.length)));
}
function togglePin(id) { S.pinned = isPinned(id) ? S.pinned.filter(x => x !== id) : S.pinned.concat(id); LS.set("pinnedTargets", S.pinned); render(); }
function setCustom(d) {
  if (S.custom && S.selTarget === S.custom.id) S.selTarget = null;
  S.custom = d; LS.set("customTarget", d); S.pinned = S.pinned.filter(x => x !== d.id); LS.set("pinnedTargets", S.pinned);
  rebuildNights(); S.selTarget = d.id; render();
}
function removeCustom() { if (S.custom && S.selTarget === S.custom.id) S.selTarget = null; S.custom = null; LS.set("customTarget", null); rebuildNights(); render(); }
function toggleTarget(key) { S.selTarget = S.selTarget === key ? null : key; render(); }

function darkAltitude(d) {
  const n = night(); if (!n) return null;
  const e = A.eq(d.raH, d.decD), st = site();
  let best = { max: -90, tMax: null };
  for (const x of n.sm) if (x.s < (n.astro ? -18 : -12)) { const a = A.altOf(e, x.t, st.lat, st.lon); if (a > best.max) best = { max: a, tMax: x.t }; }
  return best;
}

function targetPath() {
  const n = night(); if (!S.selTarget || !n) return [];
  const key = S.selTarget, st = site();
  const fixed = key.startsWith("P:") ? null : n.allTargets.find(t => t.id === key);
  if (!fixed && !key.startsWith("P:")) return [];
  const e0 = fixed ? A.eq(fixed.dso.raH, fixed.dso.decD) : null, step = 600, out = [];
  const to = n.sunset.up ?? n.end;
  for (let t = Math.ceil((n.sunset.down ?? n.start) / step) * step; t <= to; t += step) {
    const local = Math.round(t + S.fmt.off), isHour = local % 3600 === 0;
    const dark = n.dS != null && n.dE != null && t >= n.dS && t <= n.dE;
    out.push({ t, pos: A.horizontal(e0 || A.planet(key.slice(2), t), t, st.lat, st.lon), dark, hour: isHour ? Math.floor(local / 3600) % 24 : null });
  }
  return out;
}

// MARK: Layout — one column on phones, two panes on wide screens
const ORDER_WIDE = [["hero", "readoutCard", "nightsCard", "targetsCard", "planetsCard", "sunCard", "lpCard", "kpCard", "sources"],
  ["mapCard", "gridCard", "timelineCard", "satCard", "cloudCard", "tempCard"]];
const ORDER_NARROW = ["hero", "mapCard", "gridCard", "readoutCard", "nightsCard", "targetsCard", "timelineCard", "planetsCard", "satCard", "cloudCard", "tempCard", "sunCard", "lpCard", "kpCard", "sources"];
let wideNow = null;
function arrange() {
  const wide = window.innerWidth >= 1000;
  if (wide === wideNow) return;
  wideNow = wide;
  const L = $("layout");
  [...L.querySelectorAll(".pane")].forEach(p => { while (p.firstChild) L.appendChild(p.firstChild); p.remove(); });
  L.classList.toggle("wide", wide);
  if (wide) {
    for (const ids of ORDER_WIDE) { const p = document.createElement("div"); p.className = "pane"; ids.forEach(id => p.appendChild($(id))); L.appendChild(p); }
  } else ORDER_NARROW.forEach(id => L.appendChild($(id)));
}

// MARK: Rendering
function render() {
  applyCSS(theme());
  document.documentElement.classList.toggle("red", S.red);
  renderTop(); renderFavs();
  const n = night();
  $("banner").hidden = !S.banner; $("banner").textContent = S.banner || "";
  if (!n) return;
  renderHero(); renderNights(); renderTiles(); renderPlanets(); renderSunMoon(); renderLP(); renderKp(); renderContrast();
  renderHour();
  drawSat();
}

function renderHour() {
  const n = night(); if (!n) return;
  renderMap(); renderHourBar(); renderReadout();
  hourGrid($("grid"), { night: n, theme: theme(), lp: S.lp, dewSpread: S.dewSpread, selHour: S.selHour, fmt: S.fmt });
  const ctx = { night: n, site: site(), selTarget: S.selTarget, selHour: S.selHour, fmt: S.fmt, dewSpread: S.dewSpread };
  if (n.grid.length) {
    charts.tl = timeline($("plotTL"), $("lgTL"), ctx);
    charts.cl = cloudChart($("plotCL"), $("lgCL"), ctx);
    charts.td = tempChart($("plotTD"), $("lgTD"), ctx);
  }
  $("tlNote").textContent = S.selTarget ? "tap the target again to clear" : "tap a target to plot it";
  const nt = nowTarget();
  $("nowBtn").classList.toggle("now", !!nt && nt.k === S.sel && nt.t === S.selHour);
}
const charts = {};

function renderTop() {
  $("siteName").textContent = S.mode === "sample" ? "Sample sky" : (S.site?.name || "Astrometric");
  const f = S.forecast, ago = f ? Math.round((Date.now() - f.fetched) / 60000) : 0;
  const when = ago < 2 ? "just now" : ago < 90 ? ago + " min ago" : Math.round(ago / 60) + " h ago";
  $("updated").textContent = S.mode === "loading" ? "Loading forecast…" : S.mode === "sample" ? "Example data · tap to choose a site"
    : S.mode === "cached" ? `Saved forecast from ${when} · offline` : `Updated ${when} · tap to change site`;
  const fav = S.mode !== "sample" && S.site && S.favorites.some(x => D.sameSite(x, S.site));
  $("starBtn").hidden = S.mode === "sample" || !S.site;
  $("starBtn").setAttribute("aria-pressed", fav); $("starBtn").setAttribute("aria-label", fav ? "Remove this site from saved sites" : "Save this site");
  $("redBtn").setAttribute("aria-pressed", S.red); $("redBtn").textContent = window.innerWidth < 420 ? "Red" : "Red light";
  document.title = S.mode === "sample" || !S.site ? "Astrometric" : `${D.shortName(S.site.name)} · Astrometric`;
}

function renderFavs() {
  const el = $("favs"); el.hidden = !S.favorites.length;
  el.innerHTML = S.favorites.map((f, i) => {
    const cur = S.mode !== "sample" && D.sameSite(S.site, f), sc = tonightScore(f);
    return `<button class="fav" data-i="${i}" aria-current="${cur}"><span class="nm">${esc(D.shortName(f.name))}</span><b style="color:${sc == null ? "var(--muted)" : scoreColor(theme(), sc)}">${sc ?? "–"}</b></button>`;
  }).join("");
}

const strip = hrs => hrs.map(h => `<i style="background:${barColor(theme(), h.score)}"></i>`).join("");
function renderHero() {
  const n = night(), f = S.fmt, label = n.i === 0 ? "Tonight" : n.i === 1 ? "Tomorrow night" : "Night of";
  const sqm = D.averageSQM(n, site(), S.lp), lpScore = D.nightScoreLP(n, S.lp), adv = D.advice(n, f, S.dewSpread);
  $("hero").innerHTML = `
    <span class="eyebrow">${label} · ${f.day(n.start)}</span>
    <div class="scoreRow"><span class="score" style="color:${scoreColor(theme(), n.score)}">${n.score}<sup>/100</sup></span>
      <div style="flex:1;min-width:0"><div class="verdictRow"><span class="verdict">${D.verdict(n.score)}</span>${sqm != null ? `<span class="sqm">${sqm.toFixed(2)} <small>avg SQM</small></span>` : ""}</div>
      <div class="window">${n.best ? `Best window ${f.time(n.best.s)} – ${f.time(n.best.e)} · ${(n.best.e - n.best.s) / 3600} h clear` : "No clear window of an hour or more"}</div>
      ${lpScore != null ? `<div class="window">With light pollution <b style="color:${scoreColor(theme(), lpScore)}">${lpScore}/100</b></div>` : ""}</div></div>
    <div class="strip" aria-hidden="true">${strip(n.dark)}</div>
    ${adv.length ? `<div class="advice">${adv.map(a => `<div>${esc(a)}</div>`).join("")}</div>` : ""}`;
}

function moonSVG(phase, f, s) {
  const r = s / 2 - 1, c = s / 2, rx = Math.abs(1 - 2 * f) * r, wax = phase < .5, lit = wax ? 1 : 0, term = wax ? (f < .5 ? 0 : 1) : (f < .5 ? 1 : 0);
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="var(--moon-dark)"/>${f > .02 ? `<path d="M${c} ${c - r}A${r} ${r} 0 0 ${lit} ${c} ${c + r}A${rx} ${r} 0 0 ${term} ${c} ${c - r}Z" fill="var(--moon-lit)"/>` : ""}</svg>`;
}
function renderNights() {
  const f = S.fmt;
  $("nights").innerHTML = S.nights.map((n, k) => {
    const win = n.best ? `${f.time(n.best.s)} – ${f.time(n.best.e)}` : (n.score >= 35 ? "Broken cloud" : "Clouded out");
    return `<button class="night" data-k="${k}" aria-current="${k === S.sel}"><span class="d"><b>${k === 0 ? "Tonight" : f.dow(n.start)}</b><small>${f.monthDay(n.start)}</small></span>
      <span class="mid"><span class="strip">${strip(n.dark)}</span><small>${win}</small></span>
      <span class="n" style="color:${scoreColor(theme(), n.score)}">${n.score}</span>${moonSVG(n.moon.phase, n.moon.fraction, 20)}</button>`;
  }).join("");
}

function renderMap() {
  const n = night(), st = site(), t = S.selHour ?? n.dS ?? Date.now() / 1000, lp = S.lpOn ? S.lp : null;
  const field = new D.SkyField(t, st, lp), darkest = field.darkest(S.scrubbing), h = hour();
  const contrast = lp ? D.skyContrast(field) : null;
  const marks = targetList(n).map(tg => ({ key: tg.id, label: tg.id, pos: A.horizontal(A.eq(tg.dso.raH, tg.dso.decD), t, st.lat, st.lon), selected: S.selTarget === tg.id })).filter(m => m.pos.alt > 5);
  const planets = A.PLANETS.map(p => [p, A.horizontal(A.planet(p, t), t, st.lat, st.lon)]).filter(p => p[1].alt > 0);
  const geo = drawSkyMap($("sky"), {
    field, contrast, domeStyle: S.domeStyle, theme: theme(), clouds: h?.cc || 0, marks, planets, figure: A.projectConstellations(t, st),
    path: targetPath(), darkest: darkest.pos, selTarget: S.selTarget, fmt: S.fmt, coarse: S.scrubbing,
  });
  mapHit = { geo, marks, planets };
  // Colour key and caption
  if (contrast) {
    const g = [...Array(21)].map((_, k) => { const c = contrastRGB(k / 20, S.red); return `rgb(${c.map(v => Math.round(v * 255)).join(",")})`; });
    $("lpLegend").className = "lpLegend";
    $("lpLegend").innerHTML = `<span>${contrast.polluted.toFixed(1)} · Polluted</span><i style="background:linear-gradient(90deg,${g.join(",")})"></i><span>${contrast.darker.toFixed(1)} · Darker</span>`;
  } else { $("lpLegend").className = ""; $("lpLegend").innerHTML = ""; }
  const nearest = marks.filter(m => m.pos.alt >= 30).sort((a, b) => A.sepH(a.pos, darkest.pos) - A.sepH(b.pos, darkest.pos))[0];
  const parts = [S.fmt.time(t)];
  if (h) parts.push(`clouds ${Math.round(h.cc)}%`);
  parts.push(field.moon.alt > 0 ? `moon ${Math.round(field.illum * 100)}% lit, ${Math.round(field.moon.alt)}° up` : "moon down");
  if (nearest) parts.push(`${nearest.label} sits closest`);
  if (lp) parts.push(`SQM ${lp.sqm.toFixed(1)} · Bortle ${lp.bortle}`);
  $("mapCaption").innerHTML = `<b>Darkest sky: ${darkest.pos.alt > 80 ? "overhead" : A.compass(darkest.pos.az)} · ${Math.round(darkest.pos.alt)}° up</b>${esc(parts.join(" · "))}`;
  // Readouts under the hour bar
  const ro = $("skyReadouts");
  if (contrast) {
    const dk = D.magOf(darkest.darkness);
    ro.hidden = false;
    ro.innerHTML = `<dt>Darkest sky</dt><dd>${A.compass(darkest.pos.az)} ${Math.round(darkest.pos.az)}° · ${Math.round(darkest.pos.alt)}° · ${dk.toFixed(2)}</dd>
      <dt>Brightest glow</dt><dd>${A.compass(contrast.brightest.az)} ${Math.round(contrast.brightest.az)}° · ${Math.round(contrast.brightest.alt)}° · ${contrast.brightestMag.toFixed(2)}</dd>`;
  } else ro.hidden = true;
}
let mapHit = null;

function renderHourBar() {
  const n = night(), g = n.grid, k = Math.max(0, g.findIndex(x => x.t === S.selHour)), h = hour(), bar = $("hourBar");
  const frac = g.length > 1 ? k / (g.length - 1) : 0;
  $("hourFill").style.width = `calc(22px + (100% - 22px) * ${frac})`;
  const lp = h && D.scoreLP(h, S.lp);
  $("hourText").textContent = h ? `${S.fmt.time(h.t)} · score ${h.score}${lp != null ? ` · ${lp} w/ light pollution` : ""}` : "";
  bar.setAttribute("aria-valuetext", $("hourText").textContent);
}

function renderReadout() {
  const h = hour(), el = $("readoutCard");
  if (!h) { el.innerHTML = ""; return; }
  const f = S.fmt, sunTxt = h.sun < -18 ? "Astronomical Dark" : h.sun < -12 ? "Nautical twilight" : h.sun < -6 ? "Civil twilight" : h.sun < 0 ? "Twilight" : "Daylight";
  const lp = D.scoreLP(h, S.lp), vis = h.vis != null ? `${(h.vis / 1609).toFixed(h.vis < 16090 ? 1 : 0)} mi` : "n/a";
  el.innerHTML = `<h2 class="hd"><span><i class="ic">◷</i>Selected hour</span><span class="badge">${sunTxt}</span></h2>
    <dl class="kv box readout">
      <dt><b>${f.day(h.t)} ${f.time(h.t)}</b></dt><dd>score&nbsp;<b style="color:${scoreColor(theme(), h.score)}">${h.score}</b>${lp != null ? `&nbsp;· ${lp} w/ LP` : ""}</dd><hr>
      <dt>Clouds</dt><dd>${Math.round(h.cc)}% · L ${Math.round(h.ccl)} M ${Math.round(h.ccm)} H ${Math.round(h.cch)}</dd>
      <dt>Rain</dt><dd>${Math.round(h.pp)}%</dd>
      <dt>Humidity</dt><dd>${Math.round(h.rh)}%</dd>
      <dt>Jet stream</dt><dd>${h.jet == null ? "n/a" : Math.round(h.jet) + " mph"}</dd>
      <dt>Wind · gusts</dt><dd>${Math.round(h.wind)} · ${Math.round(h.gust)} mph</dd>
      <dt>Temp</dt><dd>${Math.round(h.temp)}°F · Dew ${Math.round(h.dew)}°F</dd>
      <dt>Visibility</dt><dd>${vis}</dd>
      <dt>Moon</dt><dd>${h.moon > 0 ? "Up " + Math.round(h.moon) + "°" : "Set"} · ${Math.round(h.illum * 100)}% lit</dd>
      ${S.lp ? `<hr><dt>SQM</dt><dd>${S.lp.sqm.toFixed(2)} mag/arcsec²</dd><dt>Bortle</dt><dd>${S.lp.bortle} · ${S.lp.bortleLabel}</dd>` : ""}
    </dl>`;
}

const hrs = D.hrs;
function renderTiles() {
  const n = night(), list = targetList(n);
  $("tiles").innerHTML = list.map(t => {
    const pinned = isPinned(t.id), custom = isCustom(t.id);
    const tag = [custom ? "★" : pinned ? "📌︎" : "", t.dso.nb ? "NB" : ""].filter(Boolean).join(" ");
    const clear = t.above >= 1800 ? hrs(t.clear) : t.max > 0 ? "low" : "not up";
    return `<button class="tile" data-id="${esc(t.id)}" aria-selected="${S.selTarget === t.id}"><span class="ph"><img loading="lazy" alt="" src="${C.previewURL(t.dso, 240)}" onload="this.classList.add('ok')"></span>
      ${tag ? `<span class="tag">${tag}</span>` : ""}<span class="l1"><span>${esc(t.id)}</span><span>${clear}</span></span><span class="l2">${esc(t.dso.name)}</span></button>`;
  }).join("") + `<button class="tile add" id="addTile"><span class="ph">+</span><span class="l1"><span>${S.custom ? "Change target" : "Add target"}</span></span><span class="l2">${S.custom ? "replaces " + esc(S.custom.id) : "M, NGC, IC, Sh2, B"}</span></button>`;
  if (!list.length) $("tiles").insertAdjacentHTML("afterbegin", `<p class="how" style="grid-column:1/-1">No listed targets reach 30° during darkness tonight.</p>`);
}

function renderPlanets() {
  const n = night(), f = S.fmt;
  $("planets").innerHTML = n.planets.length ? n.planets.map(p => `<dt>${p.name}</dt><dd>${f.time(p.tMax)} · ${Math.round(p.max)}° · ${f.time(p.first)}–${f.time(p.last)}</dd>`).join("")
    : `<dt>No bright planets get above 8° tonight.</dt><dd></dd>`;
}

function renderSunMoon() {
  const n = night(), f = S.fmt, np = D.nextPhases();
  const mev = n.moon.ev.map(v => (v.rise ? "Rises " : "Sets ") + f.time(v.t)).join(" · ") || (n.moon.upFrac > 0.5 ? "Up all night" : "Down all night");
  $("sunmoon").innerHTML = `<dt>Sunset</dt><dd>${f.time(n.sunset.down)}</dd>
    <dt>Civil · nautical end</dt><dd>${f.time(n.civ.down)} · ${f.time(n.nau.down)}</dd>
    <dt>${n.astro ? "Astronomical Dark" : "Nautical dark"}</dt><dd>${f.time(n.dS)} – ${f.time(n.dE)}</dd>
    <dt>Dark time</dt><dd>${n.dS && n.dE ? hrs(n.dE - n.dS) : "—"}</dd>
    <dt>Nautical · civil start</dt><dd>${f.time(n.nau.up)} · ${f.time(n.civ.up)}</dd>
    <dt>Sunrise</dt><dd>${f.time(n.sunset.up)}</dd><hr>
    <dt>${A.phaseName(n.moon.phase)}</dt><dd>${moonSVG(n.moon.phase, n.moon.fraction, 16)}${Math.round(n.moon.fraction * 100)}% lit</dd>
    <dt>Moon</dt><dd>${mev}</dd><dt>Moon age</dt><dd>${(n.moon.phase * 29.53).toFixed(1)} days</dd>
    <dt>Up during dark</dt><dd>${Math.round(n.moon.upFrac * 100)}%</dd>
    <dt>Next new · full</dt><dd>${np.new ? f.monthDay(np.new) : "—"} · ${np.full ? f.monthDay(np.full) : "—"}</dd>`;
}

function renderLP() {
  const lp = S.lp;
  $("lpInfo").innerHTML = lp ? `<dt>Sky brightness</dt><dd>SQM ${lp.sqm.toFixed(1)} mag/arcsec²</dd><dt>Bortle class</dt><dd>${lp.bortle} · ${lp.bortleLabel}</dd>
    <dt>Light domes</dt><dd>${lp.domes.length ? lp.domes.map(d => A.compass(d.az) + " " + lp.domeWord(d.az)).join(" · ") : "None to speak of"}</dd><dt>Source</dt><dd>NASA VIIRS night lights</dd>`
    : `<dt>Sky brightness</dt><dd>Working it out…</dd>`;
}

function renderKp() {
  const k = S.kp, el = $("spacewx");
  if (!k) { el.innerHTML = `<dt>Kp forecast</dt><dd>${S.kpFailed ? "Unavailable" : "Loading…"}</dd>`; return; }
  const g = k.max >= 9 ? "G5" : k.max >= 8 ? "G4" : k.max >= 7 ? "G3" : k.max >= 6 ? "G2" : k.max >= 5 ? "G1" : null;
  const lat = Math.abs(site().lat), need = lat >= 60 ? 3 : lat >= 55 ? 4 : lat >= 50 ? 5 : lat >= 45 ? 6 : lat >= 40 ? 7 : 8;
  el.innerHTML = `<dt>Max Kp next 24 h</dt><dd>${k.max.toFixed(1)}${k.at ? " at " + S.fmt.time(k.at) : ""}</dd>
    <dt>Storm level</dt><dd class="${g ? "warnTxt" : ""}">${g ? g + " storm" : "Quiet"}</dd>
    <dt>Aurora here</dt><dd>${k.max >= need ? "Possible, low to the north" : `Unlikely (needs Kp ${need})`}</dd>
    <dt>Kp now</dt><dd>${k.now != null ? k.now.toFixed(1) : "—"}</dd>`;
}

function renderContrast() {
  $("contrast").hidden = !S.lp;
  $("lpToggle").checked = S.lpOn;
  $("domeRow").hidden = !S.lpOn;
  document.querySelectorAll("[data-dome]").forEach(b => b.setAttribute("aria-selected", b.dataset.dome === S.domeStyle));
}

// MARK: Satellite loop
const SAT = { frames: [], i: 0, playing: true, token: 0, info: {}, timer: null };
async function loadSatellite() {
  const st = site(), token = ++SAT.token;
  SAT.frames = []; SAT.i = 0; drawSat();
  const gc = geoColorAvailable(st);
  $("satProduct").hidden = !gc;
  document.querySelectorAll("[data-p]").forEach(b => b.setAttribute("aria-selected", b.dataset.p === S.satProduct));
  document.querySelectorAll("[data-z]").forEach(b => b.setAttribute("aria-selected", b.dataset.z === S.satZoom));
  const setStatus = s => { if (token === SAT.token) { $("satMsg").hidden = !s; $("satMsg").textContent = s || ""; } };
  SAT.info = await loadLoop(st, gc ? S.satProduct : "Infrared", S.satZoom, (fr, newest) => {
    if (token !== SAT.token) return;
    SAT.frames = fr.slice(); if (newest || !SAT.playing) SAT.i = SAT.frames.length - 1; drawSat();
  }, setStatus, () => token !== SAT.token) || {};
  if (token !== SAT.token) return;
  $("satSource").textContent = SAT.info.source || "";
  $("satHow").textContent = SAT.info.note || (SAT.info.infraredOnly
    ? "Outside the Americas only infrared is available. The whiter the cloud, the colder and higher its top; low cloud and fog can look faint."
    : SAT.info.product === "GeoColor" ? "GeoColor is true colour by day; after dark it shows infrared cloud over city lights. Low cloud and fog can be hard to see at night."
      : "Infrared shows cloud day and night: the whiter the cloud, the colder and higher its top. Low cloud is close to ground temperature and can look faint.");
  playSat();
}
function playSat() {
  clearTimeout(SAT.timer);
  if (!SAT.playing || SAT.frames.length < 2) return;
  const newest = SAT.i === SAT.frames.length - 1;
  SAT.timer = setTimeout(() => { SAT.i = (SAT.i + 1) % SAT.frames.length; drawSat(); playSat(); }, newest ? 1500 : 450);
}
function drawSat() {
  const c = $("satCanvas"), ctx = c.getContext("2d"), fr = SAT.frames[SAT.i];
  ctx.clearRect(0, 0, c.width, c.height);
  $("satLoop").hidden = !SAT.frames.length;
  if (!fr) return;
  ctx.drawImage(fr.img, 0, 0, c.width, c.height);
  const st = site();
  drawBorders(ctx, st, SAT.info.zoom || (S.satZoom === "Local" ? 7 : 5), c.width, css(theme().fg)).then(() => {
    const m = c.width / 2;
    ctx.strokeStyle = css(theme().good); ctx.fillStyle = css(theme().good); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(m, m, 16, 0, 2 * Math.PI); ctx.stroke(); ctx.beginPath(); ctx.arc(m, m, 4, 0, 2 * Math.PI); ctx.fill();
    const name = D.shortName(st.name); ctx.font = "600 20px system-ui"; const w = ctx.measureText(name).width + 16;
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.beginPath(); ctx.roundRect(m - w / 2, m + 24, w, 28, 14); ctx.fill();
    ctx.fillStyle = css(theme().fg); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(name, m, m + 39);
  });
  $("satDots").innerHTML = SAT.frames.map((_, k) => `<i data-k="${k}" class="${k === SAT.i ? "on" : ""}"></i>`).join("");
  $("satLbl").textContent = `${S.fmt.time(fr.t)} · ${Math.round((Date.now() / 1000 - fr.t) / 60)}m ago`;
  $("satPlay").textContent = SAT.playing ? "❚❚" : "▶"; $("satPlay").setAttribute("aria-label", SAT.playing ? "Pause loop" : "Play loop");
}

// MARK: Sheets
function openSites() { $("q").value = ""; $("results").innerHTML = ""; $("siteErr").hidden = true; renderSiteLists(""); $("siteDlg").showModal(); }
function renderSiteLists(q) {
  $("favHead").hidden = !S.favorites.length;
  $("favList").innerHTML = S.favorites.map((f, i) => `<div class="item"><input value="${esc(f.name)}" data-rename="${i}" aria-label="Rename ${esc(f.name)}"><button class="act" data-go="${i}">Go</button><button class="act" data-del="${i}">Remove</button></div>`).join("");
  const ql = q.trim().toLowerCase();
  const hits = C.STAR_PARTIES.filter(p => !ql || ql.split(/\s+/).every(w => `${p.name} ${p.place} ${p.month} star party`.toLowerCase().includes(w)));
  $("partyList").innerHTML = hits.map(p => `<button class="item" data-party="${C.STAR_PARTIES.indexOf(p)}"><span class="tx"><b>${esc(p.name)}</b><small>${esc(p.place)}</small></span><small>${p.month}</small></button>`).join("")
    || `<p class="how">No star parties match.</p>`;
}
function parseCoord(s, pos, neg, limit) {
  let t = s.toUpperCase().replace(/°/g, "").trim(), sign = 1;
  if (t.endsWith(pos) || t.endsWith(neg)) { sign = t.endsWith(neg) ? -1 : 1; t = t.slice(0, -1); }
  else if (t.startsWith(pos) || t.startsWith(neg)) { sign = t.startsWith(neg) ? -1 : 1; t = t.slice(1); }
  const v = parseFloat(t.trim());
  return isNaN(v) || Math.abs(v) > limit || !/^[\d.+-]+$/.test(t.trim()) ? null : sign * v;
}
function coordSite() {
  const lat = parseCoord($("cLat").value, "N", "S", 90), lon = parseCoord($("cLon").value, "E", "W", 180);
  if (lat == null) { siteErr("Latitude must be between -90 and 90 (or add N/S)."); return null; }
  if (lon == null) { siteErr("Longitude must be between -180 and 180 (or add E/W)."); return null; }
  const n = $("cName").value.trim();
  return { name: n || `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon };
}
function siteErr(m) { $("siteErr").hidden = !m; $("siteErr").textContent = m || ""; }
function addFav(s) {
  if (S.favorites.some(f => D.sameSite(f, s))) return true;
  if (S.favorites.length >= MAX_FAVS) { siteErr(`You can save up to ${MAX_FAVS} sites. Remove one first.`); S.banner = `You can save up to ${MAX_FAVS} sites. Remove one in the site list to add this one.`; return false; }
  S.favorites.push(s); LS.set("favs", S.favorites); return true;
}

let addSeq = 0;
function openAdd() {
  $("addTitle").textContent = S.custom ? "Change target" : "Add target";
  $("tq").value = ""; renderAdd(); $("addDlg").showModal(); setTimeout(() => $("tq").focus(), 50);
}
function renderAdd(extra = null, msg = "") {
  const q = $("tq").value, res = C.localSearch(q);
  if (extra && !res.some(r => r.dso.id === extra.dso.id)) res.unshift(extra);
  const when = S.sel === 0 ? "tonight" : "that night";
  $("addHow").innerHTML = (msg ? `<span class="warnTxt">${esc(msg)}</span> ` : "") +
    "Messier, NGC, IC, Sharpless (Sh2-155) and Barnard (B 33) work offline. Other names (Caldwell, LDN, Abell…) are looked up online at SIMBAD." +
    (S.custom ? ` You can have one custom target; picking another replaces ${esc(S.custom.id)}.` : "");
  $("addResults").innerHTML = res.map((r, k) => {
    const v = darkAltitude(r.dso), hidden = v && v.max < 10;
    const vis = !v ? "" : v.tMax == null ? `No darkness ${when}` : v.max >= 10 ? `Up to ${Math.round(v.max)}° ${when} · highest at ${S.fmt.time(v.tMax)}`
      : v.max > 0 ? `Only ${Math.round(v.max)}° up in the dark ${when}` : `Never up in the dark ${when}`;
    return `<button class="item${hidden ? " hidden" : ""}" data-r="${k}"><span class="tx"><b>${esc(r.dso.id)}${hidden ? " ⊘" : ""}</b><small>${esc(r.subtitle)}</small><small class="vis">${vis}</small></span><span class="act">${isCustom(r.dso.id) ? "✓" : "+"}</span></button>`;
  }).join("") + (q.trim().length >= 3 ? `<button class="item" id="lookUp"><span class="tx"><b>Look up “${esc(q.trim())}” online</b><small>SIMBAD name resolver</small></span></button>` : "");
  addResultsData = res;
}
let addResultsData = [];
async function lookUp() {
  const q = $("tq").value.trim(); if (q.length < 2) return;
  const local = C.localSearch(q);
  if (local.length && C.designation(q)) { pick(local[0].dso); return; }
  const seq = ++addSeq;
  $("addHow").textContent = "Looking up…";
  let r = null; try { r = await C.resolveName(q); } catch { }
  if (seq !== addSeq) return;
  if (r) pick(r.dso);
  else renderAdd(null, (await C.online()) ? "Couldn't find that name. Check the spelling or try a catalogue number." : "No connection: name lookups need internet.");
}
function pick(d) { $("addDlg").close(); setCustom(d); }

// Long-press menu for target tiles
function showMenu(x, y, items) {
  const m = $("menu");
  m.innerHTML = items.map(([label, , danger], i) => `<button data-m="${i}" class="${danger ? "danger" : ""}">${label}</button>`).join("");
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + "px";
  m.onclick = e => { const b = e.target.closest("[data-m]"); if (b) { m.hidden = true; items[+b.dataset.m][1](); } };
}
function tileMenu(id, x, y) {
  if (isCustom(id)) showMenu(x, y, [["Change target", openAdd], ["Remove target", removeCustom, true]]);
  else showMenu(x, y, [[isPinned(id) ? "Unpin" : "Pin to top", () => togglePin(id)]]);
}

// MARK: Red mode with a circular reveal from the button
function toggleRed(ev) {
  const go = () => { S.red = !S.red; LS.set("red", S.red); render(); };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce) { go(); return; }
  const r = $("redBtn").getBoundingClientRect(), x = ev?.clientX || r.left + r.width / 2, y = ev?.clientY || r.top + r.height / 2;
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(go);
  vt.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
    { duration: 700, easing: "cubic-bezier(.6,0,.2,1)", pseudoElement: "::view-transition-new(root)" }));
}

// MARK: Events
function wire() {
  $("siteBtn").onclick = openSites;
  $("nowBtn").onclick = jumpToNow;
  $("redBtn").onclick = toggleRed;
  $("starBtn").onclick = () => {
    if (!S.site) return;
    const i = S.favorites.findIndex(f => D.sameSite(f, S.site));
    if (i >= 0) S.favorites.splice(i, 1); else addFav({ ...S.site });
    LS.set("favs", S.favorites); render(); scoreFavorites();
  };
  $("favs").onclick = e => { const b = e.target.closest(".fav"); if (b) { const f = S.favorites[+b.dataset.i]; if (!D.sameSite(f, S.site) || S.mode === "sample") setSite({ ...f }); } };
  $("nights").onclick = e => { const b = e.target.closest(".night"); if (b) selectNight(+b.dataset.k); };
  $("grid").onclick = e => { const c = e.target.closest("[data-t]"); if (c) { S.selHour = +c.dataset.t; renderHour(); } };
  $("hourPrev").onclick = e => { e.stopPropagation(); stepHour(-1); };
  $("hourNext").onclick = e => { e.stopPropagation(); stepHour(1); };
  $("hourBar").onkeydown = e => { if (e.key === "ArrowLeft") stepHour(-1); if (e.key === "ArrowRight") stepHour(1); };
  scrubber($("hourBar"), x => { const g = night().grid, r = $("hourBar").getBoundingClientRect(); return g[0].t + clamp((x - r.left) / r.width, 0, 1) * (g[g.length - 1].t - g[0].t); }, true);
  scrubber($("plotTL"), x => charts.tl?.(x - $("plotTL").getBoundingClientRect().left));
  scrubber($("plotCL"), x => charts.cl?.(x - $("plotCL").getBoundingClientRect().left));
  scrubber($("plotTD"), x => charts.td?.(x - $("plotTD").getBoundingClientRect().left));
  $("sky").onclick = e => {
    if (!mapHit?.geo) return;
    const r = $("sky").getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const cands = mapHit.marks.map(m => [m.key, m.pos]).concat(mapHit.planets.map(p => ["P:" + p[0], p[1]]));
    let best = null;
    for (const [k, pos] of cands) { const q = mapHit.geo.point(pos), d = Math.hypot(q.x - x, q.y - y); if (d <= 22 && (!best || d < best[1])) best = [k, d]; }
    if (best) toggleTarget(best[0]);
  };
  $("lpToggle").onchange = e => { S.lpOn = e.target.checked; LS.set("skyLP", S.lpOn); renderContrast(); renderHour(); };
  document.querySelectorAll("[data-dome]").forEach(b => b.onclick = () => { S.domeStyle = b.dataset.dome; LS.set("domeStyle", S.domeStyle); renderContrast(); renderMap(); });

  // Target tiles: tap to plot, hold (or right-click) for pin / change / remove
  let press = null;
  const tiles = $("tiles");
  tiles.addEventListener("pointerdown", e => {
    const t = e.target.closest(".tile[data-id]"); if (!t) return;
    press = { id: t.dataset.id, x: e.clientX, y: e.clientY, fired: false, timer: setTimeout(() => { press.fired = true; navigator.vibrate?.(10); tileMenu(press.id, press.x, press.y); }, 500) };
  });
  tiles.addEventListener("pointermove", e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; } });
  const endPress = () => { if (press) clearTimeout(press.timer); };
  tiles.addEventListener("pointerup", endPress); tiles.addEventListener("pointercancel", () => { endPress(); press = null; });
  tiles.addEventListener("click", e => {
    if (e.target.closest("#addTile")) { openAdd(); return; }
    const t = e.target.closest(".tile[data-id]"); if (!t) return;
    if (press?.fired) { press = null; return; }
    press = null; toggleTarget(t.dataset.id);
  });
  tiles.addEventListener("contextmenu", e => { const t = e.target.closest(".tile[data-id]"); if (t) { e.preventDefault(); if (press) clearTimeout(press.timer); tileMenu(t.dataset.id, e.clientX, e.clientY); } });
  document.addEventListener("pointerdown", e => { if (!e.target.closest("#menu")) $("menu").hidden = true; });

  // Site sheet
  $("searchForm").onsubmit = async e => {
    e.preventDefault(); const q = $("q").value.trim(); if (!q) return;
    renderSiteLists(q); siteErr("");
    try {
      const r = await D.searchPlaces(q);
      $("results").innerHTML = r.map((p, i) => `<button class="item" data-res="${i}"><span class="tx"><b>${esc(p.name)}</b><small>${esc([p.admin1, p.country].filter(Boolean).join(", "))}</small></span></button>`).join("");
      $("results").onclick = ev => { const b = ev.target.closest("[data-res]"); if (!b) return; const p = r[+b.dataset.res]; $("siteDlg").close(); setSite({ name: p.name + (p.admin1 ? ", " + p.admin1 : ""), lat: p.latitude, lon: p.longitude }); };
      if (!r.length) siteErr("No places found. Try a nearby town name.");
    } catch { siteErr("Couldn't reach place search. Try again when you have signal."); }
  };
  $("q").oninput = () => renderSiteLists($("q").value);
  $("geoBtn").onclick = () => {
    if (!navigator.geolocation) { siteErr("Location isn't available in this browser."); return; }
    siteErr("");
    navigator.geolocation.getCurrentPosition(p => { $("siteDlg").close(); setSite({ name: "My location", lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => siteErr("Couldn't get your location. Allow location access for this site, or search for a place."), { timeout: 15000 });
  };
  $("sampleBtn").onclick = () => { $("siteDlg").close(); S.site = null; LS.set("site", null); S.sel = 0; load(); };
  $("favList").onclick = e => {
    const go = e.target.closest("[data-go]"), del = e.target.closest("[data-del]");
    if (go) { $("siteDlg").close(); setSite({ ...S.favorites[+go.dataset.go] }); }
    if (del) { S.favorites.splice(+del.dataset.del, 1); LS.set("favs", S.favorites); renderSiteLists($("q").value); render(); }
  };
  $("favList").onchange = e => {
    const i = e.target.dataset.rename; if (i == null) return;
    const n = e.target.value.trim(); if (!n) return;
    const f = S.favorites[+i]; if (S.site && D.sameSite(S.site, f)) { S.site.name = n; LS.set("site", S.site); }
    f.name = n; LS.set("favs", S.favorites); render();
  };
  $("partyList").onclick = e => { const b = e.target.closest("[data-party]"); if (!b) return; const p = C.STAR_PARTIES[+b.dataset.party]; $("siteDlg").close(); setSite({ name: p.name, lat: p.lat, lon: p.lon }); };
  $("coordForm").onsubmit = e => { e.preventDefault(); const s = coordSite(); if (s) { $("siteDlg").close(); setSite(s); } };
  $("coordSave").onclick = () => { const s = coordSite(); if (s && addFav(s)) { $("siteDlg").close(); setSite(s); } };

  // Add-target sheet
  $("tq").oninput = () => { const t = $("tq"); if (t.value.length === 1) { const c = t.selectionStart; t.value = t.value.toUpperCase(); t.setSelectionRange(c, c); } renderAdd(); };
  $("addForm").onsubmit = e => { e.preventDefault(); lookUp(); };
  $("addResults").onclick = e => { if (e.target.closest("#lookUp")) { lookUp(); return; } const b = e.target.closest("[data-r]"); if (b) pick(addResultsData[+b.dataset.r].dso); };

  // Satellite controls
  $("satProduct").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { S.satProduct = b.dataset.p; LS.set("satProduct", S.satProduct); loadSatellite(); } };
  $("satZoom").onclick = e => { const b = e.target.closest("[data-z]"); if (b) { S.satZoom = b.dataset.z; LS.set("satZoom", S.satZoom); loadSatellite(); } };
  $("satPlay").onclick = () => { SAT.playing = !SAT.playing; drawSat(); playSat(); };
  $("satDots").onclick = e => { const d = e.target.closest("[data-k]"); if (d) { SAT.playing = false; SAT.i = +d.dataset.k; clearTimeout(SAT.timer); drawSat(); } };
  $("satRefresh").onclick = loadSatellite;

  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { arrange(); renderTop(); if (night()) renderHour(); }, 120); });
  setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }, 15000);
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.forecast && Date.now() - S.forecast.fetched > 30 * 60e3 && S.mode !== "sample") load(); });
}

/** Drag sideways across an element to scrub through the night's hours. `toT(clientX)` maps a finger position to a time. */
function scrubber(el, toT, bar = false) {
  let active = false;
  const move = e => { const t = toT(e.clientX); if (t != null) pickNearestHour(t); };
  el.addEventListener("pointerdown", e => {
    if (e.target.closest("button") || !night()) return;
    active = true; el.setPointerCapture(e.pointerId);
    S.scrubbing = true; if (bar) el.classList.add("scrub");
    move(e);
  });
  el.addEventListener("pointermove", e => { if (active) move(e); });
  const end = () => { if (!active) return; active = false; S.scrubbing = false; el.classList.remove("scrub"); renderHour(); };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
}

// MARK: Start
arrange();
applyCSS(theme());
document.documentElement.classList.toggle("red", S.red);
wire();
Promise.all([C.loadCatalogs(), A.loadConstellations()]).catch(() => {}).then(load);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
