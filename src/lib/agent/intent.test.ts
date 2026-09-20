import { describe, expect, it } from 'vitest';
import { heuristicPlan, parseIntent, parsePlaceName, parseRadius } from './intent';
import { compile } from '$lib/oql/compile';
import type { Plan } from '$lib/oql/plan';

describe('parseRadius', () => {
	it('reads metres, kilometres, miles, and feet', () => {
		expect(parseRadius('within 800 m')).toBe(800);
		expect(parseRadius('within 1.5 km')).toBe(1500);
		expect(parseRadius('within 1 mile')).toBe(1609);
		expect(parseRadius('within 500 feet')).toBe(152);
	});

	it('converts a walking time at ~80 m per minute', () => {
		expect(parseRadius('within a 10 minute walk')).toBe(800);
		expect(parseRadius('5-minute walk')).toBe(400);
	});

	it('returns null when no distance is given', () => {
		expect(parseRadius('cafes in Blacksburg')).toBeNull();
	});
});

describe('parsePlaceName', () => {
	it('picks up the place after a preposition', () => {
		expect(parsePlaceName('Cafés in Blacksburg with outdoor seating')).toBe('Blacksburg');
		expect(parsePlaceName('Which dorm at Virginia Tech has the most cafés?')).toBe('Virginia Tech');
	});

	it('falls back to campus wording and then to null', () => {
		expect(parsePlaceName('benches on campus')).toBe('Virginia Tech');
		expect(parsePlaceName('show me every bench')).toBeNull();
	});
});

describe('parseIntent', () => {
	it('splits origin and target around the superlative', () => {
		const intent = parseIntent('Which dorm at Virginia Tech has the most cafés within 800 m?');
		expect(intent.origin?.label).toBe('dorm');
		expect(intent.target?.label).toBe('café');
		expect(intent.ranking).toBe(true);
		expect(intent.radius).toBe(800);
	});

	it('reads modifiers as extra tag filters', () => {
		const intent = parseIntent('Cafés in Blacksburg with outdoor seating');
		expect(intent.ranking).toBe(false);
		expect(intent.modifiers).toContainEqual({ key: 'outdoor_seating', op: '=', value: 'yes' });
	});

	it('flags a bare refinement as a follow-up', () => {
		const intent = parseIntent('only ones open past 9pm');
		expect(intent.target).toBeNull();
		expect(intent.refinement).toBe(true);
		expect(intent.lateMinute).toBe(21 * 60);
	});
});

describe('heuristicPlan', () => {
	it('builds two plans for the VT dorm demo and compiles both', () => {
		const result = heuristicPlan('Which dorm at Virginia Tech has the most cafés within 800 m?');
		expect(result).not.toBeNull();
		expect(result!.radius).toBe(800);
		expect(result!.originLabel).toBe('dorm');

		const targets = compile(result!.plan);
		const origins = compile(result!.originPlan!);
		expect(targets).toContain('nwr["amenity"="cafe"](area.searchArea);');
		expect(origins).toContain('nwr["building"="dormitory"](area.searchArea);');
		expect(targets).toContain('area["name"="Virginia Tech"]->.searchArea;');
		expect(targets).not.toContain('{{');
	});

	it('merges modifiers into the tag filters', () => {
		const result = heuristicPlan('Cafés in Blacksburg with outdoor seating');
		expect(compile(result!.plan)).toContain('nwr["amenity"="cafe"]["outdoor_seating"="yes"]');
		expect(result!.originPlan).toBeUndefined();
	});

	it('scopes to the map view when no place is named', () => {
		const result = heuristicPlan('benches', {
			bbox: { south: 37.21, west: -80.45, north: 37.25, east: -80.4 }
		});
		expect(compile(result!.plan)).toContain('(37.21,-80.45,37.25,-80.4);');
	});

	it('treats a follow-up as an edit of the previous plan', () => {
		const previous: Plan = {
			scope: { kind: 'place', name: 'Blacksburg', areaId: 3600117516 },
			sets: [
				{
					name: 'targets',
					types: ['nwr'],
					filters: [{ key: 'amenity', op: '=', value: 'cafe' }],
					within: { kind: 'scope' }
				}
			],
			output: { mode: 'center', limit: 200 }
		};
		const result = heuristicPlan('only ones open past 9pm', { previousPlan: previous });
		expect(result!.lateMinute).toBe(21 * 60);
		expect(compile(result!.plan)).toContain('area(3600117516)->.searchArea;');
	});

	it('carries a historic date into the plan', () => {
		const result = heuristicPlan('shops in Blacksburg', { date: '2019-01-01T00:00:00Z' });
		expect(compile(result!.plan)).toContain('[date:"2019-01-01T00:00:00Z"]');
	});

	it('returns null when nothing is recognisable', () => {
		expect(heuristicPlan('hello there')).toBeNull();
	});
});
