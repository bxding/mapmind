import { describe, expect, it } from 'vitest';
import { countNearby, elementLabel, haversine } from './nearby';
import type { MapElement } from '$lib/agent/events';

const node = (id: number, lat: number, lon: number, name?: string): MapElement => ({
	id,
	type: 'node',
	lat,
	lon,
	tags: name ? { name } : undefined
});

describe('haversine', () => {
	it('measures a known short distance on campus', () => {
		// Burruss Hall to the Drillfield centre, ~250 m.
		const metres = haversine(37.2292, -80.4239, 37.2276, -80.4222);
		expect(metres).toBeGreaterThan(180);
		expect(metres).toBeLessThan(320);
	});

	it('is zero for the same point and symmetric', () => {
		expect(haversine(37.2, -80.4, 37.2, -80.4)).toBe(0);
		expect(haversine(37.2, -80.4, 37.3, -80.5)).toBeCloseTo(haversine(37.3, -80.5, 37.2, -80.4), 6);
	});
});

describe('countNearby', () => {
	const dormA = node(1, 37.2285, -80.4234, 'Pritchard Hall');
	const dormB = node(2, 37.24, -80.44, 'Far Hall');
	const cafes = [
		node(10, 37.2286, -80.4235),
		node(11, 37.229, -80.424),
		node(12, 37.2295, -80.425),
		node(13, 37.3, -80.5) // far from everything
	];

	it('ranks origins by how many targets fall inside the radius', () => {
		const ranked = countNearby([dormA, dormB], cafes, 800);
		expect(ranked[0]?.origin.id).toBe(1);
		expect(ranked[0]?.count).toBe(3);
		expect(ranked[1]?.count).toBe(0);
	});

	it('returns nearest targets first and respects the radius', () => {
		const [top] = countNearby([dormA], cafes, 100);
		expect(top?.count).toBe(2);
		expect(top?.nearest[0]?.distance).toBeLessThan(top!.nearest[1]!.distance);
	});

	it('skips elements with no coordinates and never counts an origin as its own target', () => {
		const noCoords: MapElement = { id: 99, type: 'way' };
		const ranked = countNearby([dormA, noCoords], [dormA, ...cafes], 800);
		expect(ranked).toHaveLength(1);
		expect(ranked[0]?.count).toBe(3);
	});

	it('orders ties deterministically', () => {
		const a = node(5, 37.0, -80.0);
		const b = node(3, 37.0, -80.0);
		expect(countNearby([a, b], [], 100).map((r) => r.origin.id)).toEqual([3, 5]);
	});
});

describe('elementLabel', () => {
	it('prefers a name and falls back to type/id', () => {
		expect(elementLabel(node(1, 0, 0, 'Deet’s Place'))).toBe('Deet’s Place');
		expect(elementLabel(node(7, 0, 0))).toBe('node/7');
	});
});
