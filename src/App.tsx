import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Map, { NavigationControl, Source, Layer, Popup } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';

const EIA_KEY = import.meta.env.VITE_EIA_API_KEY as string;

const FUEL_COLORS: Record<string, string> = {
  COL: '#64748b', NG: '#f97316', NUC: '#a855f7', WND: '#06b6d4',
  SUN: '#eab308', WAT: '#3b82f6', GEO: '#14b8a6', OTH: '#94a3b8',
  PEL: '#78716c', OIL: '#78716c', BAT: '#10b981',
};


const FUEL_LABELS: Record<string, string> = {
  COL: 'Coal', NG: 'Natural Gas', NUC: 'Nuclear', WND: 'Wind',
  SUN: 'Solar', WAT: 'Hydro', GEO: 'Geothermal', OTH: 'Other',
  PEL: 'Petroleum', OIL: 'Oil', BAT: 'Battery',
};

interface FuelPoint { fueltype: string; value: number; period: string; }
interface RegionPoint { respondent: string; type: string; value: number; period: string; }
interface UtilityResult { id: string; name: string; slug: string; segment?: string; state?: string; customerCount?: number; }
interface SearchResult { lat: number; lon: number; display_name: string; type: string; }

async function fetchEiaFuelMix(): Promise<FuelPoint[]> {
  if (!EIA_KEY) throw new Error('Missing VITE_EIA_API_KEY');
  const url = new URL('https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/');
  url.searchParams.set('api_key', EIA_KEY);
  url.searchParams.set('frequency', 'hourly');
  url.searchParams.set('data[0]', 'value');
  url.searchParams.set('facets[respondent][]', 'US48');
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('length', '40');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`EIA fuel-mix ${res.status}`);
  const json = await res.json();
  return (json.response?.data || []) as FuelPoint[];
}

async function fetchEiaDemand(): Promise<RegionPoint[]> {
  if (!EIA_KEY) throw new Error('Missing VITE_EIA_API_KEY');
  const url = new URL('https://api.eia.gov/v2/electricity/rto/region-data/data/');
  url.searchParams.set('api_key', EIA_KEY);
  url.searchParams.set('frequency', 'hourly');
  url.searchParams.set('data[0]', 'value');
  url.searchParams.set('facets[respondent][]', 'US48');
  url.searchParams.set('facets[type][]', 'D');
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('length', '5');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`EIA demand ${res.status}`);
  const json = await res.json();
  return (json.response?.data || []) as RegionPoint[];
}

async function geocode(query: string): Promise<SearchResult | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'PowerGridXplr/1.0 (legal public dashboard)' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.[0]) return null;
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    display_name: data[0].display_name,
    type: data[0].type || 'place',
  };
}

async function searchUtilities(q: string): Promise<UtilityResult[]> {
  if (!q || q.length < 2) return [];
  try {
    const url = new URL('https://commongrid.info/api/v1/utilities');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '8');
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || json || []) as UtilityResult[];
  } catch {
    return [];
  }
}

function formatMWh(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)} GW`;
  return `${Math.round(v).toLocaleString()} MW`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso + (iso.length <= 13 ? ':00Z' : 'Z') : iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  } catch {
    return iso;
  }
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [layers, setLayers] = useState({
    demand: true,
    plants: true,
    lines: false,
    utilities: false,
  });
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UtilityResult[]>([]);
  const [fuelData, setFuelData] = useState<FuelPoint[]>([]);
  const [demandData, setDemandData] = useState<RegionPoint[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState(true);
  const [popupInfo, setPopupInfo] = useState<{ lat: number; lon: number; text: string } | null>(null);
  const [searchMsg, setSearchMsg] = useState('');
  const [plantsGeojson, setPlantsGeojson] = useState<any>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fuel, demand] = await Promise.all([fetchEiaFuelMix(), fetchEiaDemand()]);
      setFuelData(fuel);
      setDemandData(demand);
      setLastUpdated(new Date());
      setStatusOk(true);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch EIA data');
      setStatusOk(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadData]);

  useEffect(() => {
    fetch('/data/plants_northeast.geojson')
      .then((r) => r.json())
      .then((gj) => setPlantsGeojson(gj))
      .catch((e) => console.warn('Plants GeoJSON load failed', e));
  }, []);

  // Debounced utility search
  useEffect(() => {
    const t = setTimeout(async () => {
      if (search.trim().length >= 2) {
        const utils = await searchUtilities(search.trim());
        setSearchResults(utils);
      } else {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fuelMix = useMemo(() => {
    if (!fuelData.length) return [];
    const latestPeriod = fuelData[0]?.period;
    const latest = fuelData.filter((d) => d.period === latestPeriod);
    const totals: Record<string, number> = {};
    let sum = 0;
    for (const row of latest) {
      const ft = row.fueltype || 'OTH';
      const v = Number(row.value) || 0;
      totals[ft] = (totals[ft] || 0) + v;
      sum += v;
    }
    return Object.entries(totals)
      .map(([fueltype, value]) => ({ fueltype, value, pct: sum > 0 ? (value / sum) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [fuelData]);

  const latestDemand = useMemo(() => {
    if (!demandData.length) return null;
    return demandData.find((r) => r.type === 'D') || demandData[0];
  }, [demandData]);

  const totalGen = useMemo(() => fuelMix.reduce((s, f) => s + f.value, 0), [fuelMix]);

  const toggleLayer = (key: keyof typeof layers) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSearch = async () => {
    const q = search.trim();
    if (!q) return;
    setSearchMsg('Searching…');
    setPopupInfo(null);

    // Try geocode first (ZIP, city, state, address)
    const geo = await geocode(q);
    if (geo && mapRef.current) {
      mapRef.current.flyTo({ center: [geo.lon, geo.lat], zoom: q.length <= 5 ? 10 : 8, duration: 1600 });
      setPopupInfo({ lat: geo.lat, lon: geo.lon, text: geo.display_name });
      setSearchMsg(geo.display_name);
      return;
    }

    // Fallback: first utility result
    if (searchResults.length > 0) {
      setSearchMsg(`Utility: ${searchResults[0].name}`);
      // No coordinates on utility list; user can refine search
      return;
    }

    setSearchMsg('No results. Try a US ZIP, city, or state name.');
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-icon">⚡</div>
          PowerGridXplr
          <span className="sub">US Power Grid Explorer</span>
        </div>

        <div className="header-center">
          <div className="kpi">
            <span className="kpi-label">US48 Demand</span>
            <span className="kpi-value">{latestDemand ? formatMWh(Number(latestDemand.value)) : '—'}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">US48 Generation</span>
            <span className="kpi-value">{totalGen ? formatMWh(totalGen) : '—'}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Data Period</span>
            <span className="kpi-value" style={{ fontSize: '0.8rem' }}>
              {latestDemand?.period ? formatTime(latestDemand.period) : '—'}
            </span>
          </div>
        </div>

        <div className="header-right">
          <div className={`status-dot ${statusOk ? '' : 'error'}`} title={statusOk ? 'Live' : 'Error'} />
          <span className="last-updated">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Waiting…'}
          </span>
          <button className="btn btn-ghost" onClick={loadData} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="main">
        <aside className="sidebar">
          <div className="sidebar-section">
            <h3>Search</h3>
            <input
              className="search-box"
              placeholder="ZIP, city, state, or utility name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="btn btn-primary" style={{ marginTop: 8, width: '100%' }} onClick={handleSearch}>
              Search / Go
            </button>
            {searchMsg && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 8 }}>{searchMsg}</p>
            )}
            {searchResults.length > 0 && (
              <div style={{ marginTop: 10, maxHeight: 140, overflowY: 'auto' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4 }}>UTILITIES (CommonGrid)</div>
                {searchResults.map((u) => (
                  <div
                    key={u.id}
                    className="layer-item"
                    style={{ cursor: 'pointer', fontSize: '0.8rem' }}
                    onClick={() => {
                      setSearch(u.name);
                      setSearchMsg(`${u.name}${u.customerCount ? ` · ${u.customerCount.toLocaleString()} customers` : ''}`);
                    }}
                  >
                    {u.name}
                    {u.segment && <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: '0.7rem' }}>{u.segment.replace(/_/g, ' ')}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3>Layers</h3>
            <div className="layer-list">
              <label className="layer-item">
                <input type="checkbox" checked={layers.demand} onChange={() => toggleLayer('demand')} />
                <span className="layer-swatch" style={{ background: '#22c55e' }} />
                Demand / Generation (EIA)
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.plants} onChange={() => toggleLayer('plants')} />
                <span className="layer-swatch" style={{ background: '#eab308' }} />
                Power plants — Northeast (PA DE MD NJ NY CT MA RI NH VT)
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.lines} onChange={() => toggleLayer('lines')} />
                <span className="layer-swatch" style={{ background: '#94a3b8' }} />
                Transmission lines (open data)
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.utilities} onChange={() => toggleLayer('utilities')} />
                <span className="layer-swatch" style={{ background: '#3b82f6' }} />
                Utility territories (CommonGrid)
              </label>
            </div>
            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
              Plants & lines use public HIFLD-derived / open sources. Full national vector data is large; enable for denser views or add GeoJSON under <code>public/data/</code>.
            </p>
          </div>

          <div className="sidebar-section">
            <h3>US48 Fuel Mix (latest hour)</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className={`fuel-mix ${loading ? 'loading' : ''}`}>
              {fuelMix.length === 0 && !error && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading fuel mix…</div>
              )}
              {fuelMix.map((f) => (
                <div className="fuel-row" key={f.fueltype}>
                  <span className="layer-swatch" style={{ background: FUEL_COLORS[f.fueltype] || FUEL_COLORS.OTH }} />
                  <span style={{ width: 90 }}>{FUEL_LABELS[f.fueltype] || f.fueltype}</span>
                  <div className="fuel-bar-bg">
                    <div className="fuel-bar" style={{ width: `${Math.min(f.pct, 100)}%`, background: FUEL_COLORS[f.fueltype] || FUEL_COLORS.OTH }} />
                  </div>
                  <span className="fuel-pct">{f.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section" style={{ flex: 1 }}>
            <h3>About</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Legal public data only: EIA hourly RTO, CommonGrid (ODbL), Nominatim (ODbL), HIFLD-derived open archives.
              No utility OMS scraping. Data lag ~1 hour. Auto-refresh 15 min.
            </p>
          </div>
        </aside>

        <div className="map-container">
          <Map
            ref={mapRef}
            initialViewState={{ longitude: -98.5, latitude: 39.8, zoom: 3.6 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          >
            <NavigationControl position="top-right" />
            {layers.plants && plantsGeojson && (
              <Source id="plants-ne" type="geojson" data={plantsGeojson}>
                <Layer
                  id="plants-circle"
                  type="circle"
                  paint={{
                    'circle-radius': [
                      'interpolate', ['linear'], ['coalesce', ['get', 'Total_MW'], 1],
                      1, 3,
                      50, 5,
                      200, 8,
                      1000, 12
                    ],
                    'circle-color': [
                      'match', ['downcase', ['coalesce', ['get', 'PrimSource'], 'other']],
                      'natural gas', '#f97316',
                      'coal', '#64748b',
                      'nuclear', '#a855f7',
                      'wind', '#06b6d4',
                      'solar', '#eab308',
                      'hydroelectric', '#3b82f6',
                      'petroleum', '#78716c',
                      'biomass', '#84cc16',
                      'batteries', '#10b981',
                      'geothermal', '#14b8a6',
                      '#94a3b8'
                    ],
                    'circle-opacity': 0.85,
                    'circle-stroke-width': 0.5,
                    'circle-stroke-color': '#0a0e14'
                  }}
                />
              </Source>
            )}
            {popupInfo && (
              <Popup
                longitude={popupInfo.lon}
                latitude={popupInfo.lat}
                anchor="bottom"
                onClose={() => setPopupInfo(null)}
                closeOnClick={false}
              >
                <div style={{ color: '#111', fontSize: 13, maxWidth: 220 }}>{popupInfo.text}</div>
              </Popup>
            )}
          </Map>

          <div className="map-overlay-info">
            <strong>Legal public data only</strong>
            <br />
            Demand & fuel mix: U.S. EIA API · Search: Nominatim + CommonGrid · Infrastructure: open HIFLD-derived sources
          </div>

          <div className="legend">
            <h4>Fuel Mix</h4>
            {Object.entries(FUEL_LABELS).slice(0, 8).map(([k, label]) => (
              <div className="legend-item" key={k}>
                <span className="legend-swatch" style={{ background: FUEL_COLORS[k] }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
