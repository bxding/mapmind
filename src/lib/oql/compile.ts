import type { Plan, PlanSet, TagFilter } from './plan';
import { parsePlan } from './plan';

function escapeVal(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function filterToOql(filter: TagFilter): string {
	const key = escapeVal(filter.key);
	switch (filter.op) {
		case 'exists':
			return `["${key}"]`;
		case '!exists':
			return `[!"${key}"]`;
		case '=':
			return `["${key}"="${escapeVal(filter.value ?? '')}"]`;
		case '!=':
			return `["${key}"!="${escapeVal(filter.value ?? '')}"]`;
		case '~':
			return `["${key}"~"${escapeVal(filter.value ?? '')}",i]`;
	}
}

/** Name of the derived area set for a named element set. */
function areaSetName(setName: string): string {
	return `${setName}Area`;
}

/** The plan's own scope, as an Overpass filter. Empty for a global plan. */
function scopeClause(plan: Plan): string {
	if (plan.scope.kind === 'place') return '(area.searchArea)';
	if (plan.scope.kind === 'bbox') {
		const { south, west, north, east } = plan.scope;
		return `(${south},${west},${north},${east})`;
	}
	return '';
}

function spatial(set: PlanSet, plan: Plan): string {
	// An `around` buffer extends past the scope that produced the seed set, so the scope
	// has to be re-applied. Without it a difference like "benches, minus benches near a
	// road" subtracts out-of-scope elements and returns a wrong count.
	if (set.within.kind === 'around') {
		return `(around.${set.within.set}:${Math.round(set.within.radius)})${scopeClause(plan)}`;
	}
	// `(area.x)` only works on an AREA set. Pointing it at a plain way/relation set is
	// silently empty, not an error — compile() emits the map_to_area conversion below.
	if (set.within.kind === 'inside') {
		return `(area.${areaSetName(set.within.set)})`;
	}
	return scopeClause(plan);
}

function emitSet(set: PlanSet, plan: Plan): string {
	const filters = set.filters.map(filterToOql).join('');
	const where = spatial(set, plan);
	const lines = set.types.map((type) => `  ${type}${filters}${where};`);
	return `(\n${lines.join('\n')}\n)->.${set.name};`;
}

function settingsLine(plan: Plan): string {
	// Bound every query, including count probes and historic queries, on shared servers.
	const timeout = Math.min(plan.timeout ?? 25, 25);
	const parts = [`[out:json]`, `[timeout:${timeout}]`, `[maxsize:67108864]`];
	if (plan.date) parts.push(`[date:"${escapeVal(plan.date)}"]`);
	if (plan.adiff) {
		parts.push(`[adiff:"${escapeVal(plan.adiff[0])}","${escapeVal(plan.adiff[1])}"]`);
	}
	return `${parts.join('')};`;
}

function scopePreamble(plan: Plan): string[] {
	if (plan.scope.kind !== 'place') return [];
	if (plan.scope.areaId) {
		return [`area(${plan.scope.areaId})->.searchArea;`];
	}
	return [`area["name"="${escapeVal(plan.scope.name)}"]->.searchArea;`];
}

/** Deterministic Plan → OverpassQL. The model must not emit OQL itself. */
export function compile(input: Plan | unknown): string {
	const plan = parsePlan(input);

	const lines: string[] = [settingsLine(plan), ...scopePreamble(plan)];
	const mapped = new Set<string>();
	for (const set of plan.sets) {
		if (set.within.kind === 'inside' && !mapped.has(set.within.set)) {
			lines.push(`.${set.within.set} map_to_area->.${areaSetName(set.within.set)};`);
			mapped.add(set.within.set);
		}
		lines.push(emitSet(set, plan));
	}

	let result = plan.sets[plan.sets.length - 1]!.name;
	if (plan.combine) {
		if (plan.combine.op === 'union') {
			const body = plan.combine.of.map((name) => `  .${name};`).join('\n');
			lines.push(`(\n${body}\n)->.result;`);
		} else {
			const [first, ...rest] = plan.combine.of;
			const body = [`  .${first};`, ...rest.map((name) => `  - .${name};`)].join('\n');
			lines.push(`(\n${body}\n)->.result;`);
		}
		result = 'result';
	}

	if (plan.recurse === 'down') {
		lines.push(`.${result} >;`);
		lines.push(`(.${result};._;)->.${result};`);
	}

	const limit = plan.output.limit && plan.output.mode !== 'count' ? ` ${plan.output.limit}` : '';
	lines.push(`.${result} out ${plan.output.mode}${limit};`);
	return lines.join('\n');
}

export function compileCountProbe(input: Plan | unknown): string {
	const plan = parsePlan(input);
	return compile({ ...plan, output: { mode: 'count' }, recurse: 'none' });
}
