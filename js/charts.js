// Line charts (SVG) and the hour-by-hour grid.
import * as A from "./astro.js";
import { scoreLP } from "./data.js";
import { cellColor } from "./theme.js";

const clamp = A.clamp;

/** One SVG line chart. o: {t0,t1,ymin,ymax,ticks,unit,horizon,bands,areas,series,h,sel,fmt}. Returns x→t mapping. */
export function plot(svg, o) {
  const W = Math.max(260, Math.round(svg.parentNode.clientWidth - 12)), H = o.h || 190, L = 34, R = 12, T = 10, B = 22;
  const x = t => L + (t - o.t0) / (o.t1 - o.t0) * (W - L - R), y = v => T + (o.ymax - clamp(v, o.ymin, o.ymax)) / (o.ymax - o.ymin) * (H - T - B);
  let s = "";
  for (const b of o.bands || []) s += `<rect x="${x(b.a).toFixed(1)}" y="${T}" width="${Math.max(0, x(b.b) - x(b.a)).toFixed(1)}" height="${H - T - B}" fill="var(--fg)" fill-opacity="${b.op}"/>`;
  for (const v of o.ticks) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="${v === 0 && o.horizon ? 1.5 : 1}"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="var(--f-mono)">${v}${o.unit || ""}</text>`;
  const step = (o.t1 - o.t0) > 14 * 3600 ? 3 : 2;
  for (let t = Math.ceil(o.t0 / 3600) * 3600; t <= o.t1; t += 3600) {
    if (o.fmt.hourOfDay(t) % step) continue;
    s += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="var(--f-mono)">${o.fmt.hour(t)}</text>`;
  }
  for (const a of o.areas || []) {
    if (!a.pts.length) continue;
    let d = ""; a.pts.forEach((p, k) => { d += (k ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1); });
    const l = a.pts[a.pts.length - 1], f = a.pts[0];
    s += `<path d="${d}L${x(l[0]).toFixed(1)} ${y(o.ymin)}L${x(f[0]).toFixed(1)} ${y(o.ymin)}Z" fill="${a.color}" fill-opacity="${a.op || .18}"/>`;
  }
  for (const se of o.series) {
    let d = "", pen = false;
    for (const p of se.pts) {
      if (p[1] == null || (se.clipBelow != null && p[1] < se.clipBelow)) { pen = false; continue; }
      d += (pen ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1); pen = true;
    }
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.w || 2}" stroke-linejoin="round" stroke-linecap="round"${se.dash ? ` stroke-dasharray="${se.dash}"` : ""}/>`;
  }
  if (o.sel != null && o.sel >= o.t0 && o.sel <= o.t1) {
    const sx = x(o.sel + 1800 > o.t1 ? o.sel : o.sel);
    s += `<line x1="${sx}" x2="${sx}" y1="${T}" y2="${H - B}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3"/>`;
    for (const se of o.series) {
      const p = se.pts.reduce((b, q) => Math.abs(q[0] - o.sel) < Math.abs(b[0] - o.sel) ? q : b, se.pts[0]);
      if (p && p[1] != null && (se.clipBelow == null || p[1] >= se.clipBelow)) s += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="4" fill="${se.color}" stroke="var(--surface)" stroke-width="2"/>`;
    }
  }
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H); svg.innerHTML = s;
  return px => o.t0 + clamp((px * W / svg.clientWidth - L) / (W - L - R), 0, 1) * (o.t1 - o.t0);
}

export const swatch = (color, dash, label) =>
  `<span class="sw"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke="${color}" stroke-width="2.5" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/></svg>${label}</span>`;

/** Sun, moon and (if selected) a target's altitude through the night. */
export function timeline(svg, legend, S) {
  const n = S.night, site = S.site;
  const t0 = n.sunset.down != null ? n.sunset.down - 2700 : n.grid[0].t, t1 = n.sunset.up != null ? n.sunset.up + 2700 : n.grid[n.grid.length - 1].t;
  const sm = n.sm.filter(x => x.t >= t0 && x.t <= t1);
  const bands = [];
  for (let k = 1; k < sm.length; k++) { const s = sm[k].s, op = s > -0.8 ? .16 : s > -6 ? .11 : s > -12 ? .07 : s > -18 ? .035 : 0; if (op) bands.push({ a: sm[k - 1].t, b: sm[k].t, op }); }
  const series = [{ pts: sm.map(x => [x.t, x.s]), color: "var(--s2)", dash: "2 4", clipBelow: -20 }, { pts: sm.map(x => [x.t, x.m]), color: "var(--s1)", w: 2.5, clipBelow: -20 }];
  const lg = [swatch("var(--s2)", "2 4", "Sun"), swatch("var(--s1)", "", "Moon " + Math.round(n.moon.fraction * 100) + "%")];
  if (S.selTarget) {
    let e = null, label;
    if (S.selTarget.startsWith("P:")) { label = S.selTarget.slice(2); }
    else { const tg = n.allTargets.find(t => t.id === S.selTarget); if (tg) { e = A.eq(tg.dso.raH, tg.dso.decD); label = tg.id + " " + (tg.dso.name !== tg.dso.type ? tg.dso.name : ""); } }
    if (label) {
      const pts = sm.map(x => [x.t, A.altOf(e || A.planet(label, x.t), x.t, site.lat, site.lon)]);
      series.push({ pts, color: "var(--s3)", dash: "7 4", clipBelow: -20, w: 2.5 });
      lg.push(swatch("var(--s3)", "7 4", label.trim()));
    }
  }
  lg.push(`<span class="sw">Shading = twilight</span>`);
  legend.innerHTML = lg.join("");
  return plot(svg, { t0, t1, ymin: -20, ymax: 90, ticks: [-15, 0, 30, 60, 90], unit: "°", horizon: true, bands, series, h: 210, sel: S.selHour, fmt: S.fmt });
}

export function cloudChart(svg, legend, S) {
  const g = S.night.grid;
  legend.innerHTML = [swatch("var(--s1)", "", "Low"), swatch("var(--s2)", "6 4", "Mid"), swatch("var(--s3)", "2 3", "High"),
    `<span class="sw"><svg width="14" height="10" aria-hidden="true"><rect width="14" height="10" rx="2" fill="var(--fg)" fill-opacity=".18"/></svg>Total</span>`].join("");
  return plot(svg, {
    t0: g[0].t, t1: g[g.length - 1].t, ymin: 0, ymax: 100, ticks: [0, 50, 100], unit: "%", sel: S.selHour, fmt: S.fmt,
    areas: [{ pts: g.map(h => [h.t, h.cc]), color: "var(--fg)", op: .12 }],
    series: [{ pts: g.map(h => [h.t, h.ccl]), color: "var(--s1)" }, { pts: g.map(h => [h.t, h.ccm]), color: "var(--s2)", dash: "6 4" }, { pts: g.map(h => [h.t, h.cch]), color: "var(--s3)", dash: "2 3" }],
  });
}

export function tempChart(svg, legend, S) {
  const g = S.night.grid, vals = g.flatMap(h => [h.temp, h.dew]);
  const lo = Math.floor(Math.min(...vals) / 5) * 5 - 5, hi = Math.ceil(Math.max(...vals) / 5) * 5 + 5, st = (hi - lo) > 40 ? 20 : 10, tk = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) tk.push(v);
  legend.innerHTML = [swatch("var(--s2)", "", "Temperature"), swatch("var(--s1)", "6 4", "Dew point"), `<span class="sw">Shading = dew risk</span>`].join("");
  return plot(svg, {
    t0: g[0].t, t1: g[g.length - 1].t, ymin: lo, ymax: hi, ticks: tk, unit: "°", sel: S.selHour, fmt: S.fmt,
    bands: g.filter(h => h.temp - h.dew <= S.dewSpread).map(h => ({ a: h.t - 1800, b: h.t + 1800, op: .08 })),
    series: [{ pts: g.map(h => [h.t, h.temp]), color: "var(--s2)" }, { pts: g.map(h => [h.t, h.dew]), color: "var(--s1)", dash: "6 4" }],
  });
}

/** Hour-by-hour heat map: one row per factor, one column per hour. */
export function hourGrid(table, S) {
  const hs = S.night.grid, th = S.theme;
  const rows = [
    ["Sky score", h => h.score / 100], ["With light poll.", h => { const v = scoreLP(h, S.lp); return v == null ? null : v / 100; }], null,
    ["Cloud cover", h => 1 - h.cc / 100], ["Low", h => 1 - h.ccl / 100], ["Mid", h => 1 - h.ccm / 100], ["High", h => 1 - h.cch / 100], ["Rain chance", h => 1 - h.pp / 100], null,
    ["Transparency", h => h.f.transp], ["Seeing", h => h.jet == null ? null : h.f.seeing], ["Wind", h => h.f.wind], ["Darkness", h => h.f.dark], null,
    ["Temp °F", h => Math.round(h.temp), () => false], ["Dew spread °F", h => Math.round(h.temp - h.dew), v => v <= S.dewSpread],
    ["Humidity %", h => Math.round(h.rh), () => false], ["Gusts mph", h => Math.round(h.gust), v => v >= 22],
  ];
  const sc = h => h.t === S.selHour ? " sel" : "";
  let html = `<thead><tr><th class="lab"></th>${hs.map(h => `<th class="${sc(h)}" data-t="${h.t}">${S.fmt.hour(h.t)}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of rows) {
    if (!r) { html += `<tr><th class="lab gap"></th><td class="gap" colspan="${hs.length}"></td></tr>`; continue; }
    const [name, fn, warn] = r;
    html += `<tr><th class="lab">${name}</th>` + hs.map(h => {
      const v = fn(h);
      if (warn) return `<td class="num${sc(h)}" data-t="${h.t}"${warn(v) ? ' style="color:var(--warn);font-weight:600"' : ""}>${v}</td>`;
      if (v == null) return `<td class="${sc(h)}" data-t="${h.t}" style="background:var(--line)"></td>`;
      return `<td class="${sc(h)}" data-t="${h.t}" style="background:${cellColor(th, v)}"></td>`;
    }).join("") + "</tr>";
  }
  table.innerHTML = html + "</tbody>";
}
