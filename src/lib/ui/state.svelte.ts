import type { ChatTurn } from './chat';
import type { AgentEvent, MapElement } from '$lib/agent/events';
import type { ChatMessage, ExamplePoint } from '$lib/api/types';
import type { Plan } from '$lib/oql/plan';

export const VT_CENTER: [number, number] = [37.2285, -80.4234];
export const VT_ZOOM = 15;

export const app = $state({
	messages: [] as ChatMessage[],
	turns: [] as ChatTurn[],
	events: [] as AgentEvent[],
	elements: [] as MapElement[],
	mapFocus: null as { elements: MapElement[] } | null,
	plan: null as Plan | null,
	oql: '' as string,
	explain: '' as string,
	answer: '' as string,
	busy: false,
	bbox: undefined as { south: number; west: number; north: number; east: number } | undefined,
	exampleMode: false,
	examplePoints: [] as ExamplePoint[],
	error: null as string | null
});

export function resetTrace() {
	app.events = [];
	app.answer = '';
	app.explain = '';
	app.oql = '';
	app.error = null;
}
