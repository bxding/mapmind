import { ServiceError } from '../errors';
import type { SearchBounds } from '../limits';
import { DAY_MS, cached, fetchJson, nominatimLimit } from '$lib/agent/net';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export type Place = {
	displayName: string;
	bounds?: SearchBounds;
	osmType: 'relation' | 'way' | 'node';
	osmId: number;
	/** 0 when the best match is a node — a node has no Overpass area, use lat/lon instead. */
	areaId: number;
	lat: number;
	lon: number;
};

type NominatimResult = {
	boundingbox?: string[];
	osm_type?: string;
	osm_id?: number;
	display_name?: string;
	lat?: string;
	lon?: string;
	importance?: number;
	class?: string;
	type?: string;
};

/**
 * Overpass derives area ids from the OSM object id:
 *   relation R -> 3600000000 + R, way W -> 2400000000 + W.
 * Nodes have no area, so they score last and yield areaId 0.
 */
export function toAreaId(osmType: Place['osmType'], osmId: number): number {
	if (osmType === 'relation') return 3600000000 + osmId;
	if (osmType === 'way') return 2400000000 + osmId;
	return 0;
}

/** Prefer something we can turn into an area, then let Nominatim's own ranking decide. */
function score(result: NominatimResult): number {
	const typeRank = result.osm_type === 'relation' ? 2 : result.osm_type === 'way' ? 1 : 0;
	return typeRank * 10 + (result.importance ?? 0);
}

export async function findPlace(name: string): Promise<Place> {
	const query = name.trim();
	if (!query) throw new Error('findPlace: name is required');

	const url = `${NOMINATIM_URL}?${new URLSearchParams({
		q: query,
		format: 'jsonv2',
		limit: '8',
		addressdetails: '0'
	})}`;

	const results = await cached('nominatim', url, 30 * DAY_MS, () =>
		nominatimLimit(() => fetchJson<NominatimResult[]>(url, { timeoutMs: 20_000 }))
	);

	const usable = results.filter(
		(r) => r.osm_id != null && (r.osm_type === 'relation' || r.osm_type === 'way' || r.osm_type === 'node')
	);
	if (!usable.length) throw new ServiceError('place_not_found', 'No matching place was found. Try a more specific place name.');

	const best = usable.reduce((a, b) => (score(b) > score(a) ? b : a));
	const osmType = best.osm_type as Place['osmType'];
	const osmId = Number(best.osm_id);
	return {
		displayName: best.display_name ?? query,
		bounds: best.boundingbox?.length === 4 ? { south: Number(best.boundingbox[0]), north: Number(best.boundingbox[1]), west: Number(best.boundingbox[2]), east: Number(best.boundingbox[3]) } : undefined,
		osmType,
		osmId,
		areaId: toAreaId(osmType, osmId),
		lat: Number(best.lat ?? 0),
		lon: Number(best.lon ?? 0)
	};
}
