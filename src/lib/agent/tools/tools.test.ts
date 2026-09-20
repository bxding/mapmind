import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '$lib/oql/plan';
import { compileAndRun } from './compileAndRun';
import { inferFromExamples } from './inferFromExamples';
import { runOverpass } from './runOverpass';
import { toAreaId } from './findPlace';

vi.mock('./runOverpass', () => ({
	runOverpass: vi.fn(),
	assertRunnable: vi.fn()
}));

const mocked = vi.mocked(runOverpass);

const cafePlan: Plan = {
	scope: { kind: 'place', name: 'Blacksburg', areaId: 3600117516 },
	sets: [
		{
			name: 'cafes',
			types: ['nwr'],
			filters: [{ key: 'amenity', op: '=', value: 'cafe' }],
			within: { kind: 'scope' }
		}
	],
	output: { mode: 'center', limit: 200 }
};

beforeEach(() => mocked.mockReset());

describe('toAreaId', () => {
	it('maps OSM ids onto the Overpass area range', () => {
		expect(toAreaId('relation', 117516)).toBe(3600117516);
		expect(toAreaId('way', 12345)).toBe(2400012345);
		expect(toAreaId('node', 999)).toBe(0);
	});
});

describe('compileAndRun', () => {
	it('probes with out count before running the real query', async () => {
		mocked
			.mockResolvedValueOnce({ count: 3, elements: [], remark: null })
			.mockResolvedValueOnce({
				count: 3,
				elements: [{ id: 1, type: 'node', lat: 37.2, lon: -80.4 }],
				remark: null
			});

		const result = await compileAndRun(cafePlan);
		expect(mocked).toHaveBeenCalledTimes(2);
		expect(mocked.mock.calls[0]![0]).toContain('out count;');
		expect(mocked.mock.calls[1]![0]).toContain('out geom 200;');
		expect(result.probeCount).toBe(3);
		expect(result.elements).toHaveLength(1);
	});

	it('skips the full run when the probe returns zero', async () => {
		mocked.mockResolvedValueOnce({ count: 0, elements: [], remark: null });
		const result = await compileAndRun(cafePlan);
		expect(mocked).toHaveBeenCalledTimes(1);
		expect(result.count).toBe(0);
		expect(result.elements).toEqual([]);
	});

	it('clamps the output limit for a dense but permitted search', async () => {
		mocked
			.mockResolvedValueOnce({ count: 4000, elements: [], remark: null })
			.mockResolvedValueOnce({ count: 0, elements: [], remark: null });

		const result = await compileAndRun({ ...cafePlan, output: { mode: 'center', limit: 2000 } });
		expect(result.truncated).toBe(true);
		expect(mocked.mock.calls[1]![0]).toContain('out geom 1000;');
	});

	it('stops after the probe when there are too many matches', async () => {
		mocked.mockResolvedValueOnce({ count: 10001, elements: [], remark: null });
		await expect(compileAndRun(cafePlan)).rejects.toMatchObject({ code: 'query_too_large' });
		expect(mocked).toHaveBeenCalledTimes(1);
	});
	it('keeps the full count when only a bounded sample is displayed', async () => {
		mocked.mockResolvedValueOnce({ count: 100, elements: [], remark: null })
			.mockResolvedValueOnce({ count: 1, elements: [{ id: 1, type: 'node', lat: 37.2, lon: -80.4 }], remark: null });
		const result = await compileAndRun({ ...cafePlan, output: { mode: 'count', limit: 1 } });
		expect(result.count).toBe(100); expect(result.elements).toHaveLength(1);
		expect(result.probeCount).toBe(100); expect(result.truncated).toBe(true);
		expect(mocked.mock.calls[1]![0]).toContain('out geom 1;');
		expect(mocked).toHaveBeenCalledTimes(2);
	});

	it('does not fetch locations for a zero-count result', async () => {
		mocked.mockResolvedValueOnce({ count: 0, elements: [], remark: null });
		const result = await compileAndRun({ ...cafePlan, output: { mode: 'count' } });
		expect(result.count).toBe(0); expect(result.elements).toEqual([]);
		expect(mocked).toHaveBeenCalledTimes(1);
	});

	it('rejects raw query overrides before querying', async () => {
		await expect(compileAndRun({ ...cafePlan, rawOql: 'out;' } as unknown as Plan)).rejects.toThrow();
		expect(mocked).not.toHaveBeenCalled();
	});
});

describe('inferFromExamples', () => {
	const points = [
		{ lat: 37.2285, lon: -80.4234 },
		{ lat: 37.229, lon: -80.424 }
	];

	it('needs at least two clicks', async () => {
		await expect(inferFromExamples([points[0]!])).rejects.toThrow(/at least 2/);
	});

	it('prefers the specific tag the clicked places share', async () => {
		mocked.mockResolvedValueOnce({
			count: 2,
			remark: null,
			elements: [
				{
					id: 1,
					type: 'node',
					lat: 37.2285,
					lon: -80.4234,
					tags: { amenity: 'cafe', name: 'Deet’s', building: 'yes' }
				},
				{
					id: 2,
					type: 'node',
					lat: 37.229,
					lon: -80.424,
					tags: { amenity: 'cafe', name: 'Au Bon Pain', building: 'yes' }
				}
			]
		});

		const result = await inferFromExamples(points);
		// building=yes is shared too, but amenity is the tag that says what these are.
		expect(result.plan.sets[0]!.filters).toEqual([{ key: 'amenity', op: '=', value: 'cafe' }]);
		expect(result.matched).toHaveLength(2);
		expect(result.plan.scope.kind).toBe('bbox');
		expect(result.summary).toContain('amenity=cafe');
	});

	it('falls back to weaker keys when no strong tag is shared', async () => {
		mocked.mockResolvedValueOnce({
			count: 2,
			remark: null,
			elements: [
				{ id: 1, type: 'way', lat: 37.2285, lon: -80.4234, tags: { building: 'dormitory' } },
				{ id: 2, type: 'way', lat: 37.229, lon: -80.424, tags: { building: 'dormitory' } }
			]
		});
		const result = await inferFromExamples(points);
		expect(result.plan.sets[0]!.filters).toEqual([{ key: 'building', op: '=', value: 'dormitory' }]);
	});

	it('refuses when the clicks have nothing in common', async () => {
		mocked.mockResolvedValueOnce({
			count: 2,
			remark: null,
			elements: [
				{ id: 1, type: 'node', lat: 37.2285, lon: -80.4234, tags: { amenity: 'cafe' } },
				{ id: 2, type: 'node', lat: 37.229, lon: -80.424, tags: { shop: 'books' } }
			]
		});
		await expect(inferFromExamples(points)).rejects.toThrow(/no tag in common/);
	});

	it('explains when the clicks landed on nothing tagged', async () => {
		mocked.mockResolvedValueOnce({ count: 0, elements: [], remark: null });
		await expect(inferFromExamples(points)).rejects.toThrow(/nothing tagged/);
	});
});
