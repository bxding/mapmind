import type { Plan } from '$lib/oql/plan';

export type MapCoordinate = [number, number]; // longitude, latitude
export type MapGeometry =
	| { type: 'LineString'; coordinates: MapCoordinate[] }
	| { type: 'MultiLineString'; coordinates: MapCoordinate[][] }
	| { type: 'Polygon'; coordinates: MapCoordinate[][] };

/** One OSM element the UI can plot. Agent and Map both use this. */
export type MapElement = {
	id: number;
	type: 'node' | 'way' | 'relation';
	lat?: number;
	lon?: number;
	tags?: Record<string, string>;
	geometry?: MapGeometry;
	/** adiff action when present */
	action?: 'create' | 'delete' | 'modify';
};

export const AGENT_EVENT_TYPES = [
	'status',
	'tool_call',
	'tool_result',
	'plan',
	'oql',
	'explain',
	'results',
	'answer',
	'error',
	'done'
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentEvent =
	| { type: 'status'; message: string }
	| { type: 'tool_call'; name: string; args: unknown }
	| { type: 'tool_result'; name: string; result: unknown }
	| { type: 'plan'; plan: Plan }
	| { type: 'oql'; oql: string }
	| { type: 'explain'; text: string }
	| { type: 'results'; count: number; elements: MapElement[] }
	| { type: 'answer'; text: string }
	| { type: 'error'; code?: string; message: string }
	| { type: 'done' };

export function encodeSse(event: AgentEvent): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

export function parseSseData(line: string): AgentEvent | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) return null;
	const payload = trimmed.slice(5).trim();
	if (!payload || payload === '[DONE]') return null;
	return JSON.parse(payload) as AgentEvent;
}
