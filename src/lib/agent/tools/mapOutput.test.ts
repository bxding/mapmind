import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planSchema } from '$lib/oql/plan';
import { toMapElements } from '$lib/overpass';
import { compileAndRun, withMapCoordinates } from './compileAndRun';
import { runOverpass } from './runOverpass';

vi.mock('./runOverpass', () => ({ runOverpass: vi.fn() }));
const execute = vi.mocked(runOverpass);
const plan = planSchema.parse({
	scope: { kind: 'bbox', south: 37.21, west: -80.45, north: 37.25, east: -80.4 },
	sets: [{ name: 'cafes', types: ['nwr'], filters: [{ key: 'amenity', op: '=', value: 'cafe' }] }],
	output: { mode: 'tags', limit: 200 }
});

beforeEach(() => {
	execute.mockReset().mockImplementation(async query => {
		if (query.includes('out count;')) return { count: 2, elements: [], remark: null };
		// Reproduce Overpass: tags-only output has names but no coordinates.
		const coordinates = query.includes('out geom');
		return { count: 2, remark: null, elements: toMapElements({ elements: [
			{ id: 1, type: 'node', tags: { name: 'Café' }, ...(coordinates ? { lat: 37.2285, lon: -80.4234 } : {}) },
			{ id: 2, type: 'way', tags: { name: 'Bakery' }, ...(coordinates ? { geometry: [{ lat: 37.229, lon: -80.421 }, { lat: 37.231, lon: -80.419 }] } : {}) }
		] }) };
	});
});

describe('map-ready search output', () => {
	it.each(['tags', 'skel', 'geom', 'center'] as const)('returns node and building coordinates for %s output', async mode => {
		const result = await compileAndRun({ ...plan, output: { mode, limit: 200 } });
		expect(result.oql).toContain('out geom 200;');
		expect(result.elements).toEqual([
			expect.objectContaining({ id: 1, lat: 37.2285, lon: -80.4234, tags: { name: 'Café' } }),
			expect.objectContaining({ id: 2, lat: expect.closeTo(37.23, 6), lon: -80.42, tags: { name: 'Bakery' } })
		]);
		expect(execute).toHaveBeenCalledTimes(2);
	});
	it('preserves the total while fetching actual coordinates for count questions', async () => {
		const result = await compileAndRun({ ...plan, output: { mode: 'count' } });
		expect(result.count).toBe(2); expect(result.elements).toHaveLength(2);
		expect(result.elements[0]).toMatchObject({ lat: 37.2285, lon: -80.4234 });
		expect(result.oql).toContain('out geom 200;');
		expect(execute).toHaveBeenCalledTimes(2);
	});
	it('normalizes the emitted plan without mutating the model input or search filters', () => {
		const normalized = withMapCoordinates(plan);
		expect(normalized.output).toEqual({ mode: 'geom', limit: 200 });
		expect(normalized.scope).toEqual(plan.scope); expect(normalized.sets).toEqual(plan.sets);
		expect(plan.output.mode).toBe('tags');
	});
});
