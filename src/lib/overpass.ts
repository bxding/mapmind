import { mapGeometry, geometryCenter, type RawGeometryPoint } from '$lib/geo/geometry';
import type { MapElement } from '$lib/agent/events';

export const USER_AGENT = 'MapMind/0.1 (VTHacks 2026; text-to-overpass agent)';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export type OverpassElement = {
	id: number;
	type: 'node' | 'way' | 'relation';
	lat?: number;
	lon?: number;
	geometry?: (RawGeometryPoint | null)[];
	members?: { type: string; role?: string; lat?: number; lon?: number; geometry?: (RawGeometryPoint | null)[] }[];
	center?: { lat: number; lon: number };
	tags?: Record<string, string>;
	action?: 'create' | 'delete' | 'modify';
};

export type OverpassResponse = {
	elements?: OverpassElement[];
	remark?: string;
};

export function toMapElements(payload: OverpassResponse): MapElement[] {
	const out: MapElement[] = [];
	for (const el of payload.elements ?? []) {
		const geometry = mapGeometry(el);
		const center = el.center ?? geometryCenter(geometry);
		const lat = el.lat ?? center?.lat;
		const lon = el.lon ?? center?.lon;
		out.push({
			id: el.id,
			type: el.type,
			lat,
			lon,
			tags: el.tags,
			...(geometry ? { geometry } : {}),
			action: el.action
		});
	}
	return out;
}

export function countFromPayload(payload: OverpassResponse): number | null {
	const total = payload.elements?.find((el) => el.tags && 'total' in el.tags);
	if (total?.tags?.total) return Number(total.tags.total);
	return payload.elements?.length ?? null;
}
