import type { AgentEvent } from '$lib/agent/events';
import type { AgentRequest } from '$lib/api/types';
import type { app } from './state.svelte';
import { streamAgent } from './sse';

export type ChatTurn = {
	id: number;
	question: string;
	answer: string;
	events: AgentEvent[];
	status: 'working' | 'complete' | 'stopped' | 'error';
	error: string | null;
	request: AgentRequest;
};

export function progressLabel(turn: ChatTurn): string {
	if (turn.status === 'stopped') return 'Stopped';
	if (turn.status === 'error') return 'Search interrupted';
	if (turn.status === 'complete') return 'Search complete';
	for (const event of [...turn.events].reverse()) {
		if (event.type === 'answer') return 'Finishing up…';
		if (event.type === 'results') return 'Writing answer…';
		if (event.type === 'oql') return 'Searching the map…';
		if (event.type === 'tool_call') {
			if (/findPlace|inferFromExamples/.test(event.name)) return 'Finding places…';
			if (/compileAndRun|runOverpass/.test(event.name)) return 'Searching the map…';
			return 'Thinking…';
		}
	}
	return 'Thinking…';
}

export function createChatSession(state: typeof app, transport = streamAgent) {
	let active: { controller: AbortController; turn: ChatTurn } | undefined;
	let nextId = 0;
	function resetActivity() {
		state.mapFocus = null;
		state.events = []; state.answer = ''; state.explain = ''; state.oql = ''; state.error = null;
	}
	function syncHistory() {
		state.messages = state.turns.flatMap((turn) => [
			{ role: 'user' as const, content: turn.question },
			...(turn.answer ? [{ role: 'assistant' as const, content: turn.answer }] : [])
		]);
	}
	async function run(turn: ChatTurn) {
		resetActivity();
		state.busy = true;
		const run = { controller: new AbortController(), turn };
		active = run;
		try {
			await transport(turn.request, (event) => {
				if (active !== run) return;
				turn.events = [...turn.events, event]; state.events = turn.events;
				if (event.type === 'plan') state.plan = event.plan;
				if (event.type === 'oql') state.oql = event.oql;
				if (event.type === 'explain') state.explain = event.text;
				if (event.type === 'answer') { turn.answer = event.text; state.answer = event.text; syncHistory(); }
				if (event.type === 'results') state.elements = event.elements;
				if (event.type === 'error') { turn.error = event.message; state.error = event.message; }
			}, run.controller.signal);
			if (active === run) turn.status = turn.error ? 'error' : 'complete';
		} catch (error) {
			if (active !== run) return;
			turn.status = 'error';
			turn.error = error instanceof Error ? error.message : 'The search could not finish.';
			state.error = turn.error;
		} finally {
			if (active === run) { active = undefined; state.busy = false; syncHistory(); }
		}
	}
	return {
		async send(question: string) {
			question = question.trim();
			if (!question || state.busy) return;
			const request: AgentRequest = JSON.parse(JSON.stringify({
				messages: [...state.messages, { role: 'user', content: question }].slice(-15),
				previousPlan: state.plan ?? undefined, bbox: state.bbox, examplePoints: state.examplePoints
			}));
			state.turns.push({ id: ++nextId, question, answer: '', events: [], status: 'working', error: null, request });
			syncHistory();
			await run(state.turns[state.turns.length - 1]);
		},
		async retry(turn: ChatTurn) {
			if (state.busy || turn !== state.turns.at(-1) || !['error', 'stopped'].includes(turn.status)) return;
			turn.answer = ''; turn.events = []; turn.error = null; turn.status = 'working';
			syncHistory();
			await run(turn);
		},
		stop() {
			if (!active) return;
			const run = active; active = undefined;
			run.turn.status = 'stopped'; run.turn.error = null;
			state.error = null; state.busy = false;
			run.controller.abort(); syncHistory();
		},
		clear() {
			this.stop(); resetActivity();
			state.turns = []; state.messages = []; state.plan = null; state.elements = [];
			state.examplePoints = []; state.exampleMode = false;
		}
	};
}
