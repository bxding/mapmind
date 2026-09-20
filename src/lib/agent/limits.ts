import { ServiceError } from './errors';

export const MAX_SEARCH_AREA_KM2 = 2500;
export const MAX_SEARCH_SPAN_KM = 100;
export const MAX_AROUND_RADIUS_M = 5000;
export const MAX_PROBE_MATCHES = 10000;
export const MAX_MAP_RESULTS = 1000;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export type SearchBounds = { south: number; west: number; north: number; east: number };

/** Apply the same geographic budget to named areas and viewport queries. */
export function assertSearchBounds(bounds: SearchBounds): void {
	const { south, west, north, east } = bounds;
	if (![south, west, north, east].every(Number.isFinite) || south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) {
		throw new ServiceError('invalid_search_area', 'The search area is invalid. Choose a city or a smaller map view.');
	}
	const radians = Math.PI / 180;
	const height = 6371 * (north - south) * radians;
	const width = 6371 * (east - west) * radians * Math.cos((south + north) / 2 * radians);
	const area = 6371 ** 2 * (east - west) * radians * (Math.sin(north * radians) - Math.sin(south * radians));
	if (area > MAX_SEARCH_AREA_KM2 || Math.max(height, width) > MAX_SEARCH_SPAN_KM) {
		throw new ServiceError('search_area_too_large', 'That area is too large for a live search. Choose a city or neighborhood, or zoom in to an area under 2,500 km² and 100 km across.');
	}
}
