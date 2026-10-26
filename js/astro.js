// Low-precision sun, moon and planet positions (ported from the Astrometric app).
// Times are Unix seconds; angles out are degrees unless noted.

export const rad = Math.PI / 180;
const { sin, cos, tan, asin, acos, atan2, sqrt, PI } = Math;
const OB = rad * 23.4397;

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const days = t => t / 86400 - 0.5 + 2440588 - 2451545;
const raOf = (l, b) => atan2(sin(l) * cos(OB) - tan(b) * sin(OB), cos(l));
const decOf = (l, b) => asin(sin(b) * cos(OB) + cos(b) * sin(OB) * sin(l));
const sidereal = (d, lon) => rad * (280.16 + 360.9856235 * d) + rad * lon;

/** Equatorial {ra, dec} in radians → horizontal {alt, az} in degrees (az from north, clockwise). */
export function horizontal(e, t, lat, lon) {
  const phi = rad * lat, h = sidereal(days(t), lon) - e.ra;
  const alt = asin(sin(phi) * sin(e.dec) + cos(phi) * cos(e.dec) * cos(h));
  const azSouth = atan2(sin(h), cos(h) * sin(phi) - tan(e.dec) * cos(phi));
  let az = (azSouth / rad + 180) % 360;
  if (az < 0) az += 360;
  return { alt: alt / rad, az };
}

export function altOf(e, t, lat, lon) {
  const phi = rad * lat, h = sidereal(days(t), lon) - e.ra;
  return asin(sin(phi) * sin(e.dec) + cos(phi) * cos(e.dec) * cos(h)) / rad;
}

/** Next time at or after `t` that `e` crosses the local meridian. */
export function nextTransit(e, t, lon) {
  const h = sidereal(days(t), lon) - e.ra;
  let toGo = (-h) % (2 * PI);
  if (toGo < 0) toGo += 2 * PI;
  return t + toGo / (2 * PI) * 86164.0905;
}

export function sun(t) {
  const d = days(t), m = rad * (357.5291 + 0.98560028 * d);
  const c = rad * (1.9148 * sin(m) + 0.02 * sin(2 * m) + 0.0003 * sin(3 * m));
  const l = m + c + rad * 102.9372 + PI;
  return { ra: raOf(l, 0), dec: decOf(l, 0) };
}

export function moon(t) {
  const d = days(t);
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
  const l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F);
  return { ra: raOf(l, b), dec: decOf(l, b), dist: 385001 - 20905 * cos(M) };
}

export const sunAlt = (t, lat, lon) => altOf(sun(t), t, lat, lon);
export const moonAlt = (t, lat, lon) => altOf(moon(t), t, lat, lon);

/** Lit fraction and phase (0 new, 0.5 full). */
export function moonIllum(t) {
  const s = sun(t), m = moon(t), sd = 149598000;
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan2(sd * sin(phi), m.dist - sd * cos(phi));
  const ang = atan2(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
  return { fraction: (1 + cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / PI };
}

export const sepEq = (a, b) => acos(clamp(sin(a.dec) * sin(b.dec) + cos(a.dec) * cos(b.dec) * cos(a.ra - b.ra), -1, 1)) / rad;
export function sepH(a, b) {
  const a1 = a.alt * rad, a2 = b.alt * rad, dz = (a.az - b.az) * rad;
  return acos(clamp(sin(a1) * sin(a2) + cos(a1) * cos(a2) * cos(dz), -1, 1)) / rad;
}

export function phaseName(p) {
  if (p < 0.03 || p > 0.97) return "New moon";
  if (p < 0.22) return "Waxing crescent";
  if (p < 0.28) return "First quarter";
  if (p < 0.47) return "Waxing gibbous";
  if (p < 0.53) return "Full moon";
  if (p < 0.72) return "Waning gibbous";
  if (p < 0.78) return "Last quarter";
  return "Waning crescent";
}

export function compass(az) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.floor(((az + 22.5) % 360) / 45) % 8];
}

// Planets: JPL approximate Keplerian elements (a, e, I, L, long.peri, long.node) + rates per century
const PL = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  Earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  Mars: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
};
export const PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

function helio(name, T) {
  const [b, r] = PL[name];
  const [a, e, I, L, wb, O] = b.map((v, i) => v + r[i] * T);
  const w = (wb - O) * rad, Or = O * rad, Ir = I * rad;
  const M = ((L - wb) % 360) * rad;
  let E = M + e * sin(M);
  for (let k = 0; k < 6; k++) E -= (E - e * sin(E) - M) / (1 - e * cos(E));
  const xp = a * (cos(E) - e), yp = a * sqrt(1 - e * e) * sin(E);
  return [
    (cos(w) * cos(Or) - sin(w) * sin(Or) * cos(Ir)) * xp + (-sin(w) * cos(Or) - cos(w) * sin(Or) * cos(Ir)) * yp,
    (cos(w) * sin(Or) + sin(w) * cos(Or) * cos(Ir)) * xp + (-sin(w) * sin(Or) + cos(w) * cos(Or) * cos(Ir)) * yp,
    (sin(w) * sin(Ir)) * xp + (cos(w) * sin(Ir)) * yp,
  ];
}

export function planet(name, t) {
  const T = days(t) / 36525, p = helio(name, T), e = helio("Earth", T);
  const x = p[0] - e[0], y = p[1] - e[1], z = p[2] - e[2];
  const ye = y * cos(OB) - z * sin(OB), ze = y * sin(OB) + z * cos(OB);
  return { ra: atan2(ye, x), dec: atan2(ze, sqrt(x * x + ye * ye)) };
}

/** RA hours + Dec degrees → radians object. */
export const eq = (raH, decD) => ({ ra: raH * 15 * rad, dec: decD * rad });

// Constellation figures (d3-celestial, BSD-3), projected for a time and place.
let CON = null;
export async function loadConstellations() {
  if (CON) return CON;
  const f = await (await fetch("data/Constellations.json")).json();
  const e = p => ({ ra: p[0] * rad, dec: p[1] * rad });
  const densify = ring => {
    const out = [];
    for (let k = 1; k < ring.length; k++) {
      const a = ring[k - 1], b = ring[k];
      let dra = b[0] - a[0];
      if (dra > 180) dra -= 360; else if (dra < -180) dra += 360;
      const ddec = b[1] - a[1], n = Math.max(1, Math.ceil(Math.max(Math.abs(dra), Math.abs(ddec)) / 2));
      for (let i = 0; i < n; i++) out.push(e([a[0] + dra * i / n, a[1] + ddec * i / n]));
    }
    if (ring.length) out.push(e(ring[ring.length - 1]));
    return out;
  };
  CON = { lines: f.lines.map(l => l.map(e)), bounds: f.bounds.map(densify), labels: f.labels.map(l => [FULL[l.id] || l.id, e([l.ra, l.dec])]) };
  return CON;
}
export function projectConstellations(t, site) {
  if (!CON) return null;
  const h = e => horizontal(e, t, site.lat, site.lon);
  return { lines: CON.lines.map(l => l.map(h)), bounds: CON.bounds.map(l => l.map(h)), labels: CON.labels.map(([n, e]) => [n, h(e)]) };
}

const FULL = {
  And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aqr: "Aquarius", Aql: "Aquila", Ara: "Ara", Ari: "Aries", Aur: "Auriga",
  Boo: "Boötes", Cae: "Caelum", Cam: "Camelopardalis", Cnc: "Cancer", CVn: "Canes Venatici", CMa: "Canis Major",
  CMi: "Canis Minor", Cap: "Capricornus", Car: "Carina", Cas: "Cassiopeia", Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus",
  Cha: "Chamaeleon", Cir: "Circinus", Col: "Columba", Com: "Coma Berenices", CrA: "Corona Australis", CrB: "Corona Borealis",
  Crv: "Corvus", Crt: "Crater", Cru: "Crux", Cyg: "Cygnus", Del: "Delphinus", Dor: "Dorado", Dra: "Draco", Equ: "Equuleus",
  Eri: "Eridanus", For: "Fornax", Gem: "Gemini", Gru: "Grus", Her: "Hercules", Hor: "Horologium", Hya: "Hydra", Hyi: "Hydrus",
  Ind: "Indus", Lac: "Lacerta", Leo: "Leo", LMi: "Leo Minor", Lep: "Lepus", Lib: "Libra", Lup: "Lupus", Lyn: "Lynx", Lyr: "Lyra",
  Men: "Mensa", Mic: "Microscopium", Mon: "Monoceros", Mus: "Musca", Nor: "Norma", Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion",
  Pav: "Pavo", Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", Pic: "Pictor", Psc: "Pisces", PsA: "Piscis Austrinus", Pup: "Puppis",
  Pyx: "Pyxis", Ret: "Reticulum", Sge: "Sagitta", Sgr: "Sagittarius", Sco: "Scorpius", Scl: "Sculptor", Sct: "Scutum", Ser: "Serpens",
  Sex: "Sextans", Tau: "Taurus", Tel: "Telescopium", Tri: "Triangulum", TrA: "Triangulum Australe", Tuc: "Tucana", UMa: "Ursa Major",
  UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo", Vol: "Volans", Vul: "Vulpecula",
};
