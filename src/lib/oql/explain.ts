import type { Plan, PlanSet, TagFilter } from './plan';
import { parsePlan } from './plan';

function filterEnglish(filter: TagFilter): string {
	switch (filter.op) {
		case 'exists':
			return `with a ${filter.key} tag`;
		case '!exists':
			return `without a ${filter.key} tag`;
		case '=':
			return `${filter.key}=${filter.value}`;
		case '!=':
			return `${filter.key} not ${filter.value}`;
		case '~':
			return `${filter.key} matching /${filter.value}/`;
	}
}

function setEnglish(set: PlanSet): string {
	const types = set.types.join('/');
	const tags = set.filters.length ? set.filters.map(filterEnglish).join(', ') : 'any tags';
	if (set.within.kind === 'around') {
		return `${types} (${tags}) within ${set.within.radius} m of ${set.within.set}`;
	}
	if (set.within.kind === 'inside') {
		return `${types} (${tags}) inside ${set.within.set}`;
	}
	return `${types} (${tags})`;
}

export function explain(input: Plan | unknown): string {
	const plan = parsePlan(input);
	const where =
		plan.scope.kind === 'place'
			? `in ${plan.scope.name}`
			: plan.scope.kind === 'bbox'
				? 'in the current map view'
				: 'worldwide';
	const sets = plan.sets.map(setEnglish).join('; then ');
	const time = plan.adiff
		? ` Changes between ${plan.adiff[0]} and ${plan.adiff[1]}.`
		: plan.date
			? ` As of ${plan.date}.`
			: '';
	return `Find ${sets} ${where}.${time}`.replace(/\s+/g, ' ').trim();
}
