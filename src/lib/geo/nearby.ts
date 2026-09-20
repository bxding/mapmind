import type { MapElement } from '$lib/agent/events';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
	const dLat = toRad(bLat - aLat);
	const dLon = toRad(bLon - aLon);
	const lat1 = toRad(aLat);
	const lat2 = toRad(bLat);
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type NearbyRank = {
	origin: MapElement;
	count: number;
	/** The targets that fell inside the radius, nearest first. */
	nearest: { element: MapElement; distance: number }[];
};

function located(el: MapElement): el is MapElement & { lat: number; lon: number } {
	return typeof el.lat === 'number' && typeof el.lon === 'number';
}

/**
 * "Which dorm has the most cafés within 800 m" is not an Overpass group-by — Overpass
 * has no `for` over a result set that returns per-origin counts. So we fetch both sets
 * with `out center` and rank here.
 */
export function countNearby(
	origins: MapElement[],
	targets: MapElement[],
	radiusMeters: number
): NearbyRank[] {
	const placedTargets = targets.filter(located);
	const ranked = origins.filter(located).map((origin) => {
		const nearest: { element: MapElement; distance: number }[] = [];
		for (const target of placedTargets) {
			if (target.type === origin.type && target.id === origin.id) continue;
			const distance = haversine(origin.lat, origin.lon, target.lat, target.lon);
			if (distance <= radiusMeters) nearest.push({ element: target, distance });
		}
		nearest.sort((a, b) => a.distance - b.distance);
		return { origin, count: nearest.length, nearest };
	});
	// Deterministic order: most targets first, then by id so ties do not shuffle per run.
	ranked.sort((a, b) => b.count - a.count || a.origin.id - b.origin.id);
	return ranked;
}

export function elementLabel(el: MapElement): string {
	return (
		el.tags?.name ??
		el.tags?.['addr:housename'] ??
		el.tags?.operator ??
		`${el.type}/${el.id}`
	);
}
