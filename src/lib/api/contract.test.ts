import { describe, expect, it } from 'vitest';
import { AGENT_EVENT_TYPES, encodeSse, parseSseData, type AgentEvent } from '$lib/agent/events';
import { planSchema, type Plan } from '$lib/oql/plan';
import type { AgentRequest } from '$lib/api/types';

const samplePlan: Plan = {
	scope: { kind: 'place', name: 'Blacksburg', areaId: 3600117516 },
	sets: [
		{
			name: 'cafes',
			types: ['nwr'],
			filters: [{ key: 'amenity', op: '=', value: 'cafe' }],
			within: { kind: 'scope' }
		}
	],
	output: { mode: 'center', limit: 50 }
};

const sampleEvents: AgentEvent[] = [
	{ type: 'status', message: 'resolving area' },
	{ type: 'tool_call', name: 'findPlace', args: { name: 'Blacksburg' } },
	{ type: 'tool_result', name: 'findPlace', result: { areaId: 3600117516 } },
	{ type: 'plan', plan: samplePlan },
	{ type: 'oql', oql: '[out:json]; out center;' },
	{ type: 'explain', text: 'cafés in Blacksburg' },
	{ type: 'results', count: 1, elements: [{ id: 1, type: 'node', lat: 37.23, lon: -80.42 }] },
	{ type: 'answer', text: 'Deet’s Place' },
	{ type: 'error', code: 'no_api_key', message: 'set OPENWEBUI_API_KEY' },
	{ type: 'done' }
];

describe('shared contract', () => {
	it('keeps every SSE event type the Map UI already handles', () => {
		expect(AGENT_EVENT_TYPES).toEqual([
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
		]);
		expect(new Set(sampleEvents.map((e) => e.type)).size).toBe(AGENT_EVENT_TYPES.length);
	});

	it('round-trips SSE lines the UI parser understands', () => {
		for (const event of sampleEvents) {
			const parsed = parseSseData(encodeSse(event).trim());
			expect(parsed).toEqual(event);
		}
	});

	it('round-trips optional geometry without changing result events', () => {
		const event: AgentEvent = { type: 'results', count: 1, elements: [{ id: 42, type: 'way', geometry: { type: 'LineString', coordinates: [[-80.42, 37.22], [-80.43, 37.23]] } }] };
		expect(parseSseData(encodeSse(event))).toEqual(event);
	});

	it('still parses the Plan shape both sides share', () => {
		expect(planSchema.parse(samplePlan).scope.kind).toBe('place');
	});

	it('AgentRequest still has the fields Map already sends', () => {
		const body: AgentRequest = {
			messages: [{ role: 'user', content: 'cafes' }],
			previousPlan: samplePlan,
			bbox: { south: 37.21, west: -80.45, north: 37.25, east: -80.4 },
			examplePoints: [{ lat: 37.23, lon: -80.42 }]
		};
		expect(body.messages[0]?.role).toBe('user');
		expect(body.examplePoints).toHaveLength(1);
	});
});
