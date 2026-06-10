interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * USGS Earthquake Catalog MCP (FDSNWS event API).
 *
 * Keyless real-time + historical seismic data from the United States Geological
 * Survey. Search/count global earthquakes by time window, magnitude, depth, and
 * geographic radius, or fetch full detail for a single event by its USGS id.
 * Backed by the authoritative ANSS Comprehensive Catalog (ComCat).
 */


const BASE = 'https://earthquake.usgs.gov/fdsnws/event/1';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

interface QuakeFeature {
  id?: string;
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: number[] };
}

const tools: McpToolExport['tools'] = [
  {
    name: 'search_earthquakes',
    description:
      'Search the USGS earthquake catalog (FDSNWS event API) for real-time and historical seismic events. Filter by time window, magnitude, depth, and a circular geographic area. Returns a compact list of quakes with magnitude, location, time, coordinates, depth, and significance. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        start_time: { type: 'string', description: 'ISO date/time lower bound, e.g. "2026-06-01" or "2026-06-01T00:00:00". Defaults to 30 days ago.' },
        end_time: { type: 'string', description: 'ISO date/time upper bound, e.g. "2026-06-09". Defaults to now.' },
        min_magnitude: { type: 'number', description: 'Minimum magnitude (e.g. 5 for M5+).' },
        max_magnitude: { type: 'number', description: 'Maximum magnitude.' },
        latitude: { type: 'number', description: 'Center latitude for a circular search (use with longitude + max_radius_km).' },
        longitude: { type: 'number', description: 'Center longitude for a circular search (use with latitude + max_radius_km).' },
        max_radius_km: { type: 'number', description: 'Search radius in km around latitude/longitude.' },
        min_depth_km: { type: 'number', description: 'Minimum hypocenter depth in km.' },
        max_depth_km: { type: 'number', description: 'Maximum hypocenter depth in km.' },
        limit: { type: 'number', description: 'Max events to return (default 20, max 100).' },
        order_by: {
          type: 'string',
          description: 'Sort order: "time" (newest first, default), "magnitude" (largest first), "time-asc", or "magnitude-asc".',
        },
      },
    },
  },
  {
    name: 'get_earthquake',
    description:
      'Get full detail for a single earthquake by its USGS event id (e.g. "us7000n7n8"). Returns magnitude, location, time, depth, felt reports, tsunami flag, PAGER alert level, status, contributing networks, and detail URLs. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'USGS event id, e.g. "us7000n7n8".' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'count_earthquakes',
    description:
      'Count earthquakes matching a filter without returning the events — fast for questions like "how many M5+ quakes in the last month near X". Same filters as search_earthquakes (time, magnitude, circular area). Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        start_time: { type: 'string', description: 'ISO date/time lower bound. Defaults to 30 days ago.' },
        end_time: { type: 'string', description: 'ISO date/time upper bound. Defaults to now.' },
        min_magnitude: { type: 'number', description: 'Minimum magnitude (e.g. 5 for M5+).' },
        max_magnitude: { type: 'number', description: 'Maximum magnitude.' },
        latitude: { type: 'number', description: 'Center latitude for a circular search.' },
        longitude: { type: 'number', description: 'Center longitude for a circular search.' },
        max_radius_km: { type: 'number', description: 'Search radius in km around latitude/longitude.' },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'search_earthquakes':
        return searchEarthquakes(args);
      case 'get_earthquake':
        return getEarthquake(args);
      case 'count_earthquakes':
        return countEarthquakes(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function isoFromMs(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : null;
}

/** Map the common filter args (shared by search + count) to FDSNWS query params. */
function buildQuery(args: Record<string, unknown>): URLSearchParams {
  const qs = new URLSearchParams({ format: 'geojson' });

  if (typeof args.start_time === 'string' && args.start_time.trim()) qs.set('starttime', args.start_time.trim());
  if (typeof args.end_time === 'string' && args.end_time.trim()) qs.set('endtime', args.end_time.trim());

  const minMag = num(args.min_magnitude);
  if (minMag !== undefined) qs.set('minmagnitude', String(minMag));
  const maxMag = num(args.max_magnitude);
  if (maxMag !== undefined) qs.set('maxmagnitude', String(maxMag));

  const lat = num(args.latitude);
  const lon = num(args.longitude);
  const radius = num(args.max_radius_km);
  if (lat !== undefined) qs.set('latitude', String(lat));
  if (lon !== undefined) qs.set('longitude', String(lon));
  if (radius !== undefined) qs.set('maxradiuskm', String(radius));

  const minDepth = num(args.min_depth_km);
  if (minDepth !== undefined) qs.set('mindepth', String(minDepth));
  const maxDepth = num(args.max_depth_km);
  if (maxDepth !== undefined) qs.set('maxdepth', String(maxDepth));

  return qs;
}

/** Build the compact earthquake shape from a GeoJSON Feature. */
function mapQuake(f: QuakeFeature): Record<string, unknown> {
  const p = f.properties ?? {};
  const c = f.geometry?.coordinates ?? [];
  return {
    id: f.id,
    magnitude: p.mag,
    magType: p.magType,
    place: p.place,
    time: isoFromMs(p.time),
    longitude: c[0],
    latitude: c[1],
    depth_km: c[2],
    felt_reports: p.felt,
    tsunami_flag: p.tsunami === 1,
    significance: p.sig,
    url: p.url,
    type: p.type,
  };
}

async function searchEarthquakes(args: Record<string, unknown>): Promise<unknown> {
  let limit = num(args.limit) ?? 20;
  limit = Math.max(1, Math.min(100, Math.floor(limit)));

  const qs = buildQuery(args);
  qs.set('limit', String(limit));

  const orderRaw = typeof args.order_by === 'string' ? args.order_by.trim() : '';
  const allowed = new Set(['time', 'magnitude', 'time-asc', 'magnitude-asc']);
  qs.set('orderby', allowed.has(orderRaw) ? orderRaw : 'time');

  const res = await fetch(`${BASE}/query?${qs.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return { error: `USGS: ${res.status} ${(await res.text()).slice(0, 200)}` };

  const data = (await res.json()) as { features?: QuakeFeature[]; metadata?: { count?: number } };
  const features = Array.isArray(data.features) ? data.features : [];
  return {
    count: data.metadata?.count ?? features.length,
    earthquakes: features.slice(0, limit).map(mapQuake),
  };
}

async function getEarthquake(args: Record<string, unknown>): Promise<unknown> {
  const eventId = typeof args.event_id === 'string' ? args.event_id.trim() : '';
  if (!eventId) return { error: 'provide an event_id, e.g. "us7000n7n8"' };

  const qs = new URLSearchParams({ format: 'geojson', eventid: eventId });
  const res = await fetch(`${BASE}/query?${qs.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (res.status === 404) return { error: 'earthquake not found', event_id: eventId };
  if (!res.ok) return { error: `USGS: ${res.status} ${(await res.text()).slice(0, 200)}` };

  const f = (await res.json()) as QuakeFeature;
  const p = f.properties ?? {};
  const c = f.geometry?.coordinates ?? [];
  return {
    id: f.id,
    magnitude: p.mag,
    magType: p.magType,
    place: p.place,
    title: p.title,
    time: isoFromMs(p.time),
    updated: isoFromMs(p.updated),
    longitude: c[0],
    latitude: c[1],
    depth_km: c[2],
    felt_reports: p.felt,
    tsunami_flag: p.tsunami === 1,
    significance: p.sig,
    status: p.status,
    net: p.net,
    sources: p.sources,
    types: p.types,
    url: p.url,
    detail_url: p.detail,
    alert: p.alert,
    cdi: p.cdi,
    mmi: p.mmi,
  };
}

async function countEarthquakes(args: Record<string, unknown>): Promise<unknown> {
  const qs = buildQuery(args);
  const res = await fetch(`${BASE}/count?${qs.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return { error: `USGS: ${res.status} ${(await res.text()).slice(0, 200)}` };

  const data = (await res.json()) as { count?: number };
  return { count: data.count ?? 0 };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
