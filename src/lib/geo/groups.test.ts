import { describe, expect, it } from 'vitest';
import { nearbyGroups, latestGroups } from './groups';
import type { MapElement } from '$lib/agent/events';
const point = (id: number, lat = 37, lon = -80): MapElement => ({ id, type: 'node', lat, lon });
describe('nearby amenity groups', () => {
	it('requires every category near the same origin and excludes unmatched points', () => {
		const result = nearbyGroups([point(1), point(2, 38)], [
			{ label: 'benches', elements: [point(3, 37.001), point(4, 38)] },
			{ label: 'parks', elements: [point(5, 37.002)] }
		], 300);
		expect(result.totalGroups).toBe(1);
		expect(result.groups[0].counts).toEqual({ benches: 1, parks: 1 });
		expect(result.elements.map(e => e.id)).toEqual([1, 3, 5]);
	});
	it('does not match an origin to itself or an unlocated target', () => {
		expect(nearbyGroups([point(1)], [{ label: 'parks', elements: [point(1), { id: 2, type: 'way' }] }], 300).groups).toEqual([]);
	});
	it('bounds overlays and deduplicates shared members', () => {
		const result = nearbyGroups(Array.from({ length: 150 }, (_, i) => point(i)), [{ label: 'park', elements: [point(999)] }], 300);
		expect(result.groups).toHaveLength(100); expect(result.totalGroups).toBe(150);
		expect(result.truncated).toBe(true); expect(result.elements).toHaveLength(101);
	});
	it('discards old overlays after a new result set and rejects malformed circles', () => {
		const result = nearbyGroups([point(1)], [{ label: 'parks', elements: [point(2)] }], 300);
		const event = { type: 'tool_result' as const, name: 'findNearbyGroups', result };
		expect(latestGroups([event])?.groups).toHaveLength(1);
		expect(latestGroups([event, { type: 'results', count: 0, elements: [] }])).toBeNull();
		expect(latestGroups([{ ...event, result: { ...result, groups: [{ ...result.groups[0], radiusMeters: -1 }] } }])).toBeNull();
	});
});
