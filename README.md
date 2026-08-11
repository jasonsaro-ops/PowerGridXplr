# PowerGridXplr

## Securing your EIA API key on GitHub

**Never commit your real API key.** This repo ships with `.env` in `.gitignore` and only `.env.example`.

### Local development
```bash
cp .env.example .env
# edit .env:
VITE_EIA_API_KEY=your_real_key_here
```

### GitHub Pages / static host
Vite embeds `VITE_*` vars at **build time**. Options:

1. **GitHub Actions** (recommended for public repos)  
   - Repo → Settings → Secrets and variables → Actions  
   - New secret: `VITE_EIA_API_KEY` = your key  
   - In your workflow, before `npm run build`:
   ```yaml
   - name: Build
     env:
       VITE_EIA_API_KEY: ${{ secrets.VITE_EIA_API_KEY }}
     run: npm ci && npm run build
   ```

2. **Private repo** – you may keep a local `.env` (still do not commit it).

3. If a key was ever committed, **rotate it** at https://www.eia.gov/opendata/


**US Power Grid Explorer** — Professional dark dashboard for nationwide power system situational awareness.

## Principles

- **Legal & ethical only**: public documented APIs and open data exclusively.
- **EIA API v2** — hourly demand, generation, fuel mix (US48 / balancing authorities). Free key required.
- **CommonGrid** (ODbL) — utilities registry & search.
- **Nominatim / OpenStreetMap** (ODbL) — ZIP, city, state geocoding (with proper User-Agent).
- **HIFLD-derived open archives** — power plants & transmission lines (add GeoJSON under `public/data/` for full layers).
- No scraping of utility OMS sites. No proprietary outage APIs without license.
- Typical data lag ~1 hour. Auto-refresh every 15 minutes.

## Features

- Dark EOC-style UI with KPIs (US48 demand & generation)
- Live fuel mix bars (Coal, Gas, Nuclear, Wind, Solar, Hydro, Geothermal, Battery, Petroleum, Other)
- Search: ZIP, city, state, or utility name (Nominatim + CommonGrid)
- Layer toggles for demand, plants, transmission, utility territories
- Status indicator + last-updated timestamp
- Ready for GitHub Pages

## Quick Start

1. Copy env file and add your free EIA key (https://www.eia.gov/opendata/):

```bash
cp .env.example .env
# edit .env and set VITE_EIA_API_KEY=...
```

2. Install & run:

```bash
npm install
npm run dev
```

3. Production build:

```bash
npm run build
# output in dist/ — deploy to GitHub Pages, Netlify, Cloudflare Pages, etc.
```

## Adding full plant & transmission layers

Full national HIFLD point/line GeoJSON is large. Recommended approaches:

1. Host simplified/vector-tiled versions and point MapLibre sources at them.
2. Place GeoJSON files in `public/data/plants.geojson` and `public/data/lines.geojson`, then wire `Source`/`Layer` in `App.tsx` when the corresponding layer checkbox is on.
3. Query public ArcGIS FeatureServers with a bounding-box filter when the map is zoomed in.

Public sources to start from:
- Data Rescue Project HIFLD archives
- EIA Energy Atlas / Form EIA-860 plant locations
- OpenStreetMap power=* features (via Overpass, respecting fair use)

## GitHub Pages

After `npm run build`, push the `dist` folder (or use the `gh-pages` branch / GitHub Actions). Remember: never commit `.env` with a real key. Users supply their own EIA key via `.env` or a secrets mechanism.

## Disclaimer

For situational awareness and education. Not an official grid operations tool. Cross-check critical decisions with ISOs, utilities, NERC, and DOE sources.

## License

Dashboard code: MIT (or as you prefer).  
Underlying data retain their original licenses (EIA public domain / terms, CommonGrid ODbL, OSM ODbL, HIFLD terms).
