import { parseSseData, type AgentEvent } from '$lib/agent/events';
import type { AgentRequest } from '$lib/api/types';

export async function streamAgent(body: AgentRequest, onEvent: (event: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
	let res: Response;
	try { res = await fetch('/api/agent', {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
	}); } catch {
		signal?.throwIfAborted();
		throw new Error('Could not connect to MapMind. Check your connection and retry.');
	}
	if (!res.ok) {
		const payload = await res.json().catch(() => null) as { error?: string } | null;
		throw new Error(payload?.error || 'The search service is unavailable. Please retry shortly.');
	}
	if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) throw new Error('The search service returned an invalid response.');
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let finished = false;
	function consume(chunk: string) {
		for (const line of chunk.split('\n')) {
			const event = parseSseData(line.trimEnd());
			if (event) { if (event.type === 'done') finished = true; onEvent(event); }
		}
	}
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
			buffer += decoder.decode(value, { stream: true });
			if (buffer.length > 10 * 1024 * 1024) throw new Error('The search response is too large. Try a smaller area.');
			const chunks = buffer.split(/\r?\n\r?\n/);
			buffer = chunks.pop() ?? '';
			for (const chunk of chunks) consume(chunk);
		}
	} catch (err) {
		signal?.throwIfAborted();
		if (err instanceof TypeError) throw new Error('The connection to MapMind was interrupted. Please retry the search.');
		if (err instanceof SyntaxError) throw new Error('The search service returned an invalid response. Please retry.');
		throw err;
	} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
	if (!finished) throw new Error('The connection ended before the search finished. Please retry.');
}
