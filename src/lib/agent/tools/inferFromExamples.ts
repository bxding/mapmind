import { ServiceError } from '../errors';
import type { MapElement } from '$lib/agent/events';
import type { ExamplePoint } from '$lib/api/types';
import { haversine } from '$lib/geo/nearby';
import type { Plan, TagFilter } from '$lib/oql/plan';
import { runOverpass } from './runOverpass';

/** Keys that describe *what a thing is*. Anything else (name, addr:*, phone) is per-object noise. */
const STRONG_KEYS = [
	'amenity',
	'shop',
	'leisure',
	'tourism',
	'craft',
	'office',
	'healthcare',
	'historic',
	'emergency',
	'sport',
	'club'
];

const WEAK_KEYS = [
	'building',
	'landuse',
	'natural',
	'man_made',
	'highway',
	'railway',
	'public_transport',
	'barrier',
	'waterway'
];

const SEARCH_RADIUS_M = 40;

export type InferResult = {
	plan: Plan;
	summary: string;
	/** The element each click was matched to, so the trace can show what it locked on. */
	matched: MapElement[];
};

function candidateQuery(points: ExamplePoint[]): string {
	const clauses = points
		.map((p) => `  nwr(around:${SEARCH_RADIUS_M},${p.lat.toFixed(6)},${p.lon.toFixed(6)});`)
		.join('\n');
	return `[out:json][timeout:25][maxsize:67108864];\n(\n${clauses}\n)->.candidates;\n.candidates out center 400;`;
}

function describes(el: MapElement): boolean {
	return [...STRONG_KEYS, ...WEAK_KEYS].some((key) => el.tags?.[key]);
}

/** The click landed somewhere near the thing, not exactly on it — take the closest match. */
function matchPoint(point: ExamplePoint, elements: MapElement[]): MapElement | null {
	let best: MapElement | null = null;
	let bestDistance = Infinity;
	for (const el of elements) {
		if (el.lat == null || el.lon == null || !describes(el)) continue;
		const distance = haversine(point.lat, point.lon, el.lat, el.lon);
		if (distance <= SEARCH_RADIUS_M && distance < bestDistance) {
			best = el;
			bestDistance = distance;
		}
	}
	return best;
}

function sharedPairs(elements: MapElement[], keys: string[]): TagFilter[] {
	const filters: TagFilter[] = [];
	for (const key of keys) {
		const values = elements.map((el) => el.tags?.[key]);
		const first = values[0];
		if (first && values.every((value) => value === first)) {
			filters.push({ key, op: '=', value: first });
		}
	}
	return filters;
}

function sharedKeys(elements: MapElement[], keys: string[]): TagFilter[] {
	return keys
		.filter((key) => elements.every((el) => el.tags?.[key]))
		.map((key) => ({ key, op: 'exists' }) satisfies TagFilter);
}

/** Pad the clicked points into a searchable box (~2 km minimum) for the default scope. */
export function boundsFor(points: ExamplePoint[], padDegrees = 0.02) {
	const lats = points.map((p) => p.lat);
	const lons = points.map((p) => p.lon);
	return {
		kind: 'bbox' as const,
		south: Math.min(...lats) - padDegrees,
		west: Math.min(...lons) - padDegrees,
		north: Math.max(...lats) + padDegrees,
		east: Math.max(...lons) + padDegrees
	};
}

/**
 * Query by example: 2-3 map clicks -> the tags those things have in common -> a Plan.
 * Strong keys win outright; `building=yes` should never beat `amenity=cafe`.
 */
export async function inferFromExamples(points: ExamplePoint[]): Promise<InferResult> {
	if (!points || points.length < 2 || points.length > 3) {
		throw new ServiceError('examples_invalid', 'Click at least 2 and at most 3 points on the map.');
	}

	const run = await runOverpass(candidateQuery(points));
	const matched: MapElement[] = [];
	for (const point of points) {
		const hit = matchPoint(point, run.elements);
		if (hit && !matched.some((el) => el.id === hit.id && el.type === hit.type)) matched.push(hit);
	}
	if (matched.length < 2) {
		throw new ServiceError('examples_invalid',
			`inferFromExamples: Fewer than two distinct places matched; nothing tagged within ${SEARCH_RADIUS_M} m of those clicks — try clicking directly on the markers`
		);
	}

	let filters = sharedPairs(matched, STRONG_KEYS);
	if (!filters.length) filters = sharedPairs(matched, WEAK_KEYS);
	if (!filters.length) filters = sharedKeys(matched, [...STRONG_KEYS, ...WEAK_KEYS]);
	if (!filters.length) {
		throw new ServiceError('examples_invalid',
			'inferFromExamples: those points have no tag in common — pick examples of the same kind of place'
		);
	}

	const plan: Plan = {
		scope: boundsFor(points),
		sets: [{ name: 'examples', types: ['nwr'], filters, within: { kind: 'scope' } }],
		output: { mode: 'center', limit: 200 }
	};

	const described = filters
		.map((f) => (f.op === '=' ? `${f.key}=${f.value}` : `has ${f.key}`))
		.join(' and ');
	return {
		plan,
		summary: `${matched.length} clicked place${matched.length === 1 ? '' : 's'} share ${described} — searching the surrounding area for more.`,
		matched
	};
}
