import { expect, it } from 'vitest';
import { clusterPoints } from './clusters';
import type { MapElement } from '$lib/agent/events';
const points: MapElement[] = [{ id: 1, type: 'node', lat: 10, lon: 10 }, { id: 2, type: 'node', lat: 11, lon: 11 }, { id: 3, type: 'node', lat: 80, lon: 80 }];
it('clusters screen-nearby pins and splits them when zoomed in', () => {
	expect(clusterPoints(points, (x, y) => ({ x, y })).map(c => c.members.length)).toEqual([2, 1]);
	expect(clusterPoints(points, (x, y) => ({ x: x * 100, y: y * 100 }))).toHaveLength(3);
	expect(clusterPoints(points, (x, y) => ({ x, y }), false)).toHaveLength(3);
});
it('does not cluster roads or unlocated results as pins', () => {
	expect(clusterPoints([{ ...points[0], geometry: { type: 'LineString', coordinates: [[10, 10], [11, 11]] } }, { id: 4, type: 'way' }], (x, y) => ({ x, y }))).toEqual([]);
});

it('joins nearby pins across grid cell boundaries', () => {
	const neighboring = [{ ...points[0], lat: 63, lon: 63 }, { ...points[1], lat: 65, lon: 65 }];
	expect(clusterPoints(neighboring, (x, y) => ({ x, y }))).toHaveLength(1);
});
