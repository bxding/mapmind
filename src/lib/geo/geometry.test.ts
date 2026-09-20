import { describe, expect, it } from 'vitest';
import { toMapElements, type OverpassElement } from '$lib/overpass';
import { validateGeometry, MAX_GEOMETRY_POINTS } from './geometry';
const a = { lat: 37, lon: -80 }, b = { lat: 37.01, lon: -80.01 }, c = { lat: 37.02, lon: -80 };
describe('map geometry', () => {
	it('preserves roads and derives a center for analysis', () => {
		const [road] = toMapElements({ elements: [{ id: 1, type: 'way', tags: { highway: 'residential' }, geometry: [a, b] }] });
		expect(road.geometry).toEqual({ type: 'LineString', coordinates: [[-80, 37], [-80.01, 37.01]] });
		expect(road.lat).toBeCloseTo(37.005); expect(road.lon).toBeCloseTo(-80.005);
	});
	it('fills closed areas but not closed roads', () => {
		const ways: OverpassElement[] = [{ id: 1, type: 'way' as const, geometry: [a, b, c, a], tags: { leisure: 'park' } }, { id: 2, type: 'way' as const, geometry: [a, b, c, a], tags: { highway: 'residential' } }];
		expect(toMapElements({ elements: ways }).map(e => e.geometry?.type)).toEqual(['Polygon', 'LineString']);
	});
	it('never bridges missing coordinates or disconnected relation members', () => {
		const elements = toMapElements({ elements: [{ id: 1, type: 'way', geometry: [a, b, null, c, a] }, { id: 2, type: 'relation', tags: { type: 'multipolygon' }, members: [{ type: 'way', role: 'outer', geometry: [a, b, c, a] }, { type: 'way', role: 'inner', geometry: [b, c] }] }] });
		for (const e of elements) { expect(e.geometry?.type).toBe('MultiLineString'); expect(e.geometry?.coordinates).toHaveLength(2); }
	});
	it('rejects malformed or excessive geometry before rendering', () => {
		expect(() => validateGeometry([{ id: 1, type: 'way', geometry: [{ lat: 100, lon: 0 }] }])).toThrow();
		expect(() => validateGeometry([{ id: 1, type: 'way', geometry: Array(MAX_GEOMETRY_POINTS + 1).fill(a) }])).toThrow();
		expect(() => validateGeometry([{ id: 1, type: 'way', geometry: [a, null, b] }])).not.toThrow();
	});
	it('preserves legacy point and center-only results', () => {
		expect(toMapElements({ elements: [{ id: 1, type: 'way', center: a }] })[0]).toMatchObject({ id: 1, lat: 37, lon: -80 });
	});
});
