import { describe, expect, it } from 'vitest';
import { createChatSession, progressLabel } from './chat';
import type { app } from './state.svelte';
import type { AgentEvent } from '$lib/agent/events';
import type { AgentRequest } from '$lib/api/types';

function setup() {
	const state: typeof app = { messages: [], turns: [], events: [], elements: [], mapFocus: null, plan: null, oql: '', explain: '', answer: '', busy: false, bbox: { south: 1, west: 2, north: 3, east: 4 }, exampleMode: false, examplePoints: [], error: null };
	const calls: { body: AgentRequest; emit: (event: AgentEvent) => void; signal?: AbortSignal; finish: () => void; fail: (error: Error) => void }[] = [];
	const session = createChatSession(state, (body, emit, signal) => new Promise<void>((finish, fail) => calls.push({ body, emit, signal, finish, fail })));
	return { state, session, calls };
}

describe('chat session', () => {
	it('keeps answers and activity per turn, including empty results', async () => {
		const { state, session, calls } = setup();
		const first = session.send('cafés');
		calls[0].emit({ type: 'results', elements: [], count: 0 });
		expect(progressLabel(state.turns[0])).toBe('Writing answer…');
		calls[0].emit({ type: 'answer', text: 'No cafés found.' }); calls[0].finish(); await first;
		const second = session.send('libraries');
		expect(state.turns[0].answer).toBe('No cafés found.');
		expect(state.turns[0].events).toHaveLength(2);
		expect(calls[1].body.messages).toHaveLength(3);
		calls[1].finish(); await second;
	});
	it('stops without an error and ignores late events and completion during a new search', async () => {
		const { state, session, calls } = setup();
		const first = session.send('cafés'); calls[0].emit({ type: 'answer', text: 'Received answer' });
		session.stop();
		expect(calls[0].signal?.aborted).toBe(true);
		expect(state.turns[0].status).toBe('stopped'); expect(state.turns[0].answer).toBe('Received answer');
		const second = session.send('libraries');
		calls[0].emit({ type: 'error', message: 'late error' }); calls[0].finish(); await first;
		expect(state.busy).toBe(true); expect(state.error).toBeNull();
		calls[1].finish(); await second;
	});
	it('clears active work and selections while preserving map bounds', async () => {
		const { state, session, calls } = setup();
		state.exampleMode = true; state.examplePoints = [{ lat: 1, lon: 2 }];
		const pending = session.send('cafés'); session.clear();
		calls[0].emit({ type: 'results', count: 1, elements: [{ id: 1, type: 'node' }] }); calls[0].finish(); await pending;
		expect(state.turns).toEqual([]); expect(state.messages).toEqual([]); expect(state.elements).toEqual([]);
		expect(state.examplePoints).toEqual([]); expect(state.exampleMode).toBe(false); expect(state.plan).toBeNull();
		expect(state.bbox?.south).toBe(1); expect(state.busy).toBe(false);
	});
	it('retries the original request without adding a duplicate user message', async () => {
		const { state, session, calls } = setup();
		const pending = session.send('cafés'); calls[0].fail(new Error('Offline')); await pending;
		expect(state.turns[0].status).toBe('error');
		state.bbox = undefined;
		const retry = session.retry(state.turns[0]);
		expect(calls[1].body).toEqual(calls[0].body); expect(state.messages).toHaveLength(1);
		calls[1].emit({ type: 'answer', text: 'Found cafés' }); calls[1].finish(); await retry;
		expect(state.turns).toHaveLength(1); expect(state.messages).toHaveLength(2); expect(state.turns[0].status).toBe('complete');
	});
	it('does not treat an error followed by done as success or send concurrent requests', async () => {
		const { state, session, calls } = setup();
		const pending = session.send('cafés'); await session.send('another');
		expect(calls).toHaveLength(1);
		calls[0].emit({ type: 'error', message: 'Unavailable' }); calls[0].emit({ type: 'done' }); calls[0].finish(); await pending;
		expect(state.turns[0].status).toBe('error');
	});
	it('maps tool activity to simple progress labels', async () => {
		const { state, session, calls } = setup();
		const pending = session.send('cafés');
		expect(progressLabel(state.turns[0])).toBe('Thinking…');
		calls[0].emit({ type: 'tool_call', name: 'findPlace', args: {} }); expect(progressLabel(state.turns[0])).toBe('Finding places…');
		calls[0].emit({ type: 'tool_call', name: 'compileAndRun', args: {} }); expect(progressLabel(state.turns[0])).toBe('Searching the map…');
		calls[0].finish(); await pending;
		expect(progressLabel(state.turns[0])).toBe('Search complete');
	});
});
