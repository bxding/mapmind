import { describe, expect, it } from 'vitest';
import { compile, compileCountProbe } from './compile';
import { parsePlan, type Plan } from './plan';

const blacksburgCafes: Plan = {
	scope: { kind: 'place', name: 'Blacksburg', areaId: 3600117516 },
	sets: [
		{
			name: 'cafes',
			types: ['nwr'],
			filters: [{ key: 'amenity', op: '=', value: 'cafe' }],
			within: { kind: 'scope' }
		}
	],
	output: { mode: 'center', limit: 50 }
};

describe('parsePlan', () => {
	it('rejects an empty sets array', () => {
		expect(() => parsePlan({ scope: { kind: 'global' }, sets: [] })).toThrow();
	});
});

describe('compile', () => {
	it('compiles a place-scoped tag filter with area id', () => {
		const oql = compile(blacksburgCafes);
		expect(oql).toContain('[out:json][timeout:25][maxsize:67108864];');
		expect(oql).toContain('area(3600117516)->.searchArea;');
		expect(oql).toContain('nwr["amenity"="cafe"](area.searchArea);');
		expect(oql).toContain('.cafes out center 50;');
		expect(oql).not.toContain('{{geocodeArea');
	});

	it('falls back to a name filter when areaId is missing', () => {
		const oql = compile({
			...blacksburgCafes,
			scope: { kind: 'place', name: 'Blacksburg' }
		});
		expect(oql).toContain('area["name"="Blacksburg"]->.searchArea;');
	});

	it('compiles a bbox filter', () => {
		const oql = compile({
			scope: { kind: 'bbox', south: 37.21, west: -80.45, north: 37.25, east: -80.4 },
			sets: [
				{
					name: 'cafes',
					types: ['nwr'],
					filters: [{ key: 'amenity', op: '=', value: 'cafe' }],
					within: { kind: 'scope' }
				}
			],
			output: { mode: 'center' }
		});
		expect(oql).toContain('nwr["amenity"="cafe"](37.21,-80.45,37.25,-80.4);');
	});

	it('compiles around-set spatial filters', () => {
		const oql = compile({
			scope: { kind: 'place', name: 'Virginia Tech', areaId: 3600117516 },
			sets: [
				{
					name: 'dorms',
					types: ['nwr'],
					filters: [{ key: 'building', op: '=', value: 'dormitory' }],
					within: { kind: 'scope' }
				},
				{
					name: 'cafes',
					types: ['nwr'],
					filters: [{ key: 'amenity', op: '=', value: 'cafe' }],
					within: { kind: 'around', set: 'dorms', radius: 800 }
				}
			],
			output: { mode: 'center', limit: 200 }
		});
		expect(oql).toContain('nwr["building"="dormitory"](area.searchArea);');
		expect(oql).toContain('nwr["amenity"="cafe"](around.dorms:800)(area.searchArea);');
	});

	it('keeps an around set inside the plan scope, so set algebra stays sound', () => {
		// Verified live: without the scope clause, "benches minus benches near a road"
		// in a central Amsterdam bbox subtracted 385 out-of-bbox benches from 499 and
		// returned 254 instead of 114. With it the arithmetic is exact.
		const oql = compile({
			scope: { kind: 'bbox', south: 52.36, west: 4.88, north: 52.38, east: 4.91 },
			sets: [
				{
					name: 'roads',
					types: ['way'],
					filters: [{ key: 'highway', op: '~', value: 'primary|trunk' }],
					within: { kind: 'scope' }
				},
				{
					name: 'nearRoad',
					types: ['node'],
					filters: [{ key: 'amenity', op: '=', value: 'bench' }],
					within: { kind: 'around', set: 'roads', radius: 300 }
				}
			],
			output: { mode: 'count' }
		});
		expect(oql).toContain('node["amenity"="bench"](around.roads:300)(52.36,4.88,52.38,4.91);');
	});

	it('leaves an around set unbounded only when the plan itself is global', () => {
		const oql = compile({
			scope: { kind: 'global' },
			sets: [
				{
					name: 'seed',
					types: ['nwr'],
					filters: [{ key: 'amenity', op: '=', value: 'cafe' }],
					within: { kind: 'scope' }
				},
				{
					name: 'near',
					types: ['node'],
					filters: [{ key: 'amenity', op: '=', value: 'bench' }],
					within: { kind: 'around', set: 'seed', radius: 50 }
				}
			],
			output: { mode: 'center' }
		});
		expect(oql).toContain('node["amenity"="bench"](around.seed:50);');
	});

	it('converts an inside set to an area set before filtering by it', () => {
		// Verified live: `node[amenity=bench](area.p)` on a plain park set returned 0 benches
		// in Vondelpark. With map_to_area it returns 155. Overpass reports no error either way.
		const oql = compile({
			scope: { kind: 'bbox', south: 52.34, west: 4.84, north: 52.38, east: 4.89 },
			sets: [
				{
					name: 'parks',
					types: ['nwr'],
					filters: [{ key: 'leisure', op: '=', value: 'park' }],
					within: { kind: 'scope' }
				},
				{
					name: 'benches',
					types: ['node'],
					filters: [{ key: 'amenity', op: '=', value: 'bench' }],
					within: { kind: 'inside', set: 'parks' }
				}
			],
			output: { mode: 'count' }
		});
		expect(oql).toContain('.parks map_to_area->.parksArea;');
		expect(oql).toContain('node["amenity"="bench"](area.parksArea);');
		expect(oql.indexOf('map_to_area')).toBeLessThan(oql.indexOf('(area.parksArea)'));
	});

	it('emits one map_to_area per referenced set, however many use it', () => {
		const oql = compile({
			scope: { kind: 'global' },
			sets: [
				{ name: 'parks', types: ['way'], filters: [{ key: 'leisure', op: '=', value: 'park' }], within: { kind: 'scope' } },
				{ name: 'a', types: ['node'], filters: [{ key: 'amenity', op: '=', value: 'bench' }], within: { kind: 'inside', set: 'parks' } },
				{ name: 'b', types: ['node'], filters: [{ key: 'amenity', op: '=', value: 'waste_basket' }], within: { kind: 'inside', set: 'parks' } }
			],
			output: { mode: 'count' }
		});
		expect(oql.match(/map_to_area/g)).toHaveLength(1);
	});

	it('compiles union and difference', () => {
		const union = compile({
			scope: { kind: 'global' },
			sets: [
				{
					name: 'a',
					types: ['node'],
					filters: [{ key: 'amenity', op: '=', value: 'cafe' }],
					within: { kind: 'scope' }
				},
				{
					name: 'b',
					types: ['node'],
					filters: [{ key: 'amenity', op: '=', value: 'restaurant' }],
					within: { kind: 'scope' }
				}
			],
			combine: { op: 'union', of: ['a', 'b'] },
			output: { mode: 'center' }
		});
		expect(union).toContain('(\n  .a;\n  .b;\n)->.result;');

		const diff = compile({
			scope: { kind: 'global' },
			sets: [
				{
					name: 'a',
					types: ['nwr'],
					filters: [{ key: 'amenity', op: '=', value: 'restaurant' }],
					within: { kind: 'scope' }
				},
				{
					name: 'b',
					types: ['nwr'],
					filters: [{ key: 'cuisine', op: '=', value: 'pizza' }],
					within: { kind: 'scope' }
				}
			],
			combine: { op: 'difference', of: ['a', 'b'] },
			output: { mode: 'tags' }
		});
		expect(diff).toContain('(\n  .a;\n  - .b;\n)->.result;');
		expect(diff).toContain('.result out tags;');
	});

	it('compiles exists, regex, date, adiff, and recurse-down', () => {
		const oql = compile({
			scope: { kind: 'place', name: 'Blacksburg', areaId: 42 },
			date: '2019-01-01T00:00:00Z',
			sets: [
				{
					name: 'shops',
					types: ['nwr'],
					filters: [
						{ key: 'shop', op: 'exists' },
						{ key: 'name', op: '~', value: 'coop' }
					],
					within: { kind: 'scope' }
				}
			],
			recurse: 'down',
			output: { mode: 'geom' }
		});
		expect(oql).toContain('[date:"2019-01-01T00:00:00Z"]');
		expect(oql).toContain('["shop"]');
		expect(oql).toContain('["name"~"coop",i]');
		expect(oql).toContain('.shops >;');

		const adiff = compile({
			scope: { kind: 'place', name: 'Blacksburg', areaId: 42 },
			adiff: ['2019-01-01T00:00:00Z', '2024-01-01T00:00:00Z'],
			sets: [
				{
					name: 'shops',
					types: ['nwr'],
					filters: [{ key: 'shop', op: 'exists' }],
					within: { kind: 'scope' }
				}
			],
			output: { mode: 'center' }
		});
		expect(adiff).toContain('[timeout:25]');
		expect(adiff).toContain('[adiff:"2019-01-01T00:00:00Z","2024-01-01T00:00:00Z"]');
	});

	it('rejects raw query overrides', () => {
		expect(() => compile({ ...blacksburgCafes, rawOql: 'out;' })).toThrow();
	});

	it('compileCountProbe forces out count', () => {
		const oql = compileCountProbe(blacksburgCafes);
		expect(oql).toContain('.cafes out count;');
		expect(oql).not.toContain('out center');
	});
});
