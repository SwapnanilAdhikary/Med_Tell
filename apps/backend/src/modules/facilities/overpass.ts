import { Logger } from '@nestjs/common';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'MedAssist/1.0 (ASHA field reporting; contact via repo)';
// Overpass is often 5-8s on a first hit, so allow room before giving up.
const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Facilities do not move, and Overpass is a shared free service under fair use. */
const cache = new Map<
  string,
  { at: number; value: PublicFacility[]; status: 'ok' | 'unavailable' }
>();

const logger = new Logger('Overpass');

export interface PublicFacility {
  osmId: string;
  name: string;
  kind: 'hospital' | 'clinic' | 'doctors' | 'pharmacy';
  lat: number;
  lng: number;
  phone?: string;
  source: 'osm';
}

/**
 * `status` exists so an empty list is never ambiguous: "nobody has mapped a
 * facility here" and "OpenStreetMap did not answer" are different facts and a
 * worker deserves to be told which.
 */
export interface PublicFacilityResult {
  facilities: PublicFacility[];
  status: 'ok' | 'unavailable';
  radiusM: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const KINDS = ['hospital', 'clinic', 'doctors', 'pharmacy'] as const;

/**
 * Community-mapped health facilities around a point. Returns [] on any failure:
 * a third-party free service being slow or down must never fail a worker's
 * screen, and the seeded Facility collection stays the authoritative layer.
 *
 * ponytail: an in-process Map, not Redis - one Nest process, and a ~1 km cache
 * grid over data that changes yearly. Redis is the upgrade path if this ever
 * runs multi-instance.
 */
export async function fetchPublicFacilities(
  lat: number,
  lng: number,
  radiusM = 15_000,
): Promise<PublicFacilityResult> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${radiusM}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { facilities: hit.value, status: hit.status, radiusM };
  }

  const query = `[out:json][timeout:20];
nwr(around:${radiusM},${lat},${lng})["amenity"~"^(${KINDS.join('|')})$"];
out center tags 60;`;

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Required: Overpass answers 406 to Node's default agent, and their
        // usage policy asks callers to identify themselves.
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Overpass returned ${res.status}`);

    const body = (await res.json()) as { elements?: OverpassElement[] };
    const value = (body.elements ?? []).flatMap(toFacility);
    cache.set(key, { at: Date.now(), value, status: 'ok' });
    logger.log(
      `${value.length} public facilities within ${radiusM / 1000} km of ${lat},${lng}`,
    );
    return { facilities: value, status: 'ok', radiusM };
  } catch (error) {
    logger.warn(`Public facility lookup failed: ${(error as Error).message}`);
    // Cache the failure briefly so a down endpoint is not hammered.
    cache.set(key, {
      at: Date.now() - CACHE_TTL_MS + 60_000,
      value: [],
      status: 'unavailable',
    });
    return { facilities: [], status: 'unavailable', radiusM };
  }
}

function toFacility(el: OverpassElement): PublicFacility[] {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const kind = el.tags?.amenity;
  if (lat == null || lng == null) return [];
  if (!KINDS.includes(kind as (typeof KINDS)[number])) return [];
  return [
    {
      osmId: `${el.type}/${el.id}`,
      // Unnamed nodes are common in rural India; say so rather than render blank.
      name: el.tags?.name ?? el.tags?.['name:en'] ?? 'Unnamed facility',
      kind: kind as PublicFacility['kind'],
      lat,
      lng,
      phone: el.tags?.phone ?? el.tags?.['contact:phone'],
      source: 'osm',
    },
  ];
}
