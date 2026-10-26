# Astrometric for the web

The Astrometric iPhone app as a static website: plain HTML, CSS and JavaScript with no build step, so GitHub Pages can
host it as-is. Everything runs in the browser. Forecasts, light pollution, satellite images and target photos are
fetched straight from their public services, and saved sites and settings stay in the browser's local storage.

## Put it on GitHub Pages

1. On github.com, create a new public repository, for example `astrometric`.
2. In Terminal, from this folder:

   ```bash
   git init -b main
   git add .
   git commit -m "Astrometric website"
   git remote add origin https://github.com/starlancerastro/astrometric.git
   git push -u origin main
   ```

3. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then branch
   **main** and folder **/ (root)**, and save.
4. After a minute or two the site is live at `https://starlancerastro.github.io/astrometric/`.

To update the site later, commit and push again; Pages republishes automatically.

On an iPhone, open the site in Safari and use **Share → Add to Home Screen**. It then opens full screen with the
Astrometric icon, and the catalogues keep working offline.

## Try it locally

Browsers don't load the data files from `file://`, so serve the folder:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## What's here

| Path | What it is |
|---|---|
| `index.html`, `style.css` | The page and its look (dark and red night-vision themes) |
| `js/app.js` | State, layout (two panes on wide screens, one column on phones) and interaction |
| `js/astro.js` | Sun, moon and planet positions, constellations |
| `js/data.js` | Forecast, scoring, nights, light pollution and the sky-brightness model |
| `js/catalog.js` | Built-in targets, offline catalogue search, SIMBAD lookups, star parties |
| `js/skymap.js`, `js/charts.js`, `js/satellite.js` | Sky map, charts and hour grid, satellite loop |
| `data/` | NGC/IC/Sharpless/Barnard and Messier catalogues, constellation lines, map borders |
| `sw.js`, `manifest.webmanifest` | Offline cache and home-screen install |

## Differences from the iPhone app

- **No alerts or app-icon score.** A website can't schedule notifications for when it's closed without a push server.
- **Hinge layouts** (iPhone Duo half-open, cover screen) become a two-pane layout on wide screens and one column on phones.
- **Pinning** is done by pressing and holding a target tile (or right-clicking it), the same as the app's grid.

## Data and licences

Forecast: Open-Meteo (CC BY 4.0; check their terms for commercial use). Kp: NOAA SWPC. Night lights and satellite
imagery: NASA GIBS; Meteosat imagery: EUMETSAT. Target photos: DSS2 via CDS hips2fits; name lookups: SIMBAD/Sesame (CDS).
NGC and IC: OpenNGC by Mattia Verga (CC BY-SA 4.0); Sharpless and Barnard via VizieR (CDS). Constellations: d3-celestial
(BSD-3, see `data/ConstellationData-LICENSE.txt`). Borders: Natural Earth (public domain).
