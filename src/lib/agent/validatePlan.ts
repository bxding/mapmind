import { z } from 'zod';
import { planSchema, type Plan } from '$lib/oql/plan';
import { assertSearchBounds, MAX_AROUND_RADIUS_M } from './limits';

export class PlanError extends Error {
	constructor(message: string) { super(message); this.name = 'PlanError'; }
}

/** The subset the public agent can safely execute on a shared Overpass instance. */
export const executablePlanSchema = planSchema.extend({
	scope: z.discriminatedUnion('kind', [
		planSchema.shape.scope.options[0],
		planSchema.shape.scope.options[1]
	]),
	sets: z.array(planSchema.shape.sets.element.extend({
		within: z.discriminatedUnion('kind', [
			z.object({ kind: z.literal('scope') }),
			z.object({ kind: z.literal('around'), set: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/), radius: z.number().min(1).max(MAX_AROUND_RADIUS_M) })
		]).default({ kind: 'scope' })
	})).min(1).max(8),
	output: z.object({ mode: z.enum(['center', 'geom', 'count']), limit: z.number().int().min(1).max(2000).optional() }).default({ mode: 'center', limit: 200 }),
	recurse: z.literal('none').optional(),
	adiff: z.never().optional()
});

export function validateExecutablePlan(plan: Plan): void {
	const result = executablePlanSchema.safeParse(plan);
	if (!result.success) throw new PlanError('Use a city or valid bounding box, center/geom/count output, no recursion or adiff, a nearby radius of at most 5 km, and at most 2000 requested results.');
	const names = new Set<string>();
	for (const set of plan.sets) {
		if (names.has(set.name) || ['searchArea', 'result'].includes(set.name)) throw new PlanError('Set names must be unique and cannot be searchArea or result.');
		if (set.within.kind !== 'scope' && !names.has(set.within.set)) throw new PlanError('Spatial references must name an earlier set in this same plan.');
		if (!set.filters.some((f) => ['=', '~', 'exists'].includes(f.op))) throw new PlanError('Each set needs a positive tag filter to keep searches bounded.');
		const equalities = new Map<string, string | undefined>();
		for (const filter of set.filters) {
			if (filter.op === '=') {
				if (equalities.has(filter.key) && equalities.get(filter.key) !== filter.value) throw new PlanError('A set cannot require two different values for the same tag. Filters in a set are AND; use separate sets with a union for alternatives.');
				equalities.set(filter.key, filter.value);
			}
			if (['=', '!=', '~'].includes(filter.op) && !filter.value) throw new PlanError('Comparison filters require a nonempty value.');
		}
		names.add(set.name);
	}
	if (plan.combine?.of.some((name) => !names.has(name))) throw new PlanError('Combine references must name sets in this plan.');
	if (plan.combine?.op === 'difference' && plan.combine.of.length !== 2) throw new PlanError('Difference requires exactly two sets.');
	if (plan.scope.kind === 'bbox') {
		assertSearchBounds(plan.scope);
	}
}
