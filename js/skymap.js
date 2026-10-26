// The all-sky map: equidistant projection, zenith at the centre, N up, E left (as seen looking up).
import * as A from "./astro.js";
import { magOf } from "./data.js";
import { css, contrastRGB, redLike, skyRGB, mix } from "./theme.js";

const point = (p, c, R) => { const r = (90 - p.alt) / 90 * R, a = p.az * A.rad; return { x: c.x - r * Math.sin(a), y: c.y - r * Math.cos(a) }; };
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const PLANET_COLOR = { Mercury: "#d9d9d9", Venus: "#fff8d9", Mars: "#ff8c66", Jupiter: "#ffebc7", Saturn: "#f5e09e" };
const PLANET_SIZE = { Venus: 9, Jupiter: 8, Mars: 6.5, Saturn: 6.5, Mercury: 5.5 };

/**
 * o: { field, contrast, domeStyle, theme, clouds, marks:[{label,pos,selected}], planets:[[name,pos]], figure, path:[{t,pos,dark,hour}],
 *      darkest, selTarget, fmt, coarse }
 * Returns the geometry for hit-testing.
 */
export function drawSkyMap(canvas, o) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight || W;
  if (!W) return null;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const th = o.theme, pad = 18, R = Math.min(W, H) / 2 - pad, c = { x: W / 2, y: H / 2 };
  const field = o.field, lp = field.lp;

  // Brightness raster: an N×N bitmap scaled smoothly into the disc.
  const n = o.coarse ? 64 : 150;
  const samples = new Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dx = (i + 0.5) / n * 2 - 1, dy = (j + 0.5) / n * 2 - 1, r = Math.hypot(dx, dy);
    if (r > 1.03) continue;
    let az = Math.atan2(-dx, -dy) / A.rad; if (az < 0) az += 360;
    const p = { alt: Math.max(0.5, 90 * (1 - Math.min(r, 1))), az };
    samples[j * n + i] = [field.darkness(p), p];
  }
  const colors = new Array(n * n);
  if (o.contrast) {
    const range = o.contrast, hl = o.domeStyle === "highlighted";
    const excess = new Float32Array(n * n);
    if (hl && lp) {
      const rings = [...Array(91)].map(() => []);
      for (const s of samples) if (s) rings[Math.min(90, Math.round(s[1].alt))].push(lp.domeBrightness(s[1].alt, s[1].az));
      const typical = rings.map(r => { if (!r.length) return 0; r.sort((a, b) => a - b); return r[Math.floor(r.length / 2)]; });
      let peak = 0;
      samples.forEach((s, k) => {
        if (!s) return;
        const extra = lp.domeBrightness(s[1].alt, s[1].az) - typical[Math.min(90, Math.round(s[1].alt))];
        const total = 1 / Math.max(s[0], 1e-6);
        if (extra > 0) { excess[k] = 2.5 * Math.log10(total / Math.max(total - extra, 1e-6)); peak = Math.max(peak, excess[k]); }
      });
      for (let k = 0; k < excess.length; k++) excess[k] = peak >= 0.02 ? excess[k] / peak : 0;
    }
    const lift = th.red ? [1, 0.32, 0.22] : [1, 0.925, 0.78];
    samples.forEach((s, k) => {
      if (!s) return;
      let col = contrastRGB(range.t(magOf(s[0])), th.red);
      if (!th.red && lp) {
        const dome = lp.domeBrightness(s[1].alt, s[1].az), share = 0.85 * dome / (dome + 3);
        if (share > 0.03) col = mix(col, redLike(col), share);
      }
      if (hl) {
        const t = Math.min(1, Math.max(0, (excess[k] - 0.08) / 0.55));
        if (t > 0) col = mix(col, lift, 0.7 * Math.pow(t, 0.8));
      }
      colors[k] = col;
    });
  } else {
    const mags = samples.map(s => s ? magOf(s[0]) : null), all = mags.filter(m => m != null);
    const darker = Math.max(...all), span = Math.max(darker - Math.min(...all), 3);
    mags.forEach((m, k) => { if (m != null) colors[k] = skyRGB(th, 0.8 * Math.min(1, Math.max(0, (m - (darker - span)) / span))); });
  }
  const off = document.createElement("canvas"); off.width = off.height = n;
  const octx = off.getContext("2d"), img = octx.createImageData(n, n);
  colors.forEach((col, k) => { if (!col) return; img.data[k * 4] = col[0] * 255; img.data[k * 4 + 1] = col[1] * 255; img.data[k * 4 + 2] = col[2] * 255; img.data[k * 4 + 3] = 255; });
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, 2 * Math.PI); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, c.x - R, c.y - R, 2 * R, 2 * R);
  if (o.clouds > 5) { ctx.fillStyle = `rgba(128,128,128,${o.clouds / 100 * 0.55})`; ctx.fillRect(c.x - R, c.y - R, 2 * R, 2 * R); }

  // Constellations
  const fig = o.figure;
  const polyline = pts => {
    ctx.beginPath(); let pen = false;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (a.alt <= -1 && b.alt <= -1) { pen = false; continue; }
      if (!pen) { const q = point(a, c, R); ctx.moveTo(q.x, q.y); pen = true; }
      const q = point(b, c, R); ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  };
  if (fig) {
    ctx.strokeStyle = css(th.accent, 0.16); ctx.lineWidth = 0.7; ctx.setLineDash([2, 3]);
    fig.bounds.forEach(polyline);
    ctx.strokeStyle = css(th.accent, 0.11); ctx.lineWidth = 0.8; ctx.setLineDash([]); ctx.lineCap = "round"; ctx.lineJoin = "round";
    fig.lines.forEach(polyline);
  }
  ctx.restore();

  // Grid
  ctx.strokeStyle = css(th.fg, 0.22); ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]);
  ctx.beginPath();
  for (let az = 0; az < 360; az += 30) { const q = point({ alt: 0, az }, c, R); ctx.moveTo(c.x, c.y); ctx.lineTo(q.x, q.y); }
  ctx.stroke();
  ctx.font = "9px system-ui"; ctx.fillStyle = css(th.fg, 0.5); ctx.textAlign = "left"; ctx.textBaseline = "top";
  for (const a of [30, 60]) {
    const rr = (90 - a) / 90 * R;
    ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillText(a + "°", c.x + rr * 0.72 + 2, c.y + rr * 0.72 + 2);
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = css(th.line); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, 2 * Math.PI); ctx.stroke();
  ctx.font = "bold 12px system-ui"; ctx.fillStyle = css(th.muted); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const [l, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) { const a = az * A.rad, r = R + 10; ctx.fillText(l, c.x - r * Math.sin(a), c.y - r * Math.cos(a)); }

  // Selected target's track
  const dk = point(o.darkest, c, R);
  const placed = [{ x: dk.x - 26, y: dk.y + 18, w: 52, h: 14 }];
  const path = o.path || [];
  if (path.length) {
    ctx.save(); ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, 2 * Math.PI); ctx.clip();
    for (const darkSeg of [false, true]) {
      ctx.beginPath();
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1], b = path[k];
        if (a.pos.alt <= 0 && b.pos.alt <= 0) continue;
        if ((a.dark && b.dark) !== darkSeg) continue;
        const p = point(a.pos, c, R), q = point(b.pos, c, R); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
      }
      ctx.strokeStyle = css(th.accent, darkSeg ? 0.85 : 0.55); ctx.lineWidth = darkSeg ? 1.8 : 1.2; ctx.lineCap = "round";
      ctx.setLineDash(darkSeg ? [] : [3, 3]); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.fillStyle = css(th.accent);
    for (const p of path) if (p.hour != null && p.pos.alt > 0) { const q = point(p.pos, c, R); ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();
  }

  // Targets
  const marks = [...o.marks].sort((a, b) => (b.selected ? 1 : 0) - (a.selected ? 1 : 0));
  for (const m of marks) {
    const p = point(m.pos, c, R), s = m.selected ? 7 : 4.5;
    if (m.selected) {
      ctx.fillStyle = css(th.accent, 0.22); ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = css(th.accent); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI); ctx.stroke();
      ctx.font = "bold 11px system-ui";
      const w = ctx.measureText(m.label).width + 12, pill = { x: p.x + 12, y: p.y - 9, w, h: 18 };
      ctx.fillStyle = css(th.accent); roundRect(ctx, pill.x, pill.y, w, 18, 9); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, s / 2, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = css(th.bg); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(m.label, pill.x + w / 2, pill.y + 9.5);
      placed.push({ x: pill.x - 2, y: pill.y - 2, w: w + 4, h: 22 }, { x: p.x - 13, y: p.y - 13, w: 26, h: 26 });
      continue;
    }
    ctx.fillStyle = css(th.fg, 0.85); ctx.beginPath(); ctx.arc(p.x, p.y, s / 2, 0, 2 * Math.PI); ctx.fill();
    ctx.font = "9px system-ui";
    const box = { x: p.x + 4, y: p.y - 7, w: ctx.measureText(m.label).width + 4, h: 14 };
    if (placed.some(b => hit(b, box))) continue;
    placed.push(box);
    ctx.fillStyle = css(th.fg, 0.75); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(m.label, p.x + 5, p.y);
  }

  // Hour labels on the track
  ctx.font = "500 8px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = css(th.accent, 0.9);
  for (const p of path) {
    if (p.hour == null || p.hour % 2 || p.pos.alt <= 0) continue;
    const q = point(p.pos, c, R);
    const at = [[q.x, q.y + 8.5], [q.x, q.y - 8.5], [q.x + 16, q.y], [q.x - 16, q.y]].find(([x, y]) => !placed.some(b => hit(b, { x: x - 11, y: y - 5.5, w: 22, h: 11 })));
    if (!at) continue;
    placed.push({ x: at[0] - 11, y: at[1] - 5.5, w: 22, h: 11 });
    ctx.fillText(o.fmt.time(p.t), at[0], at[1]);
  }

  // Constellation names, nudged clear of everything else
  if (fig) {
    placed.push({ x: dk.x - 18, y: dk.y - 18, w: 36, h: 36 });
    if (field.moon.alt > 0) { const m = point(field.moon, c, R); placed.push({ x: m.x - 12, y: m.y - 12, w: 24, h: 24 }); }
    ctx.save(); ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, 2 * Math.PI); ctx.clip();
    ctx.font = "500 8px system-ui"; ctx.fillStyle = css(th.accent, 0.24);
    for (const [name, pos] of fig.labels) {
      if (pos.alt <= 12) continue;
      const p0 = point(pos, c, R), w = name.length * 4.6 + 4;
      const offs = [[0, 0], [0, 13], [0, -13], [0, 26], [0, -26], [w * .6, 0], [-w * .6, 0], [w * .6, 13], [-w * .6, 13], [w * .6, -13], [-w * .6, -13], [0, 39], [0, -39]];
      for (const [ox, oy] of offs) {
        const p = { x: p0.x + ox, y: p0.y + oy };
        if (Math.hypot(p.x - c.x, p.y - c.y) + w / 2 >= R) continue;
        const box = { x: p.x - w / 2, y: p.y - 6, w, h: 12 };
        if (placed.some(b => hit(b, box))) continue;
        placed.push(box); ctx.fillText(name, p.x, p.y); break;
      }
    }
    ctx.restore();
  }

  // Planets
  for (const [name, pos] of o.planets) {
    const p = point(pos, c, R), r = (PLANET_SIZE[name] || 6) / 2, col = th.red ? css(th.fg) : PLANET_COLOR[name];
    if (o.selTarget === "P:" + name) { ctx.strokeStyle = css(th.accent); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = 0.55; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1;
    let ly = p.y - r - 9;
    if (placed.some(b => hit(b, { x: p.x - 24, y: ly - 6, w: 48, h: 12 }))) ly = p.y + r + 10;
    placed.push({ x: p.x - 24, y: ly - 6, w: 48, h: 12 });
    ctx.font = "600 10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(name, p.x, ly);
  }

  // Moon
  if (field.moon.alt > 0) {
    const p = point(field.moon, c, R);
    ctx.fillStyle = css(th.moonLit); ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI); ctx.fill();
    const dx = c.x - p.x, dy = c.y - p.y, len = Math.max(1, Math.hypot(dx, dy));
    ctx.font = "600 10px system-ui"; ctx.fillText("Moon", p.x + dx / len * 20, p.y + dy / len * 20);
  }

  // Light domes: red arcs outside the rim (Highlighted) or small pointers (Classic)
  if (lp) {
    for (const d of lp.domes) {
      if (o.contrast && o.domeStyle === "highlighted") {
        const share = d.strength / (d.strength + 3), half = (6 + 10 * share) * A.rad, mid = -Math.PI / 2 - d.az * A.rad;
        ctx.strokeStyle = `rgba(242,51,38,${0.5 + 0.45 * share})`; ctx.lineWidth = 1.5 + 2 * share; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(c.x, c.y, R + 5, mid - half, mid + half); ctx.stroke();
      } else {
        const a = d.az * A.rad, ux = -Math.sin(a), uy = -Math.cos(a);
        const tip = { x: c.x + ux * (R + 2), y: c.y + uy * (R + 2) }, base = { x: c.x + ux * (R + 11), y: c.y + uy * (R + 11) };
        ctx.fillStyle = "rgb(230,38,31)"; ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(base.x - uy * 5, base.y + ux * 5); ctx.lineTo(base.x + uy * 5, base.y - ux * 5); ctx.closePath(); ctx.fill();
      }
    }
  }

  // Darkest region
  ctx.strokeStyle = css(th.good); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(dk.x, dk.y, 16, 0, 2 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(dk.x, dk.y, 3, 0, 2 * Math.PI); ctx.stroke();
  ctx.fillStyle = css(th.good); ctx.font = "bold 10px system-ui"; ctx.textAlign = "center"; ctx.fillText("Darkest", dk.x, dk.y + 25);

  return { c, R, point: p => point(p, c, R) };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
