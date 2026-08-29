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
  { id: 'northeast', label: 'Northeast (ISO-NE / NYISO / PJM East + ME/DC)', file: 'plants_northeast.geojson' },
  { id: 'southeast', label: 'Southeast', file: 'plants_southeast.geojson' },
  { id: 'midwest', label: 'Midwest / Plains (MISO + ND/SD/NE/KS)', file: 'plants_midwest.geojson' },
  { id: 'southcentral', label: 'South Central / ERCOT area', file: 'plants_southcentral.geojson' },
  { id: 'west', label: 'West (CAISO / WECC)', file: 'plants_west.geojson' },
  { id: 'alaska', label: 'Alaska Interconnection', file: 'plants_alaska.geojson' },
  { id: 'hawaii', label: 'Hawaii', file: 'plants_hawaii.geojson' },
] as const;

const SUB_REGIONS = [
  { id: 'northeast', label: 'NE substations', file: 'substations_northeast.geojson' },
  { id: 'southeast_p1', label: 'SE substations (1/2)', file: 'substations_southeast_p1.geojson' },
  { id: 'southeast_p2', label: 'SE substations (2/2)', file: 'substations_southeast_p2.geojson' },
  { id: 'midwest_p1', label: 'Midwest substations (1/2)', file: 'substations_midwest_p1.geojson' },
  { id: 'midwest_p2', label: 'Midwest substations (2/2)', file: 'substations_midwest_p2.geojson' },
  { id: 'southcentral', label: 'South Central substations', file: 'substations_southcentral.geojson' },
  { id: 'west_p1', label: 'West substations (1/2)', file: 'substations_west_p1.geojson' },
  { id: 'west_p2', label: 'West substations (2/2)', file: 'substations_west_p2.geojson' },
  { id: 'alaska', label: 'Alaska substations', file: 'substations_alaska.geojson' },
  { id: 'hawaii', label: 'Hawaii substations', file: 'substations_hawaii.geojson' },
] as const;


const WELL_LINE_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','KS','KY','LA','MD','MI',
  'MS','MO','MT','NE','NV','NY','NM','ND','OH','OK','OR','PA','SD','TN','TX','UT','VA','WV','WY',
] as const;

const WELL_LINE_FILES = [
  'wells_states_pa.geojson',
  'wells_states_oh.geojson',
  'wells_states_ne.geojson',
  'wells_states_se.geojson',
  'wells_states_mw.geojson',
  'wells_states_sc.geojson',
  'wells_states_we.geojson',
] as const;

const GAS_LINE_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
] as const;

const GAS_LINE_FILES = [
  'pipelines_gas_states_ne.geojson',
  'pipelines_gas_states_se.geojson',
  'pipelines_gas_states_mw.geojson',
  'pipelines_gas_states_sc.geojson',
  'pipelines_gas_states_tx.geojson',
  'pipelines_gas_states_we.geojson',
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
  kind?: 'power' | 'gas' | 'crude' | 'gasoline' | 'diesel' | 'heat' | 'jet' | 'other';
  fullName?: string;
  seriesKey?: string; // e.g. pet:RWTC | elec:RES | ng:HH
}

interface DetailMeta {
  label: string;
  value: string;
  category?: string;
}

interface DetailState {
  title: string;
  subtitle?: string;
  iconKind?: PriceRow['kind'];
  meta: DetailMeta[];
  history?: { period: string; value: number }[];
  historyLabel?: string;
  source?: string;
  notes?: string;
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
  kind: 'plant' | 'substation' | 'line' | 'ev' | 'battery' | 'offshore' | 'cable';
  plant?: PlantProps;
  substation?: SubstationProps;
  line?: LineProps;
  ev?: Record<string, unknown>;
  battery?: Record<string, unknown>;
  offshore?: Record<string, unknown>;
  cable?: Record<string, unknown>;
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



const PET_META: Record<string, { name: string; kind: PriceRow['kind']; full: string }> = {
  RWTC: { name: 'WTI crude', kind: 'crude', full: 'Cushing OK WTI crude oil spot $/barrel' },
  RBRTE: { name: 'Brent crude', kind: 'crude', full: 'Europe Brent crude oil spot $/barrel' },
  EER_EPMRU_PF4_RGC_DPG: { name: 'Gasoline', kind: 'gasoline', full: 'US Gulf Coast conventional gasoline regular' },
  EER_EPD2DXL0_PF4_RGC_DPG: { name: 'Diesel ULSD', kind: 'diesel', full: 'US Gulf Coast ultra-low sulfur diesel' },
  EER_EPD2F_PF4_Y35NY_DPG: { name: 'Heating oil', kind: 'heat', full: 'NY Harbor No.2 heating oil' },
  EER_EPJK_PF4_RGC_DPG: { name: 'Jet fuel', kind: 'jet', full: 'US Gulf Coast kerosene-type jet fuel' },
};


async function fetchYahooFutures(): Promise<PriceRow[]> {
  // Prefer same-origin snapshot (avoids browser CORS on Yahoo); then try live Yahoo.
  try {
    const snap = await fetch(`${BASE}data/energy_futures.json`);
    if (snap.ok) {
      const j = await snap.json();
      if (Array.isArray(j.rows) && j.rows.length) {
        return j.rows as PriceRow[];
      }
    }
  } catch { /* fall through */ }

  const symbols: Array<{ sym: string; name: string; kind: PriceRow['kind']; unit: string }> = [
    { sym: 'CL=F', name: 'WTI crude fut', kind: 'crude', unit: '$/bbl' },
    { sym: 'BZ=F', name: 'Brent fut', kind: 'crude', unit: '$/bbl' },
    { sym: 'NG=F', name: 'Henry Hub fut', kind: 'gas', unit: '$/MMBtu' },
    { sym: 'RB=F', name: 'RBOB gas fut', kind: 'gasoline', unit: '$/gal' },
    { sym: 'HO=F', name: 'Heating oil fut', kind: 'heat', unit: '$/gal' },
  ];
  const rows: PriceRow[] = [];
  await Promise.all(
    symbols.map(async ({ sym, name, kind, unit }) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        const meta = json?.chart?.result?.[0]?.meta;
        if (!meta || meta.regularMarketPrice == null) return;
        const px = Number(meta.regularMarketPrice);
        rows.push({
          id: `fut-${sym}`,
          name,
          kind,
          fullName: `${meta.shortName || name} · ${meta.exchangeName || 'NYMEX/futures'}`,
          seriesKey: `fut:${sym}`,
          value: px.toFixed(unit.includes('bbl') ? 2 : 3),
          unit,
          period: meta.regularMarketTime
            ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 16)
            : 'live',
        });
      } catch {
        /* ignore */
      }
    })
  );
  const order = ['CL=F', 'BZ=F', 'NG=F', 'RB=F', 'HO=F'];
  rows.sort((a, b) => order.indexOf(a.id.replace('fut-', '')) - order.indexOf(b.id.replace('fut-', '')));
  return rows;
}

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
    const units = String(r.units || '');
    const meta = PET_META[series];
    const desc = String(r['series-description'] || r['product-name'] || series);
    return {
      id: `pet-${series}`,
      name: meta?.name || desc.slice(0, 18),
      kind: meta?.kind || 'other',
      fullName: meta?.full || desc,
      seriesKey: `pet:${series}`,
      value: Number(r.value).toFixed(units.includes('BBL') ? 2 : 3),
      unit: units.includes('BBL') ? '$/bbl' : units.includes('GAL') ? '$/gal' : units || '$',
      period: String(r.period || ''),
    };
  } catch {
    return null;
  }
}

async function fetchEnergyPrices(): Promise<PriceRow[]> {
  const rows: PriceRow[] = [];

  // Near-real-time NYMEX-style futures via Yahoo Finance (market data)
  try {
    const fut = await fetchYahooFutures();
    rows.push(...fut);
  } catch { /* ignore */ }

  if (!EIA_KEY) return rows;

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
      const labels: Record<string, { name: string; full: string }> = {
        RES: { name: 'Power · Res', full: 'Electricity retail residential' },
        COM: { name: 'Power · Com', full: 'Electricity retail commercial' },
        IND: { name: 'Power · Ind', full: 'Electricity retail industrial' },
        TRA: { name: 'Power · Trans', full: 'Electricity retail transportation' },
        ALL: { name: 'Power · All', full: 'Electricity retail all sectors' },
      };
      for (const [id, r] of Object.entries(latest)) {
        const meta = labels[id] || { name: String(r.sectorName || id), full: String(r.sectorName || id) };
        rows.push({
          id: `elec-${id}`,
          name: meta.name,
          kind: 'power',
          fullName: meta.full,
          seriesKey: `elec:${id}`,
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
          name: 'Gas · HH',
          kind: 'gas',
          fullName: 'Henry Hub natural gas spot',
          seriesKey: 'ng:HH',
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
          name: `Imp. crude`,
          kind: 'crude',
          fullName: `Imported crude FOB · ${area || 'selected'}`,
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
        const short =
          /residential/i.test(proc) ? 'Gas · Res' :
          /industrial/i.test(proc) ? 'Gas · Ind' :
          /electric/i.test(proc) ? 'Gas · Power' :
          /citygate/i.test(proc) ? 'Gas · City' :
          `Gas · ${proc.replace(/ Price$/i, '').slice(0, 10)}`;
        rows.push({
          id: `ng-${proc}`.slice(0, 40),
          name: short,
          kind: 'gas',
          fullName: `Natural gas · ${proc}`,
          value: Number(r.value).toFixed(2),
          unit: String(r.units || '$/Mcf'),
          period: String(r.period || ''),
        });
      }
    }
  } catch { /* ignore */ }

  return rows;
}


async function fetchPriceHistory(seriesKey: string): Promise<{ period: string; value: number }[]> {
  if (!EIA_KEY || !seriesKey) return [];
  try {
    const [kind, code] = seriesKey.split(':');
    if (kind === 'fut') {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?interval=1d&range=3mo`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const json = await res.json();
        const r0 = json?.chart?.result?.[0];
        const ts: number[] = r0?.timestamp || [];
        const closes: Array<number | null> = r0?.indicators?.quote?.[0]?.close || [];
        const out: { period: string; value: number }[] = [];
        for (let i = ts.length - 1; i >= 0; i--) {
          const c = closes[i];
          if (c == null) continue;
          out.push({ period: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: c });
        }
        return out;
      } catch {
        return [];
      }
    }
    if (kind === 'pet') {
      const url = new URL('https://api.eia.gov/v2/petroleum/pri/spt/data/');
      url.searchParams.set('api_key', EIA_KEY);
      url.searchParams.set('frequency', 'daily');
      url.searchParams.set('data[0]', 'value');
      url.searchParams.append('facets[series][]', code);
      url.searchParams.set('sort[0][column]', 'period');
      url.searchParams.set('sort[0][direction]', 'desc');
      url.searchParams.set('length', '120'); // ~4 months daily
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const json = await res.json();
      return ((json.response?.data || []) as Array<Record<string, unknown>>)
        .filter((r) => r.value != null)
        .map((r) => ({ period: String(r.period), value: Number(r.value) }));
    }
    if (kind === 'elec') {
      const url = new URL('https://api.eia.gov/v2/electricity/retail-sales/data/');
      url.searchParams.set('api_key', EIA_KEY);
      url.searchParams.set('frequency', 'monthly');
      url.searchParams.set('data[0]', 'price');
      url.searchParams.append('facets[stateid][]', 'US');
      url.searchParams.append('facets[sectorid][]', code);
      url.searchParams.set('sort[0][column]', 'period');
      url.searchParams.set('sort[0][direction]', 'desc');
      url.searchParams.set('length', '36'); // 3 years monthly
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const json = await res.json();
      return ((json.response?.data || []) as Array<Record<string, unknown>>)
        .filter((r) => r.price != null)
        .map((r) => ({ period: String(r.period), value: Number(r.price) }));
    }
    if (kind === 'ng' && code === 'HH') {
      const url = new URL('https://api.eia.gov/v2/natural-gas/pri/fut/data/');
      url.searchParams.set('api_key', EIA_KEY);
      url.searchParams.set('frequency', 'daily');
      url.searchParams.set('data[0]', 'value');
      url.searchParams.append('facets[series][]', 'RNGWHHD');
      url.searchParams.set('sort[0][column]', 'period');
      url.searchParams.set('sort[0][direction]', 'desc');
      url.searchParams.set('length', '120');
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const json = await res.json();
      return ((json.response?.data || []) as Array<Record<string, unknown>>)
        .filter((r) => r.value != null)
        .map((r) => ({ period: String(r.period), value: Number(r.value) }));
    }
    if (kind === 'ba') {
      const url = new URL('https://api.eia.gov/v2/electricity/rto/region-data/data/');
      url.searchParams.set('api_key', EIA_KEY);
      url.searchParams.set('frequency', 'hourly');
      url.searchParams.set('data[0]', 'value');
      url.searchParams.append('facets[type][]', 'D');
      url.searchParams.append('facets[respondent][]', code);
      url.searchParams.set('sort[0][column]', 'period');
      url.searchParams.set('sort[0][direction]', 'desc');
      url.searchParams.set('length', '48');
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const json = await res.json();
      return ((json.response?.data || []) as Array<Record<string, unknown>>)
        .filter((r) => r.value != null)
        .map((r) => ({ period: String(r.period), value: Number(r.value) }));
    }
  } catch {
    return [];
  }
  return [];
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


function PriceIcon({ kind }: { kind?: PriceRow['kind'] }) {
  const k = kind || 'other';
  const stroke = 'currentColor';
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (k) {
    case 'power':
      return (
        <svg {...common} className="price-svg price-svg-power">
          <path d="M13 2 4 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      );
    case 'gas':
      return (
        <svg {...common} className="price-svg price-svg-gas">
          <path d="M12 3c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" />
          <path d="M9 21h6" />
        </svg>
      );
    case 'crude':
      return (
        <svg {...common} className="price-svg price-svg-crude">
          <path d="M8 4h8v4l2 3v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9l2-3V4z" />
          <path d="M8 8h8" />
        </svg>
      );
    case 'gasoline':
      return (
        <svg {...common} className="price-svg price-svg-gaso">
          <path d="M4 20V8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12" />
          <path d="M8 6V4h4v2" />
          <path d="M14 10h2.5a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2" />
        </svg>
      );
    case 'diesel':
      return (
        <svg {...common} className="price-svg price-svg-diesel">
          <rect x="3" y="10" width="12" height="8" rx="1.5" />
          <path d="M15 13h3l2 2v3h-5" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="13" cy="18" r="1.5" />
        </svg>
      );
    case 'heat':
      return (
        <svg {...common} className="price-svg price-svg-heat">
          <path d="M4 20h16" />
          <path d="M6 20V10l6-6 6 6v10" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case 'jet':
      return (
        <svg {...common} className="price-svg price-svg-jet">
          <path d="M2 16 12 4l10 12-4 1-2 4-2-4-4-1z" />
        </svg>
      );
    default:
      return (
        <svg {...common} className="price-svg">
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}

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
  const [layers, setLayers] = useState({ lines: true, interconnects: true, substations: false, tesla: false, otherEv: false, battery: true, offshoreWind: true, offshoreLeases: false, subseaCables: true, hvdc: true, ogPlatforms: true, ogWells: false, pipeNg: false, pipeCrude: true, pipeHgl: false, pipeSubsea: true, compressors: true, terminals: true, solarLarge: true, coalMines: false });
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
  const [teslaGeojson, setTeslaGeojson] = useState<FeatureCollection | null>(null);
  const [otherEvGeojson, setOtherEvGeojson] = useState<FeatureCollection | null>(null);
  const [batteryGeojson, setBatteryGeojson] = useState<FeatureCollection | null>(null);
  const [offshoreTurbines, setOffshoreTurbines] = useState<FeatureCollection | null>(null);
  const [offshoreLeases, setOffshoreLeases] = useState<FeatureCollection | null>(null);
  const [subseaCables, setSubseaCables] = useState<FeatureCollection | null>(null);
  const [offshoreIx, setOffshoreIx] = useState<FeatureCollection | null>(null);
  const [hvdcGeojson, setHvdcGeojson] = useState<FeatureCollection | null>(null);
  const [ogPlatformsGeo, setOgPlatformsGeo] = useState<FeatureCollection | null>(null);
  const [ogWellsGeo, setOgWellsGeo] = useState<FeatureCollection | null>(null);
  const [pipeNgGeo, setPipeNgGeo] = useState<FeatureCollection | null>(null);
  const [pipeCrudeGeo, setPipeCrudeGeo] = useState<FeatureCollection | null>(null);
  const [pipeHglGeo, setPipeHglGeo] = useState<FeatureCollection | null>(null);
  const [pipeSubseaGeo, setPipeSubseaGeo] = useState<FeatureCollection | null>(null);
  const [compressorsGeo, setCompressorsGeo] = useState<FeatureCollection | null>(null);
  const [terminalsGeo, setTerminalsGeo] = useState<FeatureCollection | null>(null);
  const [gasByStateGeo, setGasByStateGeo] = useState<FeatureCollection | null>(null);
  const [gasStateOn, setGasStateOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GAS_LINE_STATES.map((s) => [s, false]))
  );
  const [gasMenuOpen, setGasMenuOpen] = useState(false);
  const [solarLargeGeo, setSolarLargeGeo] = useState<FeatureCollection | null>(null);
  const [coalMinesGeo, setCoalMinesGeo] = useState<FeatureCollection | null>(null);
  const [wellsByStateGeo, setWellsByStateGeo] = useState<FeatureCollection | null>(null);
  const [wellStateOn, setWellStateOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(WELL_LINE_STATES.map((s) => [s, false]))
  );
  const [wellMenuOpen, setWellMenuOpen] = useState(false);
  const [subRegionOn, setSubRegionOn] = useState<Record<string, boolean>>({ northeast: true, southeast_p1: true, southeast_p2: true, midwest_p1: true, midwest_p2: true, southcentral: true, west_p1: true, west_p2: true, alaska: true, hawaii: true });
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
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const openDetail = useCallback(async (d: DetailState, seriesKey?: string) => {
    setDetail(d);
    if (!seriesKey) return;
    setDetailLoading(true);
    try {
      const history = await fetchPriceHistory(seriesKey);
      setDetail((prev) => (prev ? { ...prev, history, historyLabel: prev.historyLabel || 'Recent history (EIA)' } : prev));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openPriceDetail = useCallback(async (r: PriceRow) => {
    await openDetail(
      {
        title: r.name,
        subtitle: r.fullName || r.name,
        iconKind: r.kind,
        meta: [
          { category: 'Value', label: 'Latest', value: `${r.value} ${r.unit}` },
          { category: 'Value', label: 'Unit', value: r.unit },
          { category: 'Value', label: 'Period', value: r.period || '—' },
          { category: 'Identity', label: 'Series id', value: r.seriesKey || r.id },
          { category: 'Identity', label: 'Product class', value: r.kind || 'other' },
          { category: 'Identity', label: 'Full name', value: r.fullName || r.name },
          { category: 'Source', label: 'Publisher', value: 'U.S. EIA' },
          { category: 'Source', label: 'API', value: 'Open Data API v2' },
        ],
        historyLabel: r.seriesKey?.startsWith('elec:')
          ? 'Monthly history (up to 3 years)'
          : 'Daily history (recent months)',
        source: 'EIA Open Data API v2',
        notes: 'Public survey/market series. Not ISO real-time LMP. Lag varies by product.',
      },
      r.seriesKey
    );
  }, [openDetail]);


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
    fetch(`${BASE}data/ev_tesla.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setTeslaGeojson(gj))
      .catch((e) => console.warn('Tesla EV load failed', e));
    fetch(`${BASE}data/ev_other.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setOtherEvGeojson(gj))
      .catch((e) => console.warn('Other EV load failed', e));
    fetch(`${BASE}data/battery_storage.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setBatteryGeojson(gj))
      .catch((e) => console.warn('Battery load failed', e));
    fetch(`${BASE}data/offshore_wind_turbines.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setOffshoreTurbines(gj))
      .catch((e) => console.warn('Offshore turbines failed', e));
    fetch(`${BASE}data/offshore_wind_leases.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setOffshoreLeases(gj))
      .catch((e) => console.warn('Offshore leases failed', e));
    fetch(`${BASE}data/subsea_export_cables.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setSubseaCables(gj))
      .catch((e) => console.warn('Subsea cables failed', e));
    fetch(`${BASE}data/offshore_interconnections.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setOffshoreIx(gj))
      .catch((e) => console.warn('Offshore IX failed', e));
    fetch(`${BASE}data/hvdc_interties.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((gj) => gj && setHvdcGeojson(gj))
      .catch((e) => console.warn('HVDC load failed', e));
    fetch(`${BASE}data/og_platforms.geojson`).then(r=>r.ok?r.json():null).then(g=>g&&setOgPlatformsGeo(g)).catch(()=>{});
    Promise.all([1,2,3,4,5].map(i => fetch(`${BASE}data/og_wells_p${i}.geojson`).then(r=>r.ok?r.json():null)))
      .then(parts => {
        const feats = parts.flatMap(p => (p && p.features) || []);
        if (feats.length) setOgWellsGeo({ type: 'FeatureCollection', features: feats });
      }).catch(()=>{});
    fetch(`${BASE}data/pipelines_crude.geojson`).then(r=>r.ok?r.json():null).then(g=>g&&setPipeCrudeGeo(g)).catch(()=>{});
    fetch(`${BASE}data/pipelines_hgl.geojson`).then(r=>r.ok?r.json():null).then(g=>g&&setPipeHglGeo(g)).catch(()=>{});
    fetch(`${BASE}data/ng_compressors.geojson`).then(r=>r.ok?r.json():null).then(g=>g&&setCompressorsGeo(g)).catch(()=>{});
    fetch(`${BASE}data/og_terminals.geojson`).then(r=>r.ok?r.json():null).then(g=>g&&setTerminalsGeo(g)).catch(()=>{});
    fetch(`${BASE}data/solar_uspvdb.geojson`).then(r=>r.ok?r.json():null).then(g=>g&&setSolarLargeGeo(g)).catch(()=>{});
    Promise.all([
      fetch(`${BASE}data/coal_mines.geojson`).then(r=>r.ok?r.json():null),
      fetch(`${BASE}data/coal_mines_pa.geojson`).then(r=>r.ok?r.json():null),
    ]).then(parts => {
      const feats = parts.flatMap(p => (p && p.features) || []);
      if (feats.length) setCoalMinesGeo({ type: 'FeatureCollection', features: feats });
    }).catch(()=>{});
    Promise.all(WELL_LINE_FILES.map((f) => fetch(`${BASE}data/${f}`).then((r) => (r.ok ? r.json() : null))))
      .then((parts) => {
        const feats = parts.flatMap((p) => (p && p.features) || []);
        if (feats.length) setWellsByStateGeo({ type: 'FeatureCollection', features: feats });
      })
      .catch(() => {});
    Promise.all(GAS_LINE_FILES.map((f) => fetch(`${BASE}data/${f}`).then((r) => (r.ok ? r.json() : null))))
      .then((parts) => {
        const feats = parts.flatMap((p) => (p && p.features) || []);
        if (feats.length) setGasByStateGeo({ type: 'FeatureCollection', features: feats });
      })
      .catch(() => {});
    // multi-part pipelines
    Promise.all([1,2,3,4].map(i => fetch(`${BASE}data/pipelines_natgas_p${i}.geojson`).then(r=>r.ok?r.json():null)))
      .then(parts => {
        const feats = parts.flatMap(p => (p && p.features) || []);
        if (feats.length) setPipeNgGeo({ type: 'FeatureCollection', features: feats });
      }).catch(()=>{});
    Promise.all([1,2,3].map(i => fetch(`${BASE}data/pipelines_subsea_og_p${i}.geojson`).then(r=>r.ok?r.json():null)))
      .then(parts => {
        const feats = parts.flatMap(p => (p && p.features) || []);
        if (feats.length) setPipeSubseaGeo({ type: 'FeatureCollection', features: feats });
      }).catch(()=>{});
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

  const reliabilityMetrics = useMemo(() => {
    const outCustomers = odinUtils.reduce((s, u) => s + u.totalOutages, 0);
    const utilReporting = odinUtils.length;
    const severeWx = nwsAlerts.filter((a) => a.severity === 'Extreme' || a.severity === 'Severe').length;
    const gen = totalGen || 0;
    const dem = latestDemand ? Number(latestDemand.value) : 0;
    const reserveProxy = gen > 0 && dem > 0 ? ((gen - dem) / gen) * 100 : null;
    const baCount = baDemand.length;
    const plantN = plantCount;
    // Composite reliability index 0-100 (higher = more stressed) from public proxies only
    let stress = gridStress.score;
    const availabilityProxy = outCustomers > 0
      ? Math.max(0, 100 - Math.min(40, outCustomers / 5000))
      : 98;
    return {
      outCustomers,
      utilReporting,
      severeWx,
      reserveProxy,
      baCount,
      plantN,
      stress,
      availabilityProxy,
      statusLabel: stress >= 70 ? 'Stressed' : stress >= 35 ? 'Watch' : 'Stable',
      statusColor: stress >= 70 ? '#ef4444' : stress >= 35 ? '#f59e0b' : '#22c55e',
    };
  }, [odinUtils, nwsAlerts, totalGen, latestDemand, baDemand.length, plantCount, gridStress.score]);


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
      'ev-tesla-circle',
      'ev-other-circle',
      'battery-circle', 'solar-uspvdb-circle',
      'ow-turbines-circle',
      'ow-ix-circle',
      'subsea-cables-hit',
      'hvdc-hit',
      'pipe-ng-hit', 'pipe-crude-hit', 'pipe-hgl-hit', 'gas-states-hit', 'pipe-subsea-hit',
      'og-platforms-circle', 'og-wells-circle', 'coal-mines-circle', 'wells-states-circle', 'ng-comp-circle', 'og-term-circle',
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
        f.layer?.id === 'lines-hit' ||
        f.layer?.id === 'ev-tesla-circle' ||
        f.layer?.id === 'ev-other-circle' ||
        f.layer?.id === 'battery-circle' ||
        f.layer?.id === 'solar-uspvdb-circle' ||
        f.layer?.id === 'ow-turbines-circle' ||
        f.layer?.id === 'ow-ix-circle' ||
        f.layer?.id === 'subsea-cables-hit' ||
        f.layer?.id === 'hvdc-hit' ||
        ['pipe-ng-hit','pipe-crude-hit','pipe-hgl-hit','gas-states-hit','pipe-subsea-hit','og-platforms-circle','og-wells-circle','ng-comp-circle','og-term-circle'].includes(f.layer?.id || '')
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
    if (feat.layer?.id === 'ev-tesla-circle' || feat.layer?.id === 'ev-other-circle') {
      const coords = feat.geometry.type === 'Point'
        ? (feat.geometry.coordinates as [number, number])
        : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'ev', ev: props });
      return;
    }
    if (feat.layer?.id === 'solar-uspvdb-circle') {
      const coords = feat.geometry.type === 'Point' ? (feat.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'battery', battery: {
        name: props.name || 'Solar facility',
        mw: props.mw_ac ?? props.mw_dc,
        fuel: [props.tech, props.type, props.axis].filter(Boolean).join(' · ') || 'solar PV',
        utility: '',
        city: props.county || '',
        county: props.county || '',
        state: props.state || '',
        source: props.source || 'USPVDB',
      }});
      return;
    }
    if (feat.layer?.id === 'battery-circle') {
      const coords = feat.geometry.type === 'Point'
        ? (feat.geometry.coordinates as [number, number])
        : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'battery', battery: props });
      return;
    }
    if (feat.layer?.id === 'ow-turbines-circle' || feat.layer?.id === 'ow-ix-circle') {
      const coords = feat.geometry.type === 'Point'
        ? (feat.geometry.coordinates as [number, number])
        : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'offshore', offshore: props });
      return;
    }
    if (feat.layer?.id === 'subsea-cables-hit' || feat.layer?.id === 'hvdc-hit') {
      setPlantPopup({ lon: e.lngLat.lng, lat: e.lngLat.lat, kind: 'cable', cable: props });
      return;
    }
    if (['pipe-ng-hit','pipe-crude-hit','pipe-hgl-hit','gas-states-hit','pipe-subsea-hit'].includes(feat.layer?.id || '')) {
      setPlantPopup({ lon: e.lngLat.lng, lat: e.lngLat.lat, kind: 'cable', cable: {
        name: props.Operator || props.operator || props.Opername || props.Pipename || props.name || 'Pipeline',
        link_type: props.commodity || props.TYPEPIPE || props.typepipe || props.dataset || 'pipeline',
        operator: props.Operator || props.operator || props.Opername || '',
        status: props.Status || props.status || '',
        notes: [props.Pipename, props.pipename, props.TYPEPIPE, props.layer_note, props.substance, props.state].filter(Boolean).join(' · '),
        source: props.source || props.dataset || 'EIA/OSM/BOEM',
        kv: props.Diameter || props.diameter || '',
      }});
      return;
    }
    if (feat.layer?.id === 'wells-states-circle') {
      const coords = feat.geometry.type === 'Point' ? (feat.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'cable', cable: {
        name: String(props.name || props.well_name || 'Oil/gas well'),
        link_type: String(props.unconventional === 'Y' ? 'Unconventional (frac)' : (props.type || 'Well')),
        operator: String(props.operator || ''),
        status: String(props.status || ''),
        notes: [props.county, props.config, props.permit].filter(Boolean).join(' · '),
        source: String(props.source || 'State public GIS'),
      }});
      return;
    }
    if (feat.layer?.id === 'coal-mines-circle') {
      const coords = feat.geometry.type === 'Point' ? (feat.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'cable', cable: {
        name: String(props.name || props.mine_name || props.site_name || 'Coal mine'),
        link_type: String(props.type || 'Coal mine'),
        operator: String(props.operator || props.company || ''),
        status: String(props.status || ''),
        notes: [props.state, props.county, props.msha_id].filter(Boolean).join(' · '),
        source: String(props.source || 'EIA/MSHA/PA DEP'),
      }});
      return;
    }
    if (feat.layer?.id === 'og-wells-circle') {
      const coords = feat.geometry.type === 'Point' ? (feat.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'cable', cable: {
        name: String(props.well_name || props.name || props.api_wellnumber || 'OCS well'),
        link_type: String(props.well_type_code || props.type || 'Well'),
        operator: String(props.operator_name || props.operator || ''),
        status: String(props.status || ''),
        notes: [props.lease_number, props.area_code, props.block_number, props.water_depth != null ? `depth ${props.water_depth}` : ''].filter(Boolean).join(' · '),
        source: String(props.source || 'BOEM/BSEE'),
      }});
      return;
    }
    if (feat.layer?.id === 'og-platforms-circle') {
      const coords = feat.geometry.type === 'Point' ? (feat.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'cable', cable: {
        name: String(props.name || props.STR_NAME || 'Platform'),
        link_type: 'Offshore platform',
        status: String(props.status || ''),
        notes: `Complex ${props.complex_id || '—'} · #${props.str_number || '—'}`,
        source: String(props.source || 'BOEM'),
      }});
      return;
    }
    if (feat.layer?.id === 'ng-comp-circle') {
      const coords = feat.geometry.type === 'Point' ? (feat.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'cable', cable: {
        name: String(props.name || 'Compressor station'),
        link_type: String(props.type || 'NG compressor'),
        operator: String(props.operator || ''),
        status: String(props.status || ''),
        notes: [props.city, props.state, props.county].filter(Boolean).join(', '),
        source: String(props.source || 'HIFLD'),
      }});
      return;
    }
    if (feat.layer?.id === 'og-term-circle') {
      const coords = feat.geometry.type === 'Point' ? (feat.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
      setPlantPopup({ lon: coords[0], lat: coords[1], kind: 'cable', cable: {
        name: String(props.name || 'Terminal'),
        link_type: String(props.type || 'Petroleum terminal'),
        operator: String(props.operator || ''),
        status: String(props.status || ''),
        notes: [props.city, props.state, props.product].filter(Boolean).join(', '),
        source: String(props.source || 'HIFLD'),
      }});
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
              <label className="layer-item">
                <input
                  type="checkbox"
                  checked={layers.tesla}
                  onChange={() => setLayers((p) => ({ ...p, tesla: !p.tesla }))}
                />
                <span className="layer-swatch" style={{ background: '#cc0000' }} />
                Tesla Superchargers
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {teslaGeojson ? teslaGeojson.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input
                  type="checkbox"
                  checked={layers.otherEv}
                  onChange={() => setLayers((p) => ({ ...p, otherEv: !p.otherEv }))}
                />
                <span className="layer-swatch" style={{ background: '#22c55e' }} />
                Other EV chargers
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {otherEvGeojson ? otherEvGeojson.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.battery} onChange={() => setLayers((p) => ({ ...p, battery: !p.battery }))} />
                <span className="layer-swatch" style={{ background: '#a3e635' }} />
                Battery storage (BESS)
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {batteryGeojson ? batteryGeojson.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.solarLarge} onChange={() => setLayers((p) => ({ ...p, solarLarge: !p.solarLarge }))} />
                <span className="layer-swatch" style={{ background: '#facc15' }} />
                Large-scale solar (≥1 MW)
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {solarLargeGeo ? solarLargeGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.offshoreWind} onChange={() => setLayers((p) => ({ ...p, offshoreWind: !p.offshoreWind }))} />
                <span className="layer-swatch" style={{ background: '#38bdf8' }} />
                Offshore wind turbines
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {offshoreTurbines ? offshoreTurbines.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.offshoreLeases} onChange={() => setLayers((p) => ({ ...p, offshoreLeases: !p.offshoreLeases }))} />
                <span className="layer-swatch" style={{ background: '#0ea5e9', opacity: 0.5 }} />
                BOEM wind lease areas
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {offshoreLeases ? offshoreLeases.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.subseaCables} onChange={() => setLayers((p) => ({ ...p, subseaCables: !p.subseaCables }))} />
                <span className="layer-swatch" style={{ background: '#c084fc' }} />
                Subsea export cables
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {subseaCables ? subseaCables.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.hvdc} onChange={() => setLayers((p) => ({ ...p, hvdc: !p.hvdc }))} />
                <span className="layer-swatch" style={{ background: '#f472b6' }} />
                HVDC / cross-border interties
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {hvdcGeojson ? hvdcGeojson.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <div className="legend-section" style={{ marginTop: 8, marginBottom: 4 }}>Oil & gas</div>
              <label className="layer-item">
                <input type="checkbox" checked={layers.ogPlatforms} onChange={() => setLayers((p) => ({ ...p, ogPlatforms: !p.ogPlatforms }))} />
                <span className="layer-swatch" style={{ background: '#f59e0b' }} />
                Offshore platforms (GOM)
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {ogPlatformsGeo ? ogPlatformsGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.coalMines} onChange={() => setLayers((p) => ({ ...p, coalMines: !p.coalMines }))} />
                <span className="layer-swatch" style={{ background: '#78716c' }} />
                Coal mines (EIA + PA)
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {coalMinesGeo ? coalMinesGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <div className="layer-group">
                <button type="button" className="layer-group-toggle" onClick={() => setWellMenuOpen((v) => !v)}>
                  <span className="layer-swatch" style={{ background: '#ef4444' }} />
                  Oil/gas wells by state
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    {wellsByStateGeo ? wellsByStateGeo.features.length.toLocaleString() : '…'} · {Object.values(wellStateOn).filter(Boolean).length} on
                  </span>
                  <span style={{ marginLeft: 6 }}>{wellMenuOpen ? '▾' : '▸'}</span>
                </button>
                {wellMenuOpen && (
                  <div className="layer-submenu">
                    <div className="layer-submenu-actions">
                      <button type="button" onClick={() => setWellStateOn(Object.fromEntries(WELL_LINE_STATES.map((s) => [s, true])))}>Enable all</button>
                      <button type="button" onClick={() => setWellStateOn(Object.fromEntries(WELL_LINE_STATES.map((s) => [s, false])))}>Disable all</button>
                    </div>
                    <div className="layer-submenu-grid">
                      {WELL_LINE_STATES.map((st) => (
                        <label key={st} className="layer-item compact">
                          <input
                            type="checkbox"
                            checked={!!wellStateOn[st]}
                            onChange={() => setWellStateOn((p) => ({ ...p, [st]: !p[st] }))}
                          />
                          {st}
                        </label>
                      ))}
                    </div>
                    <p className="disclaimer-tiny">Public state samples + PA DEP. Not full ~5M national inventory. USGS ScienceBase is cell-aggregated only. FracFocus = chemical disclosures. Use wells.fractracker.org for full interactive national search.</p>
                  </div>
                )}
              </div>

              <label className="layer-item">
                <input type="checkbox" checked={layers.ogWells} onChange={() => setLayers((p) => ({ ...p, ogWells: !p.ogWells }))} />
                <span className="layer-swatch" style={{ background: '#ca8a04' }} />
                OCS oil/gas wells (BSEE)
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {ogWellsGeo ? ogWellsGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.pipeSubsea} onChange={() => setLayers((p) => ({ ...p, pipeSubsea: !p.pipeSubsea }))} />
                <span className="layer-swatch" style={{ background: '#b45309' }} />
                Subsea O&G pipelines
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {pipeSubseaGeo ? pipeSubseaGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.pipeNg} onChange={() => setLayers((p) => ({ ...p, pipeNg: !p.pipeNg }))} />
                <span className="layer-swatch" style={{ background: '#ea580c' }} />
                Natural gas pipelines
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {pipeNgGeo ? pipeNgGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.pipeCrude} onChange={() => setLayers((p) => ({ ...p, pipeCrude: !p.pipeCrude }))} />
                <span className="layer-swatch" style={{ background: '#78716c' }} />
                Crude oil pipelines
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {pipeCrudeGeo ? pipeCrudeGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.pipeHgl} onChange={() => setLayers((p) => ({ ...p, pipeHgl: !p.pipeHgl }))} />
                <span className="layer-swatch" style={{ background: '#a8a29e' }} />
                HGL pipelines
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {pipeHglGeo ? pipeHglGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <div className="layer-group">
                <button type="button" className="layer-group-toggle" onClick={() => setGasMenuOpen((v) => !v)}>
                  <span className="layer-swatch" style={{ background: '#fdba74' }} />
                  Gas lines by state
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    {gasByStateGeo ? gasByStateGeo.features.length.toLocaleString() : '…'} · {Object.values(gasStateOn).filter(Boolean).length} on
                  </span>
                  <span style={{ marginLeft: 6 }}>{gasMenuOpen ? '▾' : '▸'}</span>
                </button>
                {gasMenuOpen && (
                  <div className="layer-submenu">
                    <div className="layer-submenu-actions">
                      <button type="button" onClick={() => setGasStateOn(Object.fromEntries(GAS_LINE_STATES.map((s) => [s, true])))}>Enable all</button>
                      <button type="button" onClick={() => setGasStateOn(Object.fromEntries(GAS_LINE_STATES.map((s) => [s, false])))}>Disable all</button>
                    </div>
                    <div className="layer-submenu-grid">
                      {GAS_LINE_STATES.map((st) => (
                        <label key={st} className="layer-item compact">
                          <input
                            type="checkbox"
                            checked={!!gasStateOn[st]}
                            onChange={() => setGasStateOn((p) => ({ ...p, [st]: !p[st] }))}
                          />
                          {st}
                        </label>
                      ))}
                    </div>
                    <p className="disclaimer-tiny">EIA transmission pipelines by state (not local distribution mains).</p>
                  </div>
                )}
              </div>
              <label className="layer-item">
                <input type="checkbox" checked={layers.compressors} onChange={() => setLayers((p) => ({ ...p, compressors: !p.compressors }))} />
                <span className="layer-swatch" style={{ background: '#fb923c' }} />
                NG compressor stations
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {compressorsGeo ? compressorsGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
              <label className="layer-item">
                <input type="checkbox" checked={layers.terminals} onChange={() => setLayers((p) => ({ ...p, terminals: !p.terminals }))} />
                <span className="layer-swatch" style={{ background: '#d6d3d1' }} />
                Oil/gas terminals
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {terminalsGeo ? terminalsGeo.features.length.toLocaleString() : '…'}
                </span>
              </label>
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
                <button
                  type="button"
                  className="odin-row meta-row-btn"
                  key={b.code}
                  title="Click for BA demand details"
                  onClick={() =>
                    openDetail(
                      {
                        title: b.code,
                        subtitle: b.name,
                        iconKind: 'power',
                        meta: [
                          { category: 'Operations', label: 'Demand', value: formatMWh(b.value) },
                          { category: 'Operations', label: 'Period', value: b.period },
                          { category: 'Identity', label: 'BA code', value: b.code },
                          { category: 'Identity', label: 'BA name', value: b.name },
                          { category: 'Source', label: 'Series', value: 'Hourly demand (EIA-930)' },
                          { category: 'Source', label: 'Publisher', value: 'EIA RTO region-data' },
                        ],
                        historyLabel: 'Hourly demand (last ~48 hours)',
                        source: 'EIA API v2',
                        notes: 'Balancing authority demand. Approximate US48 coverage by BA footprint.',
                      },
                      `ba:${b.code}`
                    )
                  }
                >
                  <span className="odin-name" title={b.name}>{b.code} · {b.name.replace(/, LLC|, Inc\.?.*$/i, '')}</span>
                  <span className="odin-count" style={{ color: '#38bdf8' }}>{formatMWh(b.value)}</span>
                </button>
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
                <button
                  type="button"
                  className="hazard-item meta-row-btn"
                  key={q.id}
                  onClick={() => {
                    mapRef.current?.flyTo({ center: [q.lon, q.lat], zoom: 6, duration: 1200 });
                    openDetail({
                      title: `M${q.mag.toFixed(1)} earthquake`,
                      subtitle: q.place,
                      meta: [
                        { category: 'Event', label: 'Magnitude', value: q.mag.toFixed(1) },
                        { category: 'Event', label: 'Depth', value: `${q.depth.toFixed(1)} km` },
                        { category: 'Event', label: 'Time', value: q.time ? new Date(q.time).toLocaleString() : '—' },
                        { category: 'Location', label: 'Place', value: q.place },
                        { category: 'Location', label: 'Latitude', value: q.lat.toFixed(4) },
                        { category: 'Location', label: 'Longitude', value: q.lon.toFixed(4) },
                        { category: 'Source', label: 'Event id', value: q.id },
                        { category: 'Source', label: 'Publisher', value: 'USGS M4.5+ 24h feed' },
                      ],
                      source: 'https://earthquake.usgs.gov',
                      notes: 'Shown for situational awareness near infrastructure. Not a grid sensor.',
                    });
                  }}
                >
                  <span className="hazard-sev" style={{ background: q.mag >= 6 ? '#ef4444' : q.mag >= 5 ? '#f97316' : '#eab308' }} />
                  <div>
                    <div className="hazard-event">M{q.mag.toFixed(1)} · {q.place}</div>
                    <div className="hazard-area">{q.time ? new Date(q.time).toLocaleString() : ''}</div>
                  </div>
                </button>
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
                <button
                  type="button"
                  className="hazard-item meta-row-btn"
                  key={a.id}
                  onClick={() =>
                    openDetail({
                      title: a.event,
                      subtitle: a.headline || a.area,
                      meta: [
                        { category: 'Hazard', label: 'Severity', value: a.severity },
                        { category: 'Hazard', label: 'Urgency', value: a.urgency || '—' },
                        { category: 'Hazard', label: 'Event', value: a.event },
                        { category: 'Geography', label: 'Area', value: a.area || '—' },
                        { category: 'Timing', label: 'Onset', value: a.onset ? new Date(a.onset).toLocaleString() : '—' },
                        { category: 'Timing', label: 'Ends', value: a.ends ? new Date(a.ends).toLocaleString() : '—' },
                        { category: 'Source', label: 'Alert id', value: a.id },
                        { category: 'Source', label: 'Publisher', value: 'NOAA / NWS' },
                      ],
                      source: 'National Weather Service',
                      notes: 'Grid-relevant filter applied. Official forecasts remain with NWS products.',
                    })
                  }
                >
                  <span className="hazard-sev" style={{ background: severityColor(a.severity) }} />
                  <div>
                    <div className="hazard-event">{a.event}</div>
                    <div className="hazard-area">{a.area || a.headline}</div>
                  </div>
                </button>
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
                <button
                  type="button"
                  className="odin-row meta-row-btn"
                  key={u.name + String(u.totalOutages)}
                  onClick={() =>
                    openDetail({
                      title: u.name,
                      subtitle: 'ODIN utility outage snapshot',
                      meta: [
                        { category: 'Outage', label: 'Customers out', value: u.totalOutages.toLocaleString() },
                        { category: 'Outage', label: 'Resolution', value: u.dataResolution || '—' },
                        { category: 'Outage', label: 'Received', value: u.receivedDate || '—' },
                        { category: 'Identity', label: 'Utility', value: u.name },
                        { category: 'Identity', label: 'EIA utility id', value: u.eiaId || '—' },
                        { category: 'Source', label: 'Publisher', value: 'ORNL ODIN' },
                      ],
                      source: 'https://odin.ornl.gov',
                      notes: 'Not full national coverage. Participating utilities only. Not a substitute for utility OMS maps.',
                    })
                  }
                >
                  <span className="odin-name" title={u.name}>{u.name}</span>
                  <span className="odin-count">{u.totalOutages.toLocaleString()}</span>
                </button>
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
              <div className="legend-item"><span className="legend-swatch" style={{ background: '#e11d48' }} />Tesla SC</div>
              <div className="legend-item"><span className="legend-swatch" style={{ background: '#22c55e' }} />Other EV</div>
              <div className="legend-item"><span className="legend-swatch" style={{ background: '#a3e635' }} />Battery BESS</div>
              <div className="legend-item"><span className="legend-swatch" style={{ background: '#facc15' }} />Large solar</div>
              <div className="legend-item"><span className="legend-swatch" style={{ background: '#38bdf8' }} />Offshore wind</div>
              <div className="legend-item"><span className="legend-line" style={{ background: '#c084fc' }} />Subsea cable</div>
              <div className="legend-item"><span className="legend-line" style={{ background: '#f472b6' }} />HVDC intertie</div>
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
            interactiveLayerIds={[...PLANT_REGIONS.map((r) => `plants-circle-${r.id}`), ...SUB_REGIONS.map((r) => `subs-circle-${r.id}`), 'lines-hit', 'ev-tesla-circle', 'ev-other-circle', 'battery-circle', 'solar-uspvdb-circle', 'ow-turbines-circle', 'ow-ix-circle', 'subsea-cables-hit', 'hvdc-hit', 'pipe-ng-hit', 'pipe-crude-hit', 'pipe-hgl-hit', 'gas-states-hit', 'pipe-subsea-hit', 'og-platforms-circle', 'og-wells-circle', 'coal-mines-circle', 'wells-states-circle', 'ng-comp-circle', 'og-term-circle']}
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

            {layers.tesla && teslaGeojson && (
              <Source id="ev-tesla" type="geojson" data={teslaGeojson}>
                <Layer
                  id="ev-tesla-circle"
                  type="circle"
                  minzoom={3}
                  paint={{
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 8, 5, 12, 8],
                    'circle-color': '#e11d48',
                    'circle-opacity': 0.85,
                    'circle-stroke-width': 0.5,
                    'circle-stroke-color': '#fff',
                  }}
                />
              </Source>
            )}
            {layers.otherEv && otherEvGeojson && (
              <Source id="ev-other" type="geojson" data={otherEvGeojson}>
                <Layer
                  id="ev-other-circle"
                  type="circle"
                  minzoom={5}
                  paint={{
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 9, 4, 12, 7],
                    'circle-color': '#22c55e',
                    'circle-opacity': 0.75,
                    'circle-stroke-width': 0.4,
                    'circle-stroke-color': '#0a0e14',
                  }}
                />
              </Source>
            )}
            {layers.battery && batteryGeojson && (
              <Source id="battery-src" type="geojson" data={batteryGeojson}>
                <Layer id="battery-circle" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 7, 12, 10],
                  'circle-color': '#a3e635',
                  'circle-opacity': 0.85,
                  'circle-stroke-width': 1,
                  'circle-stroke-color': '#365314',
                }} />
              </Source>
            )}
            {layers.solarLarge && solarLargeGeo && (
              <Source id="solar-uspvdb-src" type="geojson" data={solarLargeGeo}>
                <Layer id="solar-uspvdb-circle" type="circle" paint={{
                  'circle-radius': [
                    'interpolate', ['linear'], ['coalesce', ['get', 'mw_ac'], 5],
                    1, 3, 50, 6, 200, 10, 500, 14
                  ],
                  'circle-color': '#facc15',
                  'circle-opacity': 0.8,
                  'circle-stroke-width': 0.6,
                  'circle-stroke-color': '#854d0e',
                }} />
              </Source>
            )}
            {layers.offshoreLeases && offshoreLeases && (
              <Source id="ow-leases" type="geojson" data={offshoreLeases}>
                <Layer id="ow-leases-fill" type="fill" paint={{ 'fill-color': '#0ea5e9', 'fill-opacity': 0.12 }} />
                <Layer id="ow-leases-line" type="line" paint={{ 'line-color': '#0284c7', 'line-width': 1.2, 'line-opacity': 0.7 }} />
              </Source>
            )}
            {layers.subseaCables && subseaCables && (
              <Source id="subsea-cables" type="geojson" data={subseaCables}>
                <Layer id="subsea-cables-line" type="line" paint={{
                  'line-color': '#c084fc',
                  'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.5, 8, 3, 12, 5],
                  'line-opacity': 0.85,
                }} />
                <Layer id="subsea-cables-hit" type="line" paint={{ 'line-color': '#c084fc', 'line-width': 12, 'line-opacity': 0 }} />
              </Source>
            )}
            {layers.hvdc && hvdcGeojson && (
              <Source id="hvdc-src" type="geojson" data={hvdcGeojson}>
                <Layer id="hvdc-line" type="line" paint={{
                  'line-color': '#f472b6',
                  'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.5, 8, 4, 12, 6],
                  'line-opacity': 0.9,
                  'line-dasharray': [2, 1],
                }} />
                <Layer id="hvdc-hit" type="line" paint={{ 'line-color': '#f472b6', 'line-width': 14, 'line-opacity': 0 }} />
              </Source>
            )}
            {layers.pipeNg && pipeNgGeo && (
              <Source id="pipe-ng" type="geojson" data={pipeNgGeo}>
                <Layer id="pipe-ng-line" type="line" minzoom={4} paint={{ 'line-color': '#ea580c', 'line-width': 1.2, 'line-opacity': 0.55 }} />
                <Layer id="pipe-ng-hit" type="line" minzoom={4} paint={{ 'line-color': '#ea580c', 'line-width': 8, 'line-opacity': 0 }} />
              </Source>
            )}
            {layers.pipeCrude && pipeCrudeGeo && (
              <Source id="pipe-crude" type="geojson" data={pipeCrudeGeo}>
                <Layer id="pipe-crude-line" type="line" paint={{ 'line-color': '#78716c', 'line-width': 2, 'line-opacity': 0.75 }} />
                <Layer id="pipe-crude-hit" type="line" paint={{ 'line-color': '#78716c', 'line-width': 10, 'line-opacity': 0 }} />
              </Source>
            )}
            {layers.pipeHgl && pipeHglGeo && (
              <Source id="pipe-hgl" type="geojson" data={pipeHglGeo}>
                <Layer id="pipe-hgl-line" type="line" paint={{ 'line-color': '#a8a29e', 'line-width': 1.5, 'line-opacity': 0.7 }} />
                <Layer id="pipe-hgl-hit" type="line" paint={{ 'line-color': '#a8a29e', 'line-width': 8, 'line-opacity': 0 }} />
              </Source>
            )}
            {gasByStateGeo && Object.values(gasStateOn).some(Boolean) && (
              <Source id="gas-states-src" type="geojson" data={gasByStateGeo}>
                <Layer
                  id="gas-states-line"
                  type="line"
                  filter={['in', ['get', 'state'], ['literal', GAS_LINE_STATES.filter((s) => gasStateOn[s])]]}
                  paint={{
                    'line-color': '#fdba74',
                    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.0, 9, 2.2, 12, 3.5],
                    'line-opacity': 0.8,
                  }}
                />
                <Layer
                  id="gas-states-hit"
                  type="line"
                  filter={['in', ['get', 'state'], ['literal', GAS_LINE_STATES.filter((s) => gasStateOn[s])]]}
                  paint={{ 'line-color': '#fdba74', 'line-width': 10, 'line-opacity': 0 }}
                />
              </Source>
            )}
            {layers.pipeSubsea && pipeSubseaGeo && (
              <Source id="pipe-subsea" type="geojson" data={pipeSubseaGeo}>
                <Layer id="pipe-subsea-line" type="line" minzoom={5} paint={{ 'line-color': '#b45309', 'line-width': 1.2, 'line-opacity': 0.65 }} />
                <Layer id="pipe-subsea-hit" type="line" minzoom={5} paint={{ 'line-color': '#b45309', 'line-width': 8, 'line-opacity': 0 }} />
              </Source>
            )}
            {layers.ogPlatforms && ogPlatformsGeo && (
              <Source id="og-platforms-src" type="geojson" data={ogPlatformsGeo}>
                <Layer id="og-platforms-circle" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 8, 4, 12, 6],
                  'circle-color': '#f59e0b', 'circle-opacity': 0.8, 'circle-stroke-width': 0.4, 'circle-stroke-color': '#fff',
                }} />
              </Source>
            )}
            {layers.coalMines && coalMinesGeo && (
              <Source id="coal-mines-src" type="geojson" data={coalMinesGeo}>
                <Layer id="coal-mines-circle" type="circle" minzoom={4} paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 8, 5, 12, 8],
                  'circle-color': '#78716c', 'circle-opacity': 0.85, 'circle-stroke-width': 0.5, 'circle-stroke-color': '#1c1917',
                }} />
              </Source>
            )}
            {wellsByStateGeo && Object.values(wellStateOn).some(Boolean) && (
              <Source id="wells-states-src" type="geojson" data={wellsByStateGeo}>
                <Layer
                  id="wells-states-circle"
                  type="circle"
                  minzoom={5}
                  filter={['in', ['get', 'state'], ['literal', WELL_LINE_STATES.filter((s) => wellStateOn[s])]]}
                  paint={{
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 9, 3, 12, 5],
                    'circle-color': [
                      'case',
                      ['==', ['get', 'unconventional'], 'Y'], '#dc2626',
                      '#60a5fa'
                    ],
                    'circle-opacity': 0.75,
                    'circle-stroke-width': 0.3,
                    'circle-stroke-color': '#1e3a5f',
                  }}
                />
              </Source>
            )}
            {layers.ogWells && ogWellsGeo && (
              <Source id="og-wells-src" type="geojson" data={ogWellsGeo}>
                <Layer id="og-wells-circle" type="circle" minzoom={6} paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 10, 3, 13, 5],
                  'circle-color': '#ca8a04', 'circle-opacity': 0.7, 'circle-stroke-width': 0.3, 'circle-stroke-color': '#713f12',
                }} />
              </Source>
            )}
            {layers.compressors && compressorsGeo && (
              <Source id="ng-comp-src" type="geojson" data={compressorsGeo}>
                <Layer id="ng-comp-circle" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 6, 12, 9],
                  'circle-color': '#fb923c', 'circle-opacity': 0.85, 'circle-stroke-width': 1, 'circle-stroke-color': '#9a3412',
                }} />
              </Source>
            )}
            {layers.terminals && terminalsGeo && (
              <Source id="og-term-src" type="geojson" data={terminalsGeo}>
                <Layer id="og-term-circle" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 6, 12, 9],
                  'circle-color': '#d6d3d1', 'circle-opacity': 0.9, 'circle-stroke-width': 1, 'circle-stroke-color': '#44403c',
                }} />
              </Source>
            )}
            {layers.offshoreWind && offshoreTurbines && (
              <Source id="ow-turbines" type="geojson" data={offshoreTurbines}>
                <Layer id="ow-turbines-circle" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 7, 4, 11, 7],
                  'circle-color': '#38bdf8',
                  'circle-opacity': 0.85,
                  'circle-stroke-width': 0.5,
                  'circle-stroke-color': '#fff',
                }} />
              </Source>
            )}
            {layers.offshoreWind && offshoreIx && (
              <Source id="ow-ix" type="geojson" data={offshoreIx}>
                <Layer id="ow-ix-circle" type="circle" paint={{
                  'circle-radius': 6,
                  'circle-color': '#f472b6',
                  'circle-stroke-width': 1,
                  'circle-stroke-color': '#fff',
                }} />
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
                ) : plantPopup.kind === 'ev' && plantPopup.ev ? (
                  <div className="plant-popup">
                    <div className="plant-popup-title">{String(plantPopup.ev.name || 'EV station')}</div>
                    <div className="plant-popup-row"><span>Network</span><strong>{String(plantPopup.ev.network || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Status</span><strong>{String(plantPopup.ev.status || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Stalls / spots</span><strong>{plantPopup.ev.stalls != null ? String(plantPopup.ev.stalls) : '—'}</strong></div>
                    <div className="plant-popup-row"><span>kW / stall</span><strong>{plantPopup.ev.kw_per_stall != null ? `${plantPopup.ev.kw_per_stall} kW` : '—'}</strong></div>
                    <div className="plant-popup-row"><span>Site MW capacity</span><strong>{plantPopup.ev.mw_capacity != null ? `${plantPopup.ev.mw_capacity} MW` : '—'}</strong></div>
                    <div className="plant-popup-row"><span>Live load</span><strong>Not public</strong></div>
                    <div className="plant-popup-row"><span>Access</span><strong>{String(plantPopup.ev.access || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Operator</span><strong>{String(plantPopup.ev.operator || plantPopup.ev.brand || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Location</span><strong>{[plantPopup.ev.address, plantPopup.ev.city, plantPopup.ev.state].filter(Boolean).join(', ') || '—'}</strong></div>
                    <div className="plant-popup-row"><span>Source</span><strong>{String(plantPopup.ev.source || 'OSM')}</strong></div>
                  </div>
                ) : plantPopup.kind === 'battery' && plantPopup.battery ? (
                  <div className="plant-popup">
                    <div className="plant-popup-title">{String(plantPopup.battery.name || 'Battery storage')}</div>
                    <div className="plant-popup-row"><span>Capacity</span><strong>{plantPopup.battery.mw != null ? `${plantPopup.battery.mw} MW` : '—'}</strong></div>
                    <div className="plant-popup-row"><span>Type</span><strong>{String(plantPopup.battery.fuel || 'batteries')}</strong></div>
                    <div className="plant-popup-row"><span>Utility</span><strong>{String(plantPopup.battery.utility || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Location</span><strong>{[plantPopup.battery.city, plantPopup.battery.county, plantPopup.battery.state].filter(Boolean).join(', ') || '—'}</strong></div>
                    <div className="plant-popup-row"><span>Source</span><strong>{String(plantPopup.battery.source || 'EIA/HIFLD')}</strong></div>
                  </div>
                ) : plantPopup.kind === 'offshore' && plantPopup.offshore ? (
                  <div className="plant-popup">
                    <div className="plant-popup-title">{String(plantPopup.offshore.name || plantPopup.offshore.project || 'Offshore facility')}</div>
                    <div className="plant-popup-row"><span>Project</span><strong>{String(plantPopup.offshore.project || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Developer</span><strong>{String(plantPopup.offshore.developer || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Lease</span><strong>{String(plantPopup.offshore.lease || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Max MW</span><strong>{plantPopup.offshore.max_mw != null ? String(plantPopup.offshore.max_mw) : (plantPopup.offshore.mw != null ? String(plantPopup.offshore.mw) : '—')}</strong></div>
                    <div className="plant-popup-row"><span>Status</span><strong>{String(plantPopup.offshore.status || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Depth (m)</span><strong>{plantPopup.offshore.depth_m != null ? String(plantPopup.offshore.depth_m) : '—'}</strong></div>
                    <div className="plant-popup-row"><span>Source</span><strong>{String(plantPopup.offshore.source || 'BOEM')}</strong></div>
                  </div>
                ) : plantPopup.kind === 'cable' && plantPopup.cable ? (
                  <div className="plant-popup">
                    <div className="plant-popup-title">{String(plantPopup.cable.name || 'Cable / intertie')}</div>
                    <div className="plant-popup-row"><span>Type</span><strong>{String(plantPopup.cable.link_type || plantPopup.cable.cable_type || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Project</span><strong>{String(plantPopup.cable.project || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Operator</span><strong>{String(plantPopup.cable.operator || plantPopup.cable.developer || '—')}</strong></div>
                    <div className="plant-popup-row"><span>From</span><strong>{String(plantPopup.cable.from_end || '—')}</strong></div>
                    <div className="plant-popup-row"><span>To</span><strong>{String(plantPopup.cable.to_end || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Capacity</span><strong>{plantPopup.cable.mw != null ? `${plantPopup.cable.mw} MW` : '—'}</strong></div>
                    <div className="plant-popup-row"><span>kV</span><strong>{plantPopup.cable.kv != null ? String(plantPopup.cable.kv) : '—'}</strong></div>
                    <div className="plant-popup-row"><span>Current</span><strong>{String(plantPopup.cable.current || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Burial (m)</span><strong>{String(plantPopup.cable.burial_m || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Status</span><strong>{String(plantPopup.cable.status || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Notes</span><strong>{String(plantPopup.cable.notes || '—')}</strong></div>
                    <div className="plant-popup-row"><span>Source</span><strong>{String(plantPopup.cable.source || 'Public')}</strong></div>
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
          style={{ right: rightOpen ? 208 : 8 }}
          onClick={() => setRightOpen((v) => !v)}
        >
          {rightOpen ? 'Hide prices ›' : '‹ Prices & risk'}
        </button>

        <aside className={`sidebar-right${rightOpen ? '' : ' collapsed'}`}>
          <div className="sidebar-section">
            <h3>Energy prices (EIA)</h3>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              Futures ~live (Yahoo/NYMEX) · EIA retail monthly · refresh 5 min
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
              <button
                type="button"
                className="price-row price-row-btn"
                key={r.id}
                title={`${r.fullName || r.name} · ${r.period} — click for details`}
                onClick={() => openPriceDetail(r)}
              >
                <span className="price-name">
                  <span className="price-icon" aria-hidden>
                    <PriceIcon kind={r.kind} />
                  </span>
                  {r.name}
                </span>
                <span className="price-val">{r.value}<span className="price-unit">{r.unit}</span></span>
              </button>
            ))}
            <p className="disclaimer-tiny">
              Public EIA series only. Not ISO real-time LMP. Fuel-specific wholesale power prices by source are not published as a single live national feed.
            </p>
          </div>
          <div className="sidebar-section">
            <h3>Grid reliability (proxy)</h3>
            <div className="stress-level" style={{ color: reliabilityMetrics.statusColor }}>
              {reliabilityMetrics.statusLabel}
            </div>
            <div className="metric-grid">
              <div className="metric-card">
                <div className="m-label">Stress index</div>
                <div className="m-val" style={{ color: reliabilityMetrics.statusColor }}>
                  {reliabilityMetrics.stress}/100
                </div>
              </div>
              <div className="metric-card">
                <div className="m-label">Avail. proxy</div>
                <div className="m-val">{reliabilityMetrics.availabilityProxy.toFixed(0)}%</div>
              </div>
              <div className="metric-card">
                <div className="m-label">Gen−demand</div>
                <div className="m-val">
                  {reliabilityMetrics.reserveProxy != null
                    ? `${reliabilityMetrics.reserveProxy.toFixed(1)}%`
                    : '—'}
                </div>
              </div>
              <div className="metric-card">
                <div className="m-label">ODIN out</div>
                <div className="m-val">{reliabilityMetrics.outCustomers.toLocaleString()}</div>
              </div>
              <div className="metric-card">
                <div className="m-label">Utils reporting</div>
                <div className="m-val">{reliabilityMetrics.utilReporting}</div>
              </div>
              <div className="metric-card">
                <div className="m-label">Severe NWS</div>
                <div className="m-val">{reliabilityMetrics.severeWx}</div>
              </div>
              <div className="metric-card">
                <div className="m-label">BAs tracked</div>
                <div className="m-val">{reliabilityMetrics.baCount}</div>
              </div>
              <div className="metric-card">
                <div className="m-label">Plants loaded</div>
                <div className="m-val">{reliabilityMetrics.plantN.toLocaleString()}</div>
              </div>
            </div>
            <p className="disclaimer-tiny">
              Composite from public EIA demand/gen, ODIN outage counts, and NWS alerts—not NERC formal reliability metrics or SCADA SAIFI/SAIDI.
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


      {detail && (
        <div className="detail-backdrop" onClick={() => setDetail(null)} role="presentation">
          <div
            className="detail-panel"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-header">
              <div className="detail-title-row">
                {detail.iconKind && (
                  <span className="price-icon detail-icon">
                    <PriceIcon kind={detail.iconKind} />
                  </span>
                )}
                <div>
                  <div className="detail-title">{detail.title}</div>
                  {detail.subtitle && <div className="detail-sub">{detail.subtitle}</div>}
                </div>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
            <div className="detail-body">
              <h4>Metadata</h4>
              {(() => {
                const groups: Record<string, DetailMeta[]> = {};
                for (const m of detail.meta) {
                  const cat = m.category || 'General';
                  (groups[cat] ||= []).push(m);
                }
                if (detail.source) {
                  (groups['Source'] ||= []).push({ label: 'Feed', value: detail.source, category: 'Source' });
                }
                return Object.entries(groups).map(([cat, rows]) => (
                  <div key={cat}>
                    <div className="detail-cat">{cat}</div>
                    {rows.map((m) => (
                      <div className="detail-meta-row" key={cat + m.label}>
                        <span>{m.label}</span>
                        <strong>{m.value}</strong>
                      </div>
                    ))}
                  </div>
                ));
              })()}
              {detail.notes && <p className="disclaimer-tiny">{detail.notes}</p>}
              <h4>
                History {detailLoading ? '· loading…' : detail.historyLabel ? `· ${detail.historyLabel}` : ''}
              </h4>
              {!detailLoading && (!detail.history || detail.history.length === 0) && (
                <p className="disclaimer-tiny">No time series loaded for this item (or not applicable).</p>
              )}
              {detail.history && detail.history.length > 0 && (
                <div className="detail-history">
                  {detail.history.slice(0, 60).map((h) => (
                    <div className="detail-hist-row" key={h.period + String(h.value)}>
                      <span>{h.period}</span>
                      <strong>{h.value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
