import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Map, { NavigationControl, Source, Layer, Popup } from 'react-map-gl/maplibre';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';

const EIA_KEY = import.meta.env.VITE_EIA_API_KEY as string;
const BASE = import.meta.env.BASE_URL;

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

const PLANT_REGIONS = [
  { id: 'northeast', label: 'Northeast (ISO-NE / NYISO / PJM East)', file: 'plants_northeast.geojson' },
  { id: 'southeast', label: 'Southeast', file: 'plants_southeast.geojson' },
  { id: 'midwest', label: 'Midwest (MISO / PJM West)', file: 'plants_midwest.geojson' },
  { id: 'southcentral', label: 'South Central / ERCOT area', file: 'plants_southcentral.geojson' },
  { id: 'west', label: 'West (CAISO / WECC)', file: 'plants_west.geojson' },
  { id: 'alaska', label: 'Alaska Interconnection', file: 'plants_alaska.geojson' },
  { id: 'hawaii', label: 'Hawaii', file: 'plants_hawaii.geojson' },
] as const;

const SUB_REGIONS = [
  { id: 'northeast', label: 'NE substations', file: 'substations_northeast.geojson' },
  { id: 'southeast', label: 'SE substations', file: 'substations_southeast.geojson' },
  { id: 'midwest', label: 'Midwest substations', file: 'substations_midwest.geojson' },
  { id: 'southcentral', label: 'South Central substations', file: 'substations_southcentral.geojson' },
  { id: 'west', label: 'West substations', file: 'substations_west.geojson' },
  { id: 'alaska', label: 'Alaska substations', file: 'substations_alaska.geojson' },
  { id: 'hawaii', label: 'Hawaii substations', file: 'substations_hawaii.geojson' },
] as const;

const VOLT_FILTER_OPTIONS = [
  { id: '220-287', label: '220–287 kV', classes: ['220-287'] },
  { id: '345', label: '345 kV', classes: ['345'] },
  { id: '500', label: '500 kV', classes: ['500'] },
  { id: '735', label: '735+ kV', classes: ['735 AND ABOVE'] },
  { id: 'DC', label: 'DC', classes: ['DC'] },
] as const;

interface FuelPoint { fueltype: string; value: number; period: string; }
interface RegionPoint { respondent: string; type: string; value: number; period: string; }
interface UtilityResult { id: string; name: string; slug: string; segment?: string; customerCount?: number; }
interface PlantProps {
  Plant_Name?: string;
  State?: string;
  PrimSource?: string;
  Total_MW?: number;
  Install_MW?: number;
  City?: string;
  County?: string;
  Utility_Na?: string;
}
interface FeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: string;
    geometry?: { type: string; coordinates: number[] | number[][] | number[][][] };
    properties?: Record<string, unknown> | null;
  }>;
}

interface SubstationProps {
  NAME?: string;
  STATE?: string;
  TYPE?: string;
  STATUS?: string;
  MAX_VOLT?: number | string;
  MIN_VOLT?: number | string;
  CITY?: string;
  COUNTY?: string;
  ZIP?: string;
  LINES?: number | string;
  SOURCE?: string;
  LATITUDE?: number | string;
  LONGITUDE?: number | string;
}

interface PriceRow {
  id: string;
  name: string;
  value: string;
  unit: string;
  period: string;
}

interface LineProps {
  VOLTAGE?: number;
  VOLT_CLASS?: string;
  TYPE?: string;
  STATUS?: string;
  OWNER?: string;
}

interface PopupState {
  lon: number;
  lat: number;
  kind: 'plant' | 'substation' | 'line';
  plant?: PlantProps;
  substation?: SubstationProps;
  line?: LineProps;
}

interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  area: string;
  onset?: string;
  ends?: string;
}

interface BaDemand {
  code: string;
  name: string;
  value: number;
  period: string;
}

interface Quake {
  id: string;
  mag: number;
  place: string;
  time: number;
  lon: number;
  lat: number;
  depth: number;
}

interface OdinUtility {
  name: string;
  totalOutages: number;
  dataResolution?: string;
  receivedDate?: string;
  eiaId?: string;
}


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

async function geocode(query: string) {
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
    display_name: data[0].display_name as string,
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
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}


const GRID_ALERT_EVENTS = new Set([
  'High Wind Warning', 'High Wind Watch', 'Wind Advisory',
  'Tornado Warning', 'Tornado Watch',
  'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch',
  'Hurricane Warning', 'Hurricane Watch', 'Tropical Storm Warning', 'Tropical Storm Watch',
  'Winter Storm Warning', 'Winter Storm Watch', 'Ice Storm Warning', 'Blizzard Warning',
  'Flood Warning', 'Flash Flood Warning',
  'Excessive Heat Warning', 'Heat Advisory',
  'Red Flag Warning', 'Fire Weather Watch', 'Extreme Fire Danger',
  'Storm Surge Warning', 'Storm Surge Watch',
]);

async function fetchNwsAlerts(): Promise<NwsAlert[]> {
  const rank: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
  const sortAlerts = (out: NwsAlert[]) =>
    out.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.event.localeCompare(b.event));

  const fromFeatureProps = (p: Record<string, unknown>, idFallback: string): NwsAlert | null => {
    const event = String(p.event || '');
    if (/^Test Message$/i.test(event)) return null;
    if (!GRID_ALERT_EVENTS.has(event) && !/Wind|Ice|Heat|Fire|Flood|Tornado|Hurricane|Blizzard|Storm/i.test(event)) {
      return null;
    }
    return {
      id: String(p.id || idFallback),
      event,
      severity: String(p.severity || 'Unknown'),
      urgency: String(p.urgency || ''),
      headline: String(p.headline || p.event || ''),
      area: String(p.areaDesc || '').split(';')[0].trim(),
      onset: p.onset ? String(p.onset) : undefined,
      ends: p.ends ? String(p.ends) : p.expires ? String(p.expires) : undefined,
    };
  };

  // Live NWS (CORS allows *)
  try {
    const res = await fetch('https://api.weather.gov/alerts/active?status=actual', {
      headers: { Accept: 'application/geo+json' },
    });
    if (res.ok) {
      const json = await res.json();
      const out: NwsAlert[] = [];
      for (const f of json.features || []) {
        const a = fromFeatureProps(f.properties || {}, String(f.id || Math.random()));
        if (a) out.push(a);
      }
      return sortAlerts(out);
    }
  } catch { /* fall through to snapshot */ }

  // Same-origin snapshot fallback (bundled at build / updated by workflow)
  const snap = await fetch(`${BASE}data/nws_alerts.json`, { cache: 'no-store' });
  if (!snap.ok) throw new Error(`NWS unavailable (live + snapshot failed)`);
  const data = await snap.json();
  if (Array.isArray(data.alerts)) {
    return sortAlerts(data.alerts as NwsAlert[]);
  }
  throw new Error('NWS snapshot empty');
}

function parseOdinList(data: unknown): OdinUtility[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((x: Record<string, unknown>) => ({
      name: String(x.name || 'Unknown'),
      totalOutages: Number(x.totalOutages) || 0,
      dataResolution: x.dataResolution ? String(x.dataResolution) : undefined,
      receivedDate: x.receivedDate ? String(x.receivedDate) : undefined,
      eiaId: x.eiaId != null ? String(x.eiaId) : undefined,
    }))
    .filter((x: OdinUtility) => x.totalOutages > 0)
    .sort((a: OdinUtility, b: OdinUtility) => b.totalOutages - a.totalOutages);
}

/** ODIN does not send Access-Control-Allow-Origin; try direct then same-origin cache. */
async function fetchOdinStatus(): Promise<OdinUtility[]> {
  // 1) Prefer same-origin snapshot (written by optional GH Action or manual refresh)
  try {
    const local = await fetch(`${BASE}data/odin_status.json`, { cache: 'no-store' });
    if (local.ok) {
      const data = await local.json();
      const list = parseOdinList(data.utilities || data);
      if (list.length || data.utilities) return list;
    }
  } catch { /* continue */ }

  // 2) Direct (works in some environments; fails in browser if CORS blocked)
  try {
    const res = await fetch('https://odin.ornl.gov/odi/status');
    if (res.ok) return parseOdinList(await res.json());
  } catch { /* CORS expected on GitHub Pages */ }

  // 3) Public read-only CORS relay (GET only, public government JSON)
  const target = encodeURIComponent('https://odin.ornl.gov/odi/status');
  const proxies = [
    `https://corsproxy.io/?${target}`,
    `https://api.allorigins.win/raw?url=${target}`,
  ];
  for (const url of proxies) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      return parseOdinList(await res.json());
    } catch { /* try next */ }
  }
  throw new Error('ODIN blocked by CORS (no public snapshot)');
}


const MAJOR_BAS = ['PJM', 'MISO', 'ERCO', 'CISO', 'NYIS', 'ISNE', 'SWPP', 'SOCO', 'TVA', 'BPAT'] as const;



async function fetchPetroleumSpot(series: string): Promise<PriceRow | null> {
  if (!EIA_KEY) return null;
  try {
    const url = new URL('https://api.eia.gov/v2/petroleum/pri/spt/data/');
    url.searchParams.set('api_key', EIA_KEY);
    url.searchParams.set('frequency', 'daily');
    url.searchParams.set('data[0]', 'value');
    url.searchParams.append('facets[series][]', series);
    url.searchParams.set('sort[0][column]', 'period');
    url.searchParams.set('sort[0][direction]', 'desc');
    url.searchParams.set('length', '1');
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = await res.json();
    const r = (json.response?.data || [])[0];
    if (!r || r.value == null) return null;
    const desc = String(r['series-description'] || r['product-name'] || series);
    const units = String(r.units || '');
    return {
      id: `pet-${series}`,
      name: desc.replace(' (Dollars per Barrel)', '').replace(' (Dollars per Gallon)', '').replace(' Spot Price FOB', '').replace(' Spot Price', ''),
      value: Number(r.value).toFixed(units.includes('BBL') ? 2 : 3),
      unit: units.includes('BBL') ? '$/bbl' : units.includes('GAL') ? '$/gal' : units || '$',
      period: String(r.period || ''),
    };
  } catch {
    return null;
  }
}

async function fetchEnergyPrices(): Promise<PriceRow[]> {
  if (!EIA_KEY) return [];
  const rows: PriceRow[] = [];

  // Retail electricity by sector (monthly)
  try {
    const url = new URL('https://api.eia.gov/v2/electricity/retail-sales/data/');
    url.searchParams.set('api_key', EIA_KEY);
    url.searchParams.set('frequency', 'monthly');
    url.searchParams.set('data[0]', 'price');
    url.searchParams.append('facets[stateid][]', 'US');
    url.searchParams.set('sort[0][column]', 'period');
    url.searchParams.set('sort[0][direction]', 'desc');
    url.searchParams.set('length', '24');
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json();
      const data = (json.response?.data || []) as Array<Record<string, unknown>>;
      const latest: Record<string, Record<string, unknown>> = {};
      for (const r of data) {
        const id = String(r.sectorid || '');
        if (id && !latest[id] && r.price != null) latest[id] = r;
      }
      const labels: Record<string, string> = {
        RES: 'Electricity retail · Residential',
        COM: 'Electricity retail · Commercial',
        IND: 'Electricity retail · Industrial',
        TRA: 'Electricity retail · Transportation',
        ALL: 'Electricity retail · All sectors',
      };
      for (const [id, r] of Object.entries(latest)) {
        rows.push({
          id: `elec-${id}`,
          name: labels[id] || String(r.sectorName || id),
          value: Number(r.price).toFixed(2),
          unit: '¢/kWh',
          period: String(r.period || ''),
        });
      }
    }
  } catch { /* ignore */ }

  // Henry Hub gas
  try {
    const url = new URL('https://api.eia.gov/v2/natural-gas/pri/fut/data/');
    url.searchParams.set('api_key', EIA_KEY);
    url.searchParams.set('frequency', 'daily');
    url.searchParams.set('data[0]', 'value');
    url.searchParams.append('facets[series][]', 'RNGWHHD');
    url.searchParams.set('sort[0][column]', 'period');
    url.searchParams.set('sort[0][direction]', 'desc');
    url.searchParams.set('length', '1');
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json();
      const r = (json.response?.data || [])[0];
      if (r?.value != null) {
        rows.push({
          id: 'ng-hh',
          name: 'Natural gas · Henry Hub spot',
          value: Number(r.value).toFixed(2),
          unit: '$/MMBtu',
          period: String(r.period || ''),
        });
      }
    }
  } catch { /* ignore */ }

  // Crude + products (daily spots)
  const petSeries = [
    'RWTC', // WTI
    'RBRTE', // Brent
    'EER_EPMRU_PF4_RGC_DPG', // GC conventional gasoline
    'EER_EPD2DXL0_PF4_RGC_DPG', // ULSD diesel
    'EER_EPD2F_PF4_Y35NY_DPG', // NY heating oil
    'EER_EPJK_PF4_RGC_DPG', // jet fuel
  ];
  const pet = await Promise.all(petSeries.map((s) => fetchPetroleumSpot(s)));
  for (const row of pet) {
    if (row) rows.push(row);
  }

  // Imported crude FOB costs (monthly) - try WORLD / US
  try {
    const url = new URL('https://api.eia.gov/v2/petroleum/pri/imc1/data/');
    url.searchParams.set('api_key', EIA_KEY);
    url.searchParams.set('frequency', 'monthly');
    url.searchParams.set('data[0]', 'value');
    url.searchParams.set('sort[0][column]', 'period');
    url.searchParams.set('sort[0][direction]', 'desc');
    url.searchParams.set('length', '30');
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json();
      const data = (json.response?.data || []) as Array<Record<string, unknown>>;
      // pick latest US / World rows with value
      const seen = new Set<string>();
      for (const r of data) {
        if (r.value == null) continue;
        const area = String(r['area-name'] || r.area || r.duoarea || '');
        const key = area || String(r.series || '');
        if (seen.has(key)) continue;
        // keep a few important areas
        const interesting = /world|united states|persian|saudi|canada|mexico|nigeria|brazil/i.test(area);
        if (!interesting && seen.size > 0) continue;
        if (!interesting) continue;
        seen.add(key);
        rows.push({
          id: `imp-crude-${key}`.slice(0, 40),
          name: `Imported crude FOB · ${area || 'selected'}`,
          value: Number(r.value).toFixed(2),
          unit: String(r.units || '$/bbl').includes('BBL') ? '$/bbl' : String(r.units || '$/bbl'),
          period: String(r.period || ''),
        });
        if (seen.size >= 6) break;
      }
    }
  } catch { /* ignore */ }

  // LNG / pipeline export-ish gas citygate or export if available via sum
  try {
    const url = new URL('https://api.eia.gov/v2/natural-gas/pri/sum/data/');
    url.searchParams.set('api_key', EIA_KEY);
    url.searchParams.set('frequency', 'monthly');
    url.searchParams.set('data[0]', 'value');
    url.searchParams.append('facets[duoarea][]', 'NUS');
    url.searchParams.set('sort[0][column]', 'period');
    url.searchParams.set('sort[0][direction]', 'desc');
    url.searchParams.set('length', '40');
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json();
      const data = (json.response?.data || []) as Array<Record<string, unknown>>;
      const want = /citygate|electric power price|industrial price|residential/i;
      const skip = /percent|% of|sold to/i;
      const latest: Record<string, Record<string, unknown>> = {};
      for (const r of data) {
        const proc = String(r['process-name'] || r.process || '');
        const units = String(r.units || '');
        if (!want.test(proc) || skip.test(proc) || r.value == null) continue;
        if (units.includes('%')) continue;
        if (!latest[proc]) latest[proc] = r;
      }
      for (const [proc, r] of Object.entries(latest)) {
        rows.push({
          id: `ng-${proc}`.slice(0, 40),
          name: `Natural gas · ${proc.replace(/ Price$/i, '')}`,
          value: Number(r.value).toFixed(2),
          unit: String(r.units || '$/Mcf'),
          period: String(r.period || ''),
        });
      }
    }
  } catch { /* ignore */ }

  return rows;
}

async function fetchBaDemand(): Promise<BaDemand[]> {
  if (!EIA_KEY) return [];
  const url = new URL('https://api.eia.gov/v2/electricity/rto/region-data/data/');
  url.searchParams.set('api_key', EIA_KEY);
  url.searchParams.set('frequency', 'hourly');
  url.searchParams.set('data[0]', 'value');
  url.searchParams.append('facets[type][]', 'D');
  for (const ba of MAJOR_BAS) url.searchParams.append('facets[respondent][]', ba);
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('length', '40');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`EIA BA ${res.status}`);
  const json = await res.json();
  const rows = (json.response?.data || []) as Array<Record<string, unknown>>;
  const latest: Record<string, BaDemand> = {};
  for (const r of rows) {
    const code = String(r.respondent || '');
    if (!code || latest[code]) continue;
    latest[code] = {
      code,
      name: String(r['respondent-name'] || code),
      value: Number(r.value) || 0,
      period: String(r.period || ''),
    };
  }
  return Object.values(latest).sort((a, b) => b.value - a.value);
}

async function fetchUsgsQuakes(): Promise<Quake[]> {
  const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
  if (!res.ok) throw new Error(`USGS ${res.status}`);
  const json = await res.json();
  const out: Quake[] = [];
  for (const f of json.features || []) {
    const coords = f.geometry?.coordinates || [];
    const p = f.properties || {};
    if (coords.length < 2) continue;
    out.push({
      id: String(f.id || p.code || Math.random()),
      mag: Number(p.mag) || 0,
      place: String(p.place || ''),
      time: Number(p.time) || 0,
      lon: Number(coords[0]),
      lat: Number(coords[1]),
      depth: Number(coords[2]) || 0,
    });
  }
  return out.sort((a, b) => b.mag - a.mag);
}

function severityColor(sev: string): string {
  switch (sev) {
    case 'Extreme': return '#ef4444';
    case 'Severe': return '#f97316';
    case 'Moderate': return '#eab308';
    case 'Minor': return '#94a3b8';
    default: return '#64748b';
  }
}

const plantCirclePaint = {
  'circle-radius': [
    'interpolate', ['linear'], ['coalesce', ['get', 'Total_MW'], 1],
    1, 3, 50, 5, 200, 8, 1000, 12, 3000, 16,
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
    '#94a3b8',
  ],
  'circle-opacity': 0.85,
  'circle-stroke-width': 0.6,
  'circle-stroke-color': '#0a0e14',
} as const;

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [regionOn, setRegionOn] = useState<Record<string, boolean>>({
    northeast: true,
    southeast: true,
    midwest: true,
    southcentral: true,
    west: true,
    alaska: true,
    hawaii: true,
  });
  const [layers, setLayers] = useState({ lines: true, interconnects: true, substations: true });
  const [voltFilters, setVoltFilters] = useState<Record<string, boolean>>({
    '220-287': true,
    '345': true,
    '500': true,
    '735': true,
    'DC': true,
  });
  const [minKv, setMinKv] = useState(230);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UtilityResult[]>([]);
  const [fuelData, setFuelData] = useState<FuelPoint[]>([]);
  const [demandData, setDemandData] = useState<RegionPoint[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState(true);
  const [plantData, setPlantData] = useState<Record<string, FeatureCollection | null>>({});
  const [linesGeojson, setLinesGeojson] = useState<FeatureCollection | null>(null);
  const [interconnectGeojson, setInterconnectGeojson] = useState<FeatureCollection | null>(null);
  const [subData, setSubData] = useState<Record<string, FeatureCollection | null>>({});
  const [subRegionOn, setSubRegionOn] = useState<Record<string, boolean>>({ northeast: true, southeast: true, midwest: true, southcentral: true, west: true, alaska: true, hawaii: true });
  const [plantPopup, setPlantPopup] = useState<PopupState | null>(null);
  const [searchMsg, setSearchMsg] = useState('');
  const [cursor, setCursor] = useState<'default' | 'pointer'>('default');
  const [nwsAlerts, setNwsAlerts] = useState<NwsAlert[]>([]);
  const [odinUtils, setOdinUtils] = useState<OdinUtility[]>([]);
  const [hazardError, setHazardError] = useState<string | null>(null);
  const [baDemand, setBaDemand] = useState<BaDemand[]>([]);
  const [quakes, setQuakes] = useState<Quake[]>([]);
  const [showQuakes, setShowQuakes] = useState(true);
  const [energyPrices, setEnergyPrices] = useState<PriceRow[]>([]);
  const [pricesUpdated, setPricesUpdated] = useState<Date | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [pmuStatus] = useState<{ mode: string; detail: string }>({
    mode: 'unavailable',
    detail: import.meta.env.VITE_PMU_ENDPOINT
      ? 'Custom endpoint configured — connect PDC/stream in deployment'
      : 'No public live US PMU stream. Historical research sets (PNNL/GESL) only.',
  });

  const loadLive = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHazardError(null);
    try {
      const [fuel, demand, bas] = await Promise.all([
        fetchEiaFuelMix(),
        fetchEiaDemand(),
        fetchBaDemand().catch(() => [] as BaDemand[]),
      ]);
      setFuelData(fuel);
      setDemandData(demand);
      setBaDemand(bas);
      setStatusOk(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch EIA data');
      setStatusOk(false);
    }

    try {
      setQuakes(await fetchUsgsQuakes());
    } catch {
      /* non-critical */
    }

    const hazardMsgs: string[] = [];
    try {
      setNwsAlerts(await fetchNwsAlerts());
    } catch (e: unknown) {
      hazardMsgs.push(`NWS: ${e instanceof Error ? e.message : 'failed'}`);
    }
    try {
      setOdinUtils(await fetchOdinStatus());
    } catch (e: unknown) {
      hazardMsgs.push(`ODIN: ${e instanceof Error ? e.message : 'failed'}`);
    }
    setHazardError(hazardMsgs.length ? hazardMsgs.join(' · ') : null);

    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLive();
    const id = setInterval(loadLive, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadLive]);

  const loadPrices = useCallback(async () => {
    try {
      const rows = await fetchEnergyPrices();
      setEnergyPrices(rows);
      setPricesUpdated(new Date());
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    loadPrices();
    const id = setInterval(loadPrices, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadPrices]);

  useEffect(() => {
    PLANT_REGIONS.forEach((r) => {
      fetch(`${BASE}data/${r.file}`)
        .then((res) => {
          if (!res.ok) throw new Error(`${r.id} ${res.status}`);
          return res.json();
        })
        .then((gj) => setPlantData((prev) => ({ ...prev, [r.id]: gj })))
        .catch((e) => console.warn('Plant region load failed', r.id, e));
    });
    fetch(`${BASE}data/lines_national_hv.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setLinesGeojson(gj))
      .catch((e) => console.warn('Lines load failed', e));
    fetch(`${BASE}data/interconnections.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setInterconnectGeojson(gj))
      .catch((e) => console.warn('Interconnect load failed', e));
    SUB_REGIONS.forEach((r) => {
      fetch(`${BASE}data/${r.file}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((gj) => gj && setSubData((prev) => ({ ...prev, [r.id]: gj })))
        .catch((e) => console.warn('Substations load failed', r.id, e));
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (search.trim().length >= 2) setSearchResults(await searchUtilities(search.trim()));
      else setSearchResults([]);
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

  const quakesGeo = useMemo((): FeatureCollection => ({
    type: 'FeatureCollection',
    features: quakes.map((q) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [q.lon, q.lat] },
      properties: { mag: q.mag, place: q.place, time: q.time, depth: q.depth, id: q.id },
    })),
  }), [quakes]);

  const gridStress = useMemo(() => {
    // PROXY only — not measured bus voltage or VAR from SCADA/PMU (not public).
    let score = 0;
    const reasons: string[] = [];
    const severe = nwsAlerts.filter((a) => a.severity === 'Extreme' || a.severity === 'Severe').length;
    if (severe > 0) {
      score += Math.min(40, severe * 8);
      reasons.push(`${severe} severe/extreme weather alert(s)`);
    }
    const totalOut = odinUtils.reduce((s, u) => s + u.totalOutages, 0);
    if (totalOut > 50000) {
      score += 25;
      reasons.push(`High reported outages (${totalOut.toLocaleString()})`);
    } else if (totalOut > 10000) {
      score += 12;
      reasons.push(`Elevated outages (${totalOut.toLocaleString()})`);
    }
    if (latestDemand && totalGen > 0) {
      const d = Number(latestDemand.value);
      const ratio = d / totalGen;
      if (ratio > 1.02) {
        score += 20;
        reasons.push('Demand above reported generation mix total');
      } else if (ratio > 0.95) {
        score += 10;
        reasons.push('Tight demand vs generation');
      }
    }
    if (quakes.some((q) => q.mag >= 6)) {
      score += 15;
      reasons.push('M6+ earthquake in last 24h');
    }
    score = Math.min(100, score);
    const level = score >= 70 ? 'High' : score >= 35 ? 'Elevated' : 'Low';
    const color = score >= 70 ? '#ef4444' : score >= 35 ? '#f59e0b' : '#22c55e';
    // Reactive support need tracks stress (illustrative)
    const varNeed = score >= 70 ? 'Elevated support need' : score >= 35 ? 'Monitor' : 'Nominal';
    return { score, level, color, reasons, varNeed };
  }, [nwsAlerts, odinUtils, latestDemand, totalGen, quakes]);

  const lineFilterExpr = useMemo(() => {
    const enabledClasses: string[] = [];
    for (const opt of VOLT_FILTER_OPTIONS) {
      if (voltFilters[opt.id]) enabledClasses.push(...opt.classes);
    }
    // MapLibre filter: class in enabled OR (missing class but voltage >= minKv)
    // Structure: ['all', ['>=', voltage, minKv], ['any', ...class matches, no-class fallback]]
    const classMatch: unknown[] = ['any'];
    for (const c of enabledClasses) {
      classMatch.push(['==', ['get', 'VOLT_CLASS'], c]);
    }
    // If no classes selected, show nothing
    if (enabledClasses.length === 0) {
      return ['==', ['get', 'VOLT_CLASS'], '__none__'] as unknown[];
    }
    return [
      'all',
      ['>=', ['coalesce', ['to-number', ['get', 'VOLTAGE']], 0], minKv],
      classMatch,
    ] as unknown[];
  }, [voltFilters, minKv]);

  const subCount = useMemo(() => {
    let n = 0;
    for (const r of SUB_REGIONS) {
      if (layers.substations && subRegionOn[r.id] && subData[r.id]) n += subData[r.id]!.features.length;
    }
    return n;
  }, [layers.substations, subRegionOn, subData]);

  const plantCount = useMemo(() => {
    let n = 0;
    for (const r of PLANT_REGIONS) {
      if (regionOn[r.id] && plantData[r.id]) n += plantData[r.id]!.features.length;
    }
    return n;
  }, [regionOn, plantData]);

  const handleSearch = async () => {
    const q = search.trim();
    if (!q) return;
    setSearchMsg('Searching…');
    setPlantPopup(null);
    const geo = await geocode(q);
    if (geo && mapRef.current) {
      mapRef.current.flyTo({ center: [geo.lon, geo.lat], zoom: q.length <= 5 ? 10 : 7, duration: 1600 });
      setSearchMsg(geo.display_name);
      return;
    }
    if (searchResults.length > 0) {
      setSearchMsg(`Utility: ${searchResults[0].name}`);
      return;
    }
    setSearchMsg('No results. Try a US ZIP, city, or state name.');
  };

  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const layersHit = [
      ...PLANT_REGIONS.map((r) => `plants-circle-${r.id}`),
      ...SUB_REGIONS.map((r) => `subs-circle-${r.id}`),
      'lines-hit',
    ];
    const feats = e.features?.filter((f) => layersHit.includes(f.layer?.id || ''));
    setCursor(feats && feats.length > 0 ? 'pointer' : 'default');
  }, []);

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const plantLayers = PLANT_REGIONS.map((r) => `plants-circle-${r.id}`);
    const subLayers = SUB_REGIONS.map((r) => `subs-circle-${r.id}`);
    const feat = e.features?.find(
      (f) =>
        plantLayers.includes(f.layer?.id || '') ||
        subLayers.includes(f.layer?.id || '') ||
        f.layer?.id === 'lines-hit'
    );
    if (!feat) {
      setPlantPopup(null);
      return;
    }
    const props = (feat.properties || {}) as Record<string, unknown>;
    if (feat.layer?.id === 'lines-hit') {
      setPlantPopup({
        lon: e.lngLat.lng,
        lat: e.lngLat.lat,
        kind: 'line',
        line: props as unknown as LineProps,
      });
      return;
    }
    if (feat.geometry.type === 'Point') {
      const coords = feat.geometry.coordinates as [number, number];
      if (feat.layer?.id?.startsWith('subs-circle-')) {
        setPlantPopup({
          lon: coords[0],
          lat: coords[1],
          kind: 'substation',
          substation: props as unknown as SubstationProps,
        });
      } else {
        setPlantPopup({
          lon: coords[0],
          lat: coords[1],
          kind: 'plant',
          plant: props as unknown as PlantProps,
        });
      }
    } else {
      setPlantPopup(null);
    }
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div
          className="logo"
          title="Reset map & refresh"
          onClick={() => {
            mapRef.current?.flyTo({ center: [-98.5, 39.5], zoom: 3.6, duration: 1200 });
            setPlantPopup(null);
            loadLive();
            loadPrices();
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              mapRef.current?.flyTo({ center: [-98.5, 39.5], zoom: 3.6, duration: 1200 });
              setPlantPopup(null);
              loadLive();
              loadPrices();
            }
          }}
        >
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
            <span className="kpi-label">Plants loaded</span>
            <span className="kpi-value">{plantCount.toLocaleString()}</span>
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
          <button className="btn btn-ghost" onClick={loadLive} disabled={loading}>
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
              <div style={{ marginTop: 10, maxHeight: 120, overflowY: 'auto' }}>
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
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3>Plant regions (by grid area)</h3>
            <div className="layer-list">
              {PLANT_REGIONS.map((r) => (
                <label className="layer-item" key={r.id}>
                  <input
                    type="checkbox"
                    checked={!!regionOn[r.id]}
                    onChange={() => setRegionOn((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                  />
                  <span className="layer-swatch" style={{ background: '#eab308' }} />
                  <span style={{ fontSize: '0.78rem' }}>{r.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {plantData[r.id] ? plantData[r.id]!.features.length : '…'}
                  </span>
                </label>
              ))}
              <label className="layer-item">
                <input
                  type="checkbox"
                  checked={layers.lines}
                  onChange={() => setLayers((p) => ({ ...p, lines: !p.lines }))}
                />
                <span className="layer-swatch" style={{ background: '#94a3b8' }} />
                Transmission lines (HV sample)
              </label>
              {layers.lines && (
                <div className="volt-filter">
                  <div className="volt-filter-title">Voltage filter</div>
                  <div className="volt-filter-row">
                    <label className="volt-min-label">
                      Min kV: <strong>{minKv}</strong>
                    </label>
                    <input
                      type="range"
                      min={230}
                      max={765}
                      step={5}
                      value={minKv}
                      onChange={(e) => setMinKv(Number(e.target.value))}
                      className="volt-slider"
                    />
                  </div>
                  <div className="volt-filter-classes">
                    {VOLT_FILTER_OPTIONS.map((opt) => (
                      <label key={opt.id} className="volt-chip">
                        <input
                          type="checkbox"
                          checked={!!voltFilters[opt.id]}
                          onChange={() =>
                            setVoltFilters((prev) => ({ ...prev, [opt.id]: !prev[opt.id] }))
                          }
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                  <div className="volt-filter-actions">
                    <button
                      type="button"
                      className="btn btn-ghost volt-btn"
                      onClick={() =>
                        setVoltFilters({
                          '220-287': true,
                          '345': true,
                          '500': true,
                          '735': true,
                          'DC': true,
                        })
                      }
                    >
                      All classes
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost volt-btn"
                      onClick={() => {
                        setVoltFilters({
                          '220-287': false,
                          '345': false,
                          '500': true,
                          '735': true,
                          'DC': true,
                        });
                        setMinKv(500);
                      }}
                    >
                      ≥500 kV only
                    </button>
                  </div>
                </div>
              )}
              <label className="layer-item">
                <input
                  type="checkbox"
                  checked={layers.interconnects}
                  onChange={() => setLayers((p) => ({ ...p, interconnects: !p.interconnects }))}
                />
                <span className="layer-swatch" style={{ background: '#3b82f6' }} />
                Interconnection outlines (approx.)
              </label>
              <label className="layer-item">
                <input
                  type="checkbox"
                  checked={layers.substations}
                  onChange={() => setLayers((p) => ({ ...p, substations: !p.substations }))}
                />
                <span className="layer-swatch" style={{ background: '#22d3ee' }} />
                Substations (all regions)
                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {subCount.toLocaleString()}
                </span>
              </label>
              {layers.substations && SUB_REGIONS.map((r) => (
                <label className="layer-item" key={`subtog-${r.id}`} style={{ paddingLeft: 20 }}>
                  <input
                    type="checkbox"
                    checked={!!subRegionOn[r.id]}
                    onChange={() => setSubRegionOn((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                  />
                  <span style={{ fontSize: '0.72rem' }}>{r.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    {subData[r.id] ? subData[r.id]!.features.length : '…'}
                  </span>
                </label>
              ))}
            </div>
            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
              Click any plant for details. Interconnection outlines are approximate footprints (not official NERC boundaries). Transmission is a high-voltage (≥230 kV) open-data sample.
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
                    <div
                      className="fuel-bar"
                      style={{
                        width: `${Math.min(f.pct, 100)}%`,
                        background: FUEL_COLORS[f.fueltype] || FUEL_COLORS.OTH,
                      }}
                    />
                  </div>
                  <span className="fuel-pct">{f.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Major BA demand (EIA)</h3>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              Hourly demand by balancing authority · public EIA-930
            </div>
            <div className="hazard-list">
              {baDemand.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading BA demand…</div>
              )}
              {baDemand.map((b) => (
                <div className="odin-row" key={b.code}>
                  <span className="odin-name" title={b.name}>{b.code} · {b.name.replace(/, LLC|, Inc\.?.*$/i, '')}</span>
                  <span className="odin-count" style={{ color: '#38bdf8' }}>{formatMWh(b.value)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>USGS M4.5+ quakes (24h)</h3>
            <label className="layer-item" style={{ marginBottom: 8 }}>
              <input type="checkbox" checked={showQuakes} onChange={() => setShowQuakes((v) => !v)} />
              Show on map
            </label>
            <div className="hazard-list">
              {quakes.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>None in last 24h (or loading…)</div>
              )}
              {quakes.slice(0, 8).map((q) => (
                <div
                  className="hazard-item"
                  key={q.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => mapRef.current?.flyTo({ center: [q.lon, q.lat], zoom: 6, duration: 1200 })}
                >
                  <span className="hazard-sev" style={{ background: q.mag >= 6 ? '#ef4444' : q.mag >= 5 ? '#f97316' : '#eab308' }} />
                  <div>
                    <div className="hazard-event">M{q.mag.toFixed(1)} · {q.place}</div>
                    <div className="hazard-area">{q.time ? new Date(q.time).toLocaleString() : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>NWS grid-relevant alerts</h3>
            {hazardError && <div className="error-banner">{hazardError}</div>}
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              {nwsAlerts.length} active · NOAA public API · not a forecast product
            </div>
            <div className="hazard-list">
              {nwsAlerts.length === 0 && !hazardError && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No grid-relevant alerts (or loading…)</div>
              )}
              {nwsAlerts.slice(0, 12).map((a) => (
                <div className="hazard-item" key={a.id}>
                  <span className="hazard-sev" style={{ background: severityColor(a.severity) }} />
                  <div>
                    <div className="hazard-event">{a.event}</div>
                    <div className="hazard-area">{a.area || a.headline}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>ODIN utility outages</h3>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              {odinUtils.reduce((s, u) => s + u.totalOutages, 0).toLocaleString()} customers reported across{' '}
              {odinUtils.length} utilities · ORNL public status (not full national coverage)
            </div>
            <div className="hazard-list">
              {odinUtils.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No outages in feed (or loading…)</div>
              )}
              {odinUtils.slice(0, 10).map((u) => (
                <div className="odin-row" key={u.name + String(u.totalOutages)}>
                  <span className="odin-name" title={u.name}>{u.name}</span>
                  <span className="odin-count">{u.totalOutages.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Map legend</h3>
            <div className="legend-inline">
              <div className="legend-section">Plants</div>
              {[
                ['Gas', '#f97316'], ['Coal', '#64748b'], ['Nuclear', '#a855f7'],
                ['Wind', '#06b6d4'], ['Solar', '#eab308'], ['Hydro', '#3b82f6'],
              ].map(([k, c]) => (
                <div className="legend-item" key={k}>
                  <span className="legend-swatch" style={{ background: c as string }} />
                  {k}
                </div>
              ))}
              <div className="legend-section">Lines / subs</div>
              <div className="legend-item"><span className="legend-line" style={{ background: '#f87171' }} />≥500 kV</div>
              <div className="legend-item"><span className="legend-line" style={{ background: '#fbbf24' }} />345 kV</div>
              <div className="legend-item"><span className="legend-line" style={{ background: '#38bdf8' }} />220–287 kV</div>
              <div className="legend-item"><span className="legend-swatch" style={{ background: '#22d3ee' }} />Substation</div>
            </div>
          </div>

          <div className="sidebar-section" style={{ flex: 1 }}>
            <h3>About & limits</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Legal public data: EIA hourly RTO + BA demand, NWS alerts, ODIN (ORNL), USGS quakes, CommonGrid, Nominatim, open plant/line archives.
              Auto-refresh 15 min. Data lag ~1 hour.
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--warning)', lineHeight: 1.5, marginTop: 10 }}>
              Live customer outages are not mapped here. County-level feeds (e.g. ODIN public status) and licensed APIs
              (PowerOutage.us) exist separately. For outages use{' '}
              <a href="https://poweroutage.us" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                PowerOutage.us
              </a>
              {' '}or utility maps.
            </p>
          </div>
        </aside>

        <div className="map-container">
          <Map
            ref={mapRef}
            initialViewState={{ longitude: -96, latitude: 39, zoom: 3.8 }}
            style={{ width: '100%', height: '100%', cursor }}
            mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
            interactiveLayerIds={[...PLANT_REGIONS.map((r) => `plants-circle-${r.id}`), ...SUB_REGIONS.map((r) => `subs-circle-${r.id}`), 'lines-hit']}
            onClick={onMapClick}
            onMouseMove={onMouseMove}
          >
            <NavigationControl position="bottom-right" showCompass={false} />

            {layers.interconnects && interconnectGeojson && (
              <Source id="interconnects" type="geojson" data={interconnectGeojson}>
                <Layer
                  id="interconnect-fill"
                  type="fill"
                  paint={{
                    'fill-color': ['coalesce', ['get', 'color'], '#3b82f6'],
                    'fill-opacity': 0.06,
                  }}
                />
                <Layer
                  id="interconnect-outline"
                  type="line"
                  paint={{
                    'line-color': ['coalesce', ['get', 'color'], '#3b82f6'],
                    'line-width': 1.5,
                    'line-opacity': 0.7,
                    'line-dasharray': [2, 1],
                  }}
                />
              </Source>
            )}

            {layers.lines && linesGeojson && (
              <Source id="lines-national" type="geojson" data={linesGeojson}>
                <Layer
                  id="lines-hit"
                  type="line"
                  filter={lineFilterExpr as any}
                  paint={{
                    'line-color': '#000000',
                    'line-opacity': 0,
                    'line-width': [
                      'interpolate', ['linear'], ['zoom'],
                      3, 8,
                      8, 14,
                      12, 20,
                    ],
                  }}
                />
                <Layer
                  id="lines-line"
                  type="line"
                  filter={lineFilterExpr as any}
                  paint={{
                    'line-color': [
                      'match', ['coalesce', ['get', 'VOLT_CLASS'], ''],
                      '345', '#fbbf24',
                      '500', '#f87171',
                      '735 AND ABOVE', '#ef4444',
                      '220-287', '#38bdf8',
                      'DC', '#c084fc',
                      '#64748b',
                    ],
                    'line-width': [
                      'interpolate', ['linear'], ['zoom'],
                      3, [
                        'match', ['coalesce', ['get', 'VOLT_CLASS'], ''],
                        '500', 1.2,
                        '735 AND ABOVE', 1.4,
                        '345', 0.9,
                        'DC', 1.0,
                        0.5
                      ],
                      7, [
                        'match', ['coalesce', ['get', 'VOLT_CLASS'], ''],
                        '500', 2.8,
                        '735 AND ABOVE', 3.2,
                        '345', 2.0,
                        'DC', 2.2,
                        1.2
                      ],
                      11, [
                        'match', ['coalesce', ['get', 'VOLT_CLASS'], ''],
                        '500', 4.5,
                        '735 AND ABOVE', 5.5,
                        '345', 3.2,
                        'DC', 3.5,
                        2.0
                      ],
                    ],
                    'line-opacity': 0.85,
                    'line-blur': 0.2,
                  }}
                />
              </Source>
            )}

            {PLANT_REGIONS.map((r) =>
              regionOn[r.id] && plantData[r.id] ? (
                <Source key={r.id} id={`plants-${r.id}`} type="geojson" data={plantData[r.id]!}>
                  <Layer id={`plants-circle-${r.id}`} type="circle" paint={plantCirclePaint as any} />
                </Source>
              ) : null
            )}


            {layers.substations && SUB_REGIONS.map((r) =>
              subRegionOn[r.id] && subData[r.id] ? (
                <Source key={`sub-${r.id}`} id={`subs-${r.id}`} type="geojson" data={subData[r.id]!}>
                  <Layer
                    id={`subs-circle-${r.id}`}
                    type="circle"
                    minzoom={4}
                    paint={{
                      'circle-radius': [
                        'interpolate', ['linear'], ['zoom'],
                        4, 2,
                        7, 4,
                        11, 8,
                      ],
                      'circle-color': [
                        'match', ['downcase', ['coalesce', ['get', 'TYPE'], 'substation']],
                        'substation', '#22d3ee',
                        'tap', '#67e8f9',
                        'riser', '#a5f3fc',
                        'transmission', '#06b6d4',
                        'distribution', '#67e8f9',
                        '#22d3ee',
                      ],
                      'circle-opacity': 0.85,
                      'circle-stroke-width': 0.4,
                      'circle-stroke-color': '#0a0e14',
                    }}
                  />
                </Source>
              ) : null
            )}

            {showQuakes && quakes.length > 0 && (
              <Source id="quakes-src" type="geojson" data={quakesGeo}>
                <Layer
                  id="quakes-circle"
                  type="circle"
                  paint={{
                    'circle-radius': [
                      'interpolate', ['linear'], ['get', 'mag'],
                      4.5, 6,
                      6, 12,
                      7, 18,
                    ],
                    'circle-color': [
                      'interpolate', ['linear'], ['get', 'mag'],
                      4.5, '#eab308',
                      5.5, '#f97316',
                      6.5, '#ef4444',
                    ],
                    'circle-opacity': 0.75,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#fff',
                  }}
                />
              </Source>
            )}

            {plantPopup && (
              <Popup
                longitude={plantPopup.lon}
                latitude={plantPopup.lat}
                anchor="bottom"
                onClose={() => setPlantPopup(null)}
                closeOnClick={false}
                maxWidth="320px"
              >
                {plantPopup.kind === 'line' && plantPopup.line ? (
                  <div className="plant-popup">
                    <div className="plant-popup-title">Transmission line</div>
                    <div className="plant-popup-row">
                      <span>Voltage</span>
                      <strong>
                        {plantPopup.line.VOLTAGE != null
                          ? `${Number(plantPopup.line.VOLTAGE)} kV`
                          : '—'}
                      </strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Class</span>
                      <strong>{plantPopup.line.VOLT_CLASS || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Type</span>
                      <strong>{plantPopup.line.TYPE || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Status</span>
                      <strong>{plantPopup.line.STATUS || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Owner</span>
                      <strong>{plantPopup.line.OWNER || '—'}</strong>
                    </div>
                  </div>
                ) : plantPopup.kind === 'substation' && plantPopup.substation ? (
                  <div className="plant-popup">
                    <div className="plant-popup-title">{plantPopup.substation.NAME || 'Substation'}</div>
                    <div className="plant-popup-row">
                      <span>Facility type</span>
                      <strong>{plantPopup.substation.TYPE || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Status</span>
                      <strong>{plantPopup.substation.STATUS || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Max voltage</span>
                      <strong>
                        {plantPopup.substation.MAX_VOLT != null && plantPopup.substation.MAX_VOLT !== ''
                          ? `${Number(plantPopup.substation.MAX_VOLT)} kV`
                          : '—'}
                      </strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Min voltage</span>
                      <strong>
                        {plantPopup.substation.MIN_VOLT != null && plantPopup.substation.MIN_VOLT !== ''
                          ? `${Number(plantPopup.substation.MIN_VOLT)} kV`
                          : '—'}
                      </strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Connected lines</span>
                      <strong>
                        {plantPopup.substation.LINES != null && plantPopup.substation.LINES !== ''
                          ? String(plantPopup.substation.LINES)
                          : '—'}
                      </strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>City</span>
                      <strong>{plantPopup.substation.CITY || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>County</span>
                      <strong>{plantPopup.substation.COUNTY || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>State</span>
                      <strong>{plantPopup.substation.STATE || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>ZIP</span>
                      <strong>{plantPopup.substation.ZIP || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Coordinates</span>
                      <strong>
                        {plantPopup.lat.toFixed(5)}, {plantPopup.lon.toFixed(5)}
                      </strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Data source</span>
                      <strong>{plantPopup.substation.SOURCE || 'HIFLD-derived / open'}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="plant-popup">
                    <div className="plant-popup-title">{plantPopup.plant?.Plant_Name || 'Power plant'}</div>
                    <div className="plant-popup-row">
                      <span>Fuel</span>
                      <strong style={{ textTransform: 'capitalize' }}>{plantPopup.plant?.PrimSource || '—'}</strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Capacity</span>
                      <strong>
                        {plantPopup.plant?.Total_MW != null
                          ? `${Number(plantPopup.plant.Total_MW).toLocaleString()} MW`
                          : '—'}
                      </strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Location</span>
                      <strong>
                        {[plantPopup.plant?.City, plantPopup.plant?.County, plantPopup.plant?.State]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </strong>
                    </div>
                    <div className="plant-popup-row">
                      <span>Utility</span>
                      <strong>{plantPopup.plant?.Utility_Na || '—'}</strong>
                    </div>
                  </div>
                )}
              </Popup>
            )}
          </Map>

          <div className="map-overlay-info">
            Click plant / line / sub for details
          </div>
        </div>

        <button
          type="button"
          className="rail-toggle"
          style={{ right: rightOpen ? 258 : 8 }}
          onClick={() => setRightOpen((v) => !v)}
        >
          {rightOpen ? 'Hide prices ›' : '‹ Prices & risk'}
        </button>

        <aside className={`sidebar-right${rightOpen ? '' : ' collapsed'}`}>
          <div className="sidebar-section">
            <h3>Energy prices (EIA)</h3>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              Auto-refresh 5 min · crude/products daily · retail monthly
              {pricesUpdated ? ` · ${pricesUpdated.toLocaleTimeString()}` : ''}
            </div>
            <button
              type="button"
              className="btn btn-ghost volt-btn"
              style={{ marginBottom: 8 }}
              onClick={() => loadPrices()}
            >
              Refresh prices now
            </button>
            {energyPrices.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading prices…</div>
            )}
            {energyPrices.map((r) => (
              <div className="price-row" key={r.id}>
                <span className="price-name" title={r.period}>{r.name}</span>
                <span className="price-val">{r.value} {r.unit}</span>
              </div>
            ))}
            <p className="disclaimer-tiny">
              Public EIA series only. Not ISO real-time LMP. Fuel-specific wholesale power prices by source are not published as a single live national feed.
            </p>
          </div>

          <div className="sidebar-section">
            <h3>PMU / synchrophasor</h3>
            <div className="stress-level" style={{ color: pmuStatus.mode === 'live' ? '#22c55e' : '#94a3b8' }}>
              {pmuStatus.mode === 'live' ? 'Live endpoint' : 'Not connected'}
            </div>
            <p className="disclaimer-tiny">{pmuStatus.detail}</p>
            <p className="disclaimer-tiny">
              No free national live PMU API. Optional VITE_PMU_ENDPOINT for licensed PDC feeds.
            </p>
          </div>

          <div className="sidebar-section">
            <h3>Voltage sag risk (proxy)</h3>
            <div className="stress-level" style={{ color: gridStress.color }}>{gridStress.level} · {gridStress.score}/100</div>
            <div className="stress-meter">
              <div style={{ width: `${gridStress.score}%`, background: gridStress.color }} />
            </div>
            {gridStress.reasons.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No elevated stress factors from public feeds.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {gridStress.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <p className="disclaimer-tiny">
              Not measured bus voltage or PMU sag events. Score is a situational proxy from weather alerts, ODIN outage counts, demand/gen, and quakes. True sag detection requires utility SCADA (not public).
            </p>
          </div>

          <div className="sidebar-section">
            <h3>Reactive power support (proxy)</h3>
            <div className="stress-level" style={{ color: gridStress.color }}>{gridStress.varNeed}</div>
            <p className="disclaimer-tiny">
              Dynamic VAR / reactive compensation setpoints are operational and not released as a national public API. This indicator mirrors grid stress only as a planning cue for EOCs—not a dispatch signal.
            </p>
          </div>
        </aside>

      </div>
    </div>
  );
}
