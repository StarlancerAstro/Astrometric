// Targets: the built-in list, the offline Messier / NGC / IC / Sharpless / Barnard catalogues, SIMBAD lookups and
// survey preview photos (ported from the Astrometric app).

const D = (id, name, type, raH, decD, nb = false) => ({ id, name, type, raH, decD, nb });
export const DSOS = [
  D("M31", "Andromeda Galaxy", "Galaxy", 0.712, 41.27), D("M33", "Triangulum Galaxy", "Galaxy", 1.564, 30.66),
  D("M45", "Pleiades", "Reflection", 3.79, 24.12), D("M42", "Orion Nebula", "Emission", 5.588, -5.39, true),
  D("IC 434", "Horsehead Nebula", "Emission", 5.68, -2.46, true), D("NGC 2237", "Rosette Nebula", "Emission", 6.53, 5.0, true),
  D("M1", "Crab Nebula", "Supernova remnant", 5.575, 22.01, true), D("NGC 1499", "California Nebula", "Emission", 4.05, 36.4, true),
  D("M78", "M78 Reflection Nebula", "Reflection", 5.78, 0.08), D("M81", "Bode's Galaxy & M82", "Galaxy", 9.926, 69.07),
  D("M97", "Owl Nebula", "Planetary", 11.2467, 55.019, true), D("M104", "Sombrero Galaxy", "Galaxy", 12.666, -11.62),
  D("M51", "Whirlpool Galaxy", "Galaxy", 13.498, 47.20), D("M101", "Pinwheel Galaxy", "Galaxy", 14.053, 54.35),
  D("M13", "Hercules Cluster", "Globular", 16.695, 36.46), D("M8", "Lagoon Nebula", "Emission", 18.06, -24.38, true),
  D("M20", "Trifid Nebula", "Emission", 18.04, -23.03, true), D("M16", "Eagle Nebula", "Emission", 18.31, -13.78, true),
  D("M17", "Omega Nebula", "Emission", 18.35, -16.18, true), D("M57", "Ring Nebula", "Planetary", 18.893, 33.03, true),
  D("M27", "Dumbbell Nebula", "Planetary", 19.993, 22.72, true), D("NGC 6960", "Veil Nebula", "Supernova remnant", 20.76, 30.7, true),
  D("NGC 7000", "North America Nebula", "Emission", 20.98, 44.33, true), D("IC 1396", "Elephant's Trunk", "Emission", 21.65, 57.5, true),
  D("NGC 7635", "Bubble Nebula", "Emission", 23.34, 61.2, true), D("NGC 281", "Pacman Nebula", "Emission", 0.88, 56.6, true),
  D("IC 1805", "Heart Nebula", "Emission", 2.55, 61.45, true), D("IC 1848", "Soul Nebula", "Emission", 2.85, 60.43, true),
  D("NGC 869", "Double Cluster", "Open cluster", 2.33, 57.13), D("NGC 7293", "Helix Nebula", "Planetary", 22.49, -20.84, true),
];

const PREVIEW_FOV = {
  M31: 3.5, M33: 1.2, M45: 2.2, M42: 1.2, "IC 434": 1.0, "NGC 2237": 1.8, M1: 0.2, "NGC 1499": 3.0, M78: 0.4, M81: 1.2, M97: 0.12,
  M104: 0.2, M51: 0.35, M101: 0.5, M13: 0.4, M8: 1.2, M20: 0.6, M16: 0.6, M17: 0.6, M57: 0.06, M27: 0.2, "NGC 6960": 3.5,
  "NGC 7000": 3.0, "IC 1396": 3.0, "NGC 7635": 0.4, "NGC 281": 0.6, "IC 1805": 1.5, "IC 1848": 1.5, "NGC 869": 1.2, "NGC 7293": 0.5,
};
function defaultFOV(type) {
  switch (type) {
    case "Galaxy": return 0.3;
    case "Planetary": return 0.12;
    case "Globular": return 0.4;
    case "Open cluster": case "Asterism": return 0.8;
    case "Supernova remnant": case "Emission": case "Nebula": case "Reflection": case "Dark nebula": case "Star cloud": return 1.2;
    default: return 0.6;
  }
}
export function fieldOfView(d) {
  if (PREVIEW_FOV[d.id]) return PREVIEW_FOV[d.id];
  const s = d.size ?? entry(d.id)?.size;
  if (s) return Math.min(Math.max(s / 60 * 1.8, 0.08), 2.5);
  return defaultFOV(d.type);
}
/** Photo sources for a target, best first: the bundled photo (popular targets), CDS hips2fits in colour, then NASA
 *  SkyView's red plate (greyscale, but quick and on a separate service). */
export function previewURLs(d, px) {
  const fov = fieldOfView(d), out = [];
  if (BUNDLED.has(d.id)) out.push("data/previews/" + d.id.replace(/ /g, "_") + ".jpg");
  out.push("https://alasky.cds.unistra.fr/hips-image-services/hips2fits?" + new URLSearchParams({ hips: "CDS/P/DSS2/color", width: px, height: px, fov, projection: "TAN", coordsys: "icrs", ra: d.raH * 15, dec: d.decD, format: "jpg" }));
  out.push("https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?" + new URLSearchParams({ Position: `${d.raH * 15},${d.decD}`, Survey: "DSS2 Red", Pixels: px, Size: fov, Return: "JPEG" }));
  return out;
}
let BUNDLED = new Set();

// MARK: Bundled catalogues
const TYPE_NAMES = {
  G: "Galaxy", GPair: "Galaxy pair", GTrpl: "Galaxy triplet", GGroup: "Galaxy group", OCl: "Open cluster", GCl: "Globular",
  PN: "Planetary", Neb: "Nebula", HII: "Emission", EmN: "Emission", RfN: "Reflection", SNR: "Supernova remnant",
  "Cl+N": "Cluster + nebula", "*Ass": "Star association", "*": "Star", "**": "Double star", Other: "Deep-sky object", DrkN: "Dark nebula",
};
const NB = new Set(["HII", "EmN", "PN", "SNR", "Cl+N"]);
let ALL = [], BY_ID = new Map(), BY_M = new Map(), MESSIER = [];

export async function loadCatalogs() {
  const [ngc, mes, bundled] = await Promise.all([fetch("data/NGCIC.json").then(r => r.json()), fetch("data/Messier.json").then(r => r.json()),
    fetch("data/previews.json").then(r => r.json()).catch(() => [])]);
  BUNDLED = new Set(bundled);
  ALL = ngc.objects.map(r => {
    const id = r[0], parts = id.startsWith("Sh2-") ? ["Sh2", id.slice(4)] : id.split(/ (.*)/s);
    const e = { id, cat: parts[0], number: (parts[1] || "").toUpperCase(), raH: r[1], decD: r[2], code: r[3], size: r[4] || null, mag: r[5], name: r[6] || "", messier: r[7] || "", sameAs: r[8] || "" };
    e.type = TYPE_NAMES[e.code] || "Deep-sky object";
    return e;
  });
  for (const e of ALL) { if (!BY_ID.has(e.id)) BY_ID.set(e.id, e); if (e.messier && !e.sameAs && !BY_M.has(e.messier)) BY_M.set(e.messier, e); }
  MESSIER = mes.map(m => {
    const d = { id: m.id, name: m.name || m.type, type: m.type, raH: m.ra, decD: m.dec, nb: m.nb, alt: m.alt };
    d.size = entry(m.id)?.size ?? m.alt.map(a => entry(a)?.size).find(Boolean) ?? null;
    return d;
  });
}
export const entry = id => BY_ID.get(id) || BY_M.get(id);
const toDSO = e => ({ id: e.id, name: e.name || e.type, type: e.type, raH: e.raH, decD: e.decD, nb: NB.has(e.code), size: e.size });

/** Catalogue prefix and number from what was typed: "m 31", "ngc7000", "Sh2-155", "b 44a". */
export function designation(q) {
  const t = q.toUpperCase().replace(/[\s-]/g, "");
  for (const [prefix, cat] of [["SH2", "Sh2"], ["NGC", "NGC"], ["IC", "IC"], ["M", "M"], ["B", "B"]]) {
    if (!t.startsWith(prefix)) continue;
    const rest = t.slice(prefix.length), digits = rest.match(/^\d*/)[0], tail = rest.slice(digits.length);
    const suffixOK = !tail || (tail.length === 1 && /[A-Z]/.test(tail) && cat !== "M" && cat !== "Sh2");
    if (digits && digits.length <= 4 && suffixOK) return { cat, num: rest };
    if (!rest && cat !== "B" && (cat !== "M" || t === "M")) return { cat, num: "" };
  }
  return null;
}

function fmtSize(s) { return s >= 60 ? (s / 60).toFixed(1) + "°" : Math.max(Math.round(s), 1) + "′"; }

/** Instant suggestions from the bundled catalogues. Works offline. */
export function localSearch(q) {
  const query = q.trim();
  if (!query) return [];
  const lower = query.toLowerCase(), out = [];
  const add = (rank, r) => { if (!out.some(o => o[1].dso.id === r.dso.id)) out.push([rank, r]); };
  const des = designation(query);
  if (des && des.cat !== "M" && des.num) {
    const hits = ALL.filter(e => e.cat === des.cat && e.number.startsWith(des.num));
    const key = e => [e.number === des.num ? 0 : 1, (e.number.match(/^\d*/)[0]).length, e.number];
    hits.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0); });
    hits.slice(0, 20).forEach((e, k) => {
      const real = e.sameAs ? (entry(e.sameAs) || e) : e;
      let dso = toDSO(real);
      const m = MESSIER.find(x => x.id === real.messier); if (m) dso = m;
      const b = DSOS.find(x => x.id === dso.id); if (b) dso = b;
      const bits = [];
      if (dso.id !== e.id) bits.push(e.sameAs ? `${e.id} = ${e.sameAs}` : e.id);
      if (dso.name !== dso.type) bits.push(dso.name);
      bits.push(dso.type);
      if (real.mag != null) bits.push("mag " + real.mag.toFixed(1));
      if (real.size) bits.push(fmtSize(real.size));
      add(e.number === des.num ? 0 : 1 + k, { dso: { ...dso, size: real.size }, subtitle: bits.join(" · ") });
    });
  } else {
    for (const d of MESSIER) {
      let rank = Infinity;
      if (des && des.cat === "M" && des.num) { const n = d.id.slice(1); if (n === des.num) rank = 0; else if (n.startsWith(des.num)) rank = 1 + n.length; }
      else if (!des) { const nm = d.name.toLowerCase(); if (nm.startsWith(lower)) rank = 2; else if (nm.includes(lower)) rank = 4; }
      if (rank < Infinity) add(rank, { dso: d, subtitle: [d.name === d.type ? null : d.name, d.type, d.alt[0]].filter(Boolean).join(" · ") });
    }
    if (!des && lower.length >= 3) {
      for (const e of ALL) {
        if (e.sameAs || !e.name || !e.name.toLowerCase().includes(lower)) continue;
        const m = e.messier && MESSIER.find(x => x.id === e.messier);
        if (m) { add(4, { dso: m, subtitle: `${m.name} · ${m.type} · ${e.id}` }); continue; }
        const dso = DSOS.find(x => x.id === e.id) || toDSO(e);
        add(e.name.toLowerCase().startsWith(lower) ? 2 : 4, { dso, subtitle: `${e.name} · ${dso.type}` });
      }
    }
  }
  for (const d of DSOS) {
    const id = d.id.replace(/ /g, "").toUpperCase(), qq = query.replace(/ /g, "").toUpperCase();
    if ((!des && d.name.toLowerCase().includes(lower)) || (des && des.cat === "M" && id.startsWith(qq))) add(3, { dso: d, subtitle: `${d.name} · ${d.type}` });
  }
  return out.sort((a, b) => a[0] - b[0] || a[1].dso.id.length - b[1].dso.id.length).slice(0, 20).map(o => o[1]);
}

// MARK: Online (SIMBAD / Sesame at CDS) for anything not in the bundled catalogues
const SIMBAD_TYPES = {
  G: "Galaxy", GiG: "Galaxy", SBG: "Galaxy", Sy1: "Galaxy", Sy2: "Galaxy", SyG: "Galaxy", AGN: "Galaxy", LIN: "Galaxy", EmG: "Galaxy",
  GiP: "Galaxy", GiC: "Galaxy", IG: "Galaxy", PaG: "Galaxy", H2G: "Galaxy", LSB: "Galaxy", rG: "Galaxy", BiC: "Galaxy", GlC: "Globular",
  OpC: "Open cluster", "Cl*": "Open cluster", "As*": "Asterism", PN: "Planetary", SNR: "Supernova remnant", HII: "Emission",
  RNe: "Reflection", ISM: "Nebula", GNe: "Nebula", DNe: "Dark nebula", MoC: "Nebula", Cld: "Nebula", "**": "Double star",
};
const SIMBAD_NB = new Set(["HII", "PN", "SNR", "GNe", "ISM"]);

/** Resolve any name SIMBAD knows ("Caldwell 49", "LDN 1235", "Abell 39"). */
export async function resolveName(name) {
  const r = await fetch("https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/S?" + encodeURIComponent(name));
  const text = await r.text(), lines = text.split("\n");
  const j = lines.find(l => l.startsWith("%J "));
  if (!j) return null;
  const p = j.split(/\s+/), ra = parseFloat(p[1]), dec = parseFloat(p[2]);
  if (isNaN(ra) || isNaN(dec)) return null;
  const c = (lines.find(l => l.startsWith("%C.0 ")) || "").slice(5).trim();
  const type = SIMBAD_TYPES[c] || "Deep-sky object", title = name.trim();
  return { dso: { id: title, name: title, type, raH: ra / 15, decD: dec, nb: SIMBAD_NB.has(c) }, subtitle: type + " · SIMBAD" };
}

export async function online() { try { const r = await fetch("https://cds.unistra.fr/", { method: "HEAD", cache: "no-store" }); return r.ok; } catch { return false; } }

// MARK: Star parties (usual month; check each event for this year's dates)
const SP = (name, place, month, lat, lon) => ({ name, place, month, lat, lon });
export const STAR_PARTIES = [
  SP("Winter Star Party", "West Summerland Key, FL", "February", 24.656, -81.285),
  SP("Texas Star Party", "Prude Ranch, Fort Davis, TX", "April–May", 30.620, -103.950),
  SP("Cherry Springs Star Party", "Cherry Springs State Park, PA", "June", 41.663, -77.823),
  SP("Black Forest Star Party", "Cherry Springs State Park, PA", "September", 41.663, -77.823),
  SP("Golden State Star Party", "Frosty Acres Ranch, Adin, CA", "June–July", 41.240, -120.940),
  SP("Nebraska Star Party", "Merritt Reservoir, Valentine, NE", "July–August", 42.630, -100.880),
  SP("Stellafane Convention", "Breezy Hill, Springfield, VT", "July–August", 43.278, -72.519),
  SP("Oregon Star Party", "Indian Trail Spring, Ochoco NF, OR", "August", 44.330, -120.270),
  SP("Table Mountain Star Party", "Oroville, WA", "July–August", 48.880, -119.440),
  SP("Almost Heaven Star Party", "Spruce Knob, WV", "August", 38.700, -79.530),
  SP("Starfest", "River Place Park, Ayton, ON", "August", 44.100, -80.930),
  SP("Saskatchewan Summer Star Party", "Cypress Hills, SK", "August", 49.650, -109.520),
  SP("Great Lakes Star Gaze", "River Valley RV Park, Gladwin, MI", "September", 43.980, -84.490),
  SP("Okie-Tex Star Party", "Camp Billy Joe, Kenton, OK", "September–October", 36.890, -102.950),
  SP("Illinois Dark Skies Star Party", "Jim Edgar Panther Creek SFWA, Chandlerville, IL", "October", 40.050, -90.130),
  SP("Peach State Star Gaze", "Deerlick Astronomy Village, Sharon, GA", "October", 33.560, -82.760),
  SP("Mid-South Star Gaze", "Rainwater Observatory, French Camp, MS", "September–October", 33.290, -89.400),
  SP("Grand Canyon Star Party", "South Rim, Grand Canyon NP, AZ", "June", 36.060, -112.110),
  SP("Bryce Canyon Astronomy Festival", "Bryce Canyon NP, UT", "June", 37.640, -112.170),
  SP("Shenandoah Night Sky Festival", "Big Meadows, Shenandoah NP, VA", "September", 38.520, -78.440),
  SP("Stars Over Katahdin", "Katahdin Woods and Waters, ME", "September", 46.100, -68.610),
  SP("Joshua Tree Night Sky Festival", "Twentynine Palms, CA", "October", 34.130, -116.030),
];
