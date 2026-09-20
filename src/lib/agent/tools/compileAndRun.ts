import type { MapElement } from '$lib/agent/events';
import { compile, compileCountProbe } from '$lib/oql/compile';
import { parsePlan, type Plan } from '$lib/oql/plan';
import { validateExecutablePlan } from '../validatePlan';
import { MAX_MAP_RESULTS, MAX_PROBE_MATCHES } from '../limits';
import { ServiceError } from '../errors';
import { runOverpass } from './runOverpass';

/** Above this we never ship the full element list to the browser — we clamp the plan first. */
export const MAX_ELEMENTS = MAX_MAP_RESULTS;

export type CompileAndRunResult = {
	oql: string;
	count: number;
	elements: MapElement[];
	/** Count from the cheap `out count;` probe, before any clamping. */
	probeCount?: number;
	truncated?: boolean;
	remark?: string | null;
};

/** Preserve map shapes, even when Qwen only asks for tags or feature centers. */
export function withMapCoordinates(plan: Plan): Plan {
	return { ...plan, output: {
		mode: plan.output.mode === 'count' ? 'count' : 'geom',
		limit: Math.min(plan.output.limit ?? 200, MAX_ELEMENTS)
	} };
}

/**
 * compile(plan) -> `out count;` probe -> full run.
 * The probe is what keeps a bad tag guess from dragging 10^7 elements through the
 * browser: a zero comes back in one cheap request so the model can fix and retry.
 */
export async function compileAndRun(plan: Plan): Promise<CompileAndRunResult> {
	const parsed = withMapCoordinates(parsePlan(plan));
	validateExecutablePlan(parsed);
	const oql = compile(parsed);

	const probe = await runOverpass(compileCountProbe(parsed));
	if (probe.count > MAX_PROBE_MATCHES) throw new ServiceError('query_too_large', `That search matches more than ${MAX_PROBE_MATCHES.toLocaleString('en-US')} places. Zoom in or add a more specific filter before trying again.`);
	if (probe.count === 0) {
		return { oql, count: 0, elements: [], probeCount: 0, remark: probe.remark };
	}

	// A count answers the question, but the companion map still needs locations.
	const effective: Plan = { ...parsed, output: { ...parsed.output, mode: 'geom' } };
	const truncated = probe.count > (parsed.output.limit ?? MAX_ELEMENTS);

	const finalOql = compile(effective);
	const run = await runOverpass(finalOql);
	return {
		oql: finalOql,
		count: parsed.output.mode === 'count' ? probe.count : run.elements.length,
		elements: run.elements,
		probeCount: probe.count,
		truncated: truncated || probe.count > run.elements.length,
		remark: run.remark
	};
}
