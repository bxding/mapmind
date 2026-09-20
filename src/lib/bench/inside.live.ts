import { describe, expect, it } from 'vitest';
import { compileAndRun } from '$lib/agent/tools/compileAndRun';
import type { Plan } from '$lib/oql/plan';

describe('inside operator, end to end', () => {
	it('finds the benches that are actually in Vondelpark', async () => {
		const plan: Plan = {
			scope: { kind: 'bbox', south: 52.34, west: 4.84, north: 52.38, east: 4.89 },
			sets: [
				{
					name: 'parks',
					types: ['nwr'],
					filters: [
						{ key: 'leisure', op: '=', value: 'park' },
						{ key: 'name', op: '=', value: 'Vondelpark' }
					],
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
		};
		const run = await compileAndRun(plan);
		console.log(`\n${run.oql}\n--> benches inside Vondelpark = ${run.count}`);
		expect(run.count).toBeGreaterThan(100);
	});
});
