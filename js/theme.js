// The two looks: dark, and red night-vision mode. CSS variables come from the same values.
const hex = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
export const THEMES = {
  dark: {
    red: false, bg: 0x070b16, surface: 0x0e1426, line: 0x1c2541, fg: 0xe2e7f3, muted: 0x8a94ad, accent: 0x9fb6ff,
    good: 0x46d391, ok: 0x9fb6ff, warn: 0xf0b44c, bad: 0xff6f6a, moonLit: 0xe9ecf4, moonDark: 0x232c48,
    s1: 0x3987e5, s2: 0xd95926, s3: 0x2fb98a, skyRamp: [0x03050f, 0x0c1640, 0x24427f, 0x6a83b6, 0xc8d2ea],
    cells: [0x0b2fa8, 0x2a5fcf, 0x5588de, 0x9ab6e6, 0xdde5f2], barLow: 0x1e2a52, barHigh: 0x9cc4f5,
  },
  red: {
    red: true, bg: 0x000000, surface: 0x0b0000, line: 0x2b0805, fg: 0xd23a2a, muted: 0x86231a, accent: 0xdc4230,
    good: 0xdc4230, ok: 0xbd3424, warn: 0x9a2a1b, bad: 0x681a10, moonLit: 0xd23a2a, moonDark: 0x2b0805,
    s1: 0xe8998a, s2: 0xcf3b28, s3: 0x8a1f12, skyRamp: [0x000000, 0x1a0000, 0x4d0b06, 0x8a170e, 0xad2717],
    cells: [0x1a0000, 0x4a0a06, 0x7d150d, 0xb02819, 0xdc5642], barLow: 0x330704, barHigh: 0xdc6250,
  },
};
export const css = (h, a = 1) => { const [r, g, b] = hex(h); return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`; };
export const rgb = hex;
export const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

export function applyCSS(t) {
  const s = document.documentElement.style;
  for (const k of ["bg", "surface", "line", "fg", "muted", "accent", "good", "ok", "warn", "bad", "moonLit", "moonDark", "s1", "s2", "s3"])
    s.setProperty("--" + k.replace(/[A-Z]/g, c => "-" + c.toLowerCase()), css(t[k]));
  t.cells.forEach((c, i) => s.setProperty(`--c${i + 1}`, css(c)));
  s.setProperty("--inset", t.red ? "rgb(23,3,2)" : "rgb(20,27,49)");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", css(t.bg));
}
export const scoreColor = (t, s) => css(s >= 75 ? t.good : s >= 55 ? t.ok : s >= 35 ? t.warn : t.bad);
export const cellColor = (t, g) => { g = Math.min(1, Math.max(0, g)); return css(t.cells[g >= 0.8 ? 0 : g >= 0.6 ? 1 : g >= 0.4 ? 2 : g >= 0.2 ? 3 : 4]); };
export const barColor = (t, s) => { const c = mix(hex(t.barLow), hex(t.barHigh), Math.min(1, Math.max(0, s / 100))); return `rgb(${c.map(v => Math.round(v * 255)).join(",")})`; };

/** Continuous sky colour for darkness 0 (bright) … 1 (darkest). */
export function skyRGB(t, d) {
  const r = t.skyRamp.map(hex), x = (1 - Math.min(1, Math.max(0, d))) * (r.length - 1), i = Math.min(Math.floor(x), r.length - 2);
  return mix(r[i], r[i + 1], x - i);
}

const STOPS = [0x231565, 0x2d2fa6, 0x2f5fd8, 0x2f9be6, 0x34c9c9, 0x52c96a, 0xb6d33c, 0xf0cf3a, 0xf39a2e, 0xe8662a].map(hex);
/** Local-contrast rainbow: 0 = strongest glow … 1 = darkest. */
export function contrastRGB(t, red) {
  if (red) { const l = 0.2 + 0.8 * (1 - t); return [0.6 * l, 0.07 * l, 0.05 * l]; }
  const x = (1 - t) * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2);
  return mix(STOPS[i], STOPS[i + 1], x - i);
}
export function redLike(c) {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], k = Math.min(1, Math.max(0.35, 0.35 + 1.1 * l));
  return [0.82 * k, 0.06 * k, 0.08 * k];
}
