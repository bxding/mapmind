import { describe, expect, it } from 'vitest';
import { planSchema } from '$lib/oql/plan';
import { validateExecutablePlan } from './validatePlan';
const base = { scope: { kind: 'bbox', south: 37.2, west: -80.5, north: 37.3, east: -80.3 }, sets: [{ name: 'cafes', types: ['nwr'], filters: [{ key: 'amenity', op: '=', value: 'cafe' }] }] };
const validate = (input: unknown) => validateExecutablePlan(planSchema.parse(input));
describe('executable plan boundaries', () => {
	it('accepts a selective bounded query', () => { expect(() => validate(base)).not.toThrow(); });
	it.each([
		{ ...base, scope: { kind: 'global' } },
		{ ...base, scope: { kind: 'bbox', south: 40, west: -81, north: 38, east: -80 } },
		{ ...base, scope: { kind: 'bbox', south: -80, west: -170, north: 80, east: 170 } },
		{ ...base, rawOql: 'out;' },
		{ ...base, timeout: 9999 },
		{ ...base, output: { mode: 'center', limit: 100000 } },
		{ ...base, sets: [{ ...base.sets[0], name: 'x;out;' }] },
		{ ...base, sets: [{ ...base.sets[0], within: { kind: 'around', set: 'missing', radius: 800 } }] },
		{ ...base, sets: [{ ...base.sets[0], filters: [] }] },
		{ ...base, sets: [{ ...base.sets[0], filters: [{ key: 'amenity', op: '=' }] }] },
		{ ...base, sets: [base.sets[0], base.sets[0]] },
		{ ...base, combine: { op: 'union', of: ['cafes', 'missing'] } }
	])('rejects unsafe or invalid query %#', (input) => { expect(() => validate(input)).toThrow(); });
	it('rejects impossible same-tag equalities but permits alternatives in separate sets', () => {
		const first = { ...base.sets[0], filters: [{ key: 'surveillance', op: '=', value: 'cctv' }] };
		const second = { ...first, name: 'other', filters: [{ key: 'surveillance', op: '=', value: 'plate_reader' }] };
		expect(() => validate({ ...base, sets: [{ ...first, filters: [...first.filters, ...second.filters] }] })).toThrow(/two different values/);
		expect(() => validate({ ...base, sets: [first, second], combine: { op: 'union', of: [first.name, second.name] } })).not.toThrow();
	});

});
