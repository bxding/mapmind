import { z } from 'zod';
import type { MapElement, AgentEvent } from '$lib/agent/events';
import { countNearby, elementLabel } from './nearby';

export const groupOverlaySchema = z.object({
	groups: z.array(z.object({
		lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
		radiusMeters: z.number().min(1).max(5000), name: z.string().max(500),
		counts: z.record(z.string(), z.number().int().nonnegative())
	})).max(100),
	totalGroups: z.number().int().nonnegative(), truncated: z.boolean()
});
export type GroupOverlay = z.infer<typeof groupOverlaySchema>;

/** Every required category must have a distinct nearby OSM object. Centers are approximations. */
export function nearbyGroups(origins: MapElement[], targets: { label: string; elements: MapElement[] }[], radiusMeters: number) {
	const key = (e: MapElement) => `${e.type}/${e.id}`;
	let totalGroups = 0;
	const elements = new Map<string, MapElement>();
	const groups: GroupOverlay['groups'] = [];
	for (const origin of origins) {
		const rows = targets.map(t => countNearby([origin], t.elements, radiusMeters)[0]);
		if (!rows.length || rows.some(r => !r || r.count === 0)) continue;
		totalGroups++;
		const members = [origin, ...rows.flatMap(r => r.nearest.map(n => n.element))];
		const extra = new Set(members.filter(e => !elements.has(key(e))).map(key));
		if (groups.length >= 100 || elements.size + extra.size > 1000) continue;
		for (const e of members) elements.set(key(e), e);
		groups.push({ lat: origin.lat!, lon: origin.lon!, radiusMeters, name: elementLabel(origin).slice(0, 500), counts: Object.fromEntries(targets.map((t, i) => [t.label, rows[i].count])) });
	}
	return { groups, elements: [...elements.values()], totalGroups, truncated: groups.length < totalGroups };
}

/** A new result set invalidates any earlier grouping overlay. */
export function latestGroups(events: AgentEvent[]): GroupOverlay | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e.type === 'results') return null;
		if (e.type === 'tool_result' && e.name === 'findNearbyGroups') {
			const parsed = groupOverlaySchema.safeParse(e.result);
			return parsed.success ? parsed.data : null;
		}
	}
	return null;
}
