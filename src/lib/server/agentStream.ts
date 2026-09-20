import { encodeSse, type AgentEvent } from '$lib/agent/events';
import { withRequestSignal } from '$lib/agent/requestContext.server';

/** Heartbeats are SSE comments, so the shared AgentEvent contract is unchanged. */
export function agentStream(
	requestSignal: AbortSignal,
	produce: () => AsyncIterable<AgentEvent>,
	release: () => void,
	deadlineMs = 300_000
): ReadableStream<Uint8Array> {
	const abort = new AbortController();
	const encoder = new TextEncoder();
	let closed = false;
	let cleanup = () => {};
	return new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (event: AgentEvent) => { if (!closed) controller.enqueue(encoder.encode(encodeSse(event))); };
			const finish = () => {
				if (closed) return;
				closed = true; cleanup(); controller.close();
			};
			const disconnect = () => { abort.abort(); finish(); };
			const heartbeat = setInterval(() => {
				if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n'));
			}, 15_000);
			const timer = setTimeout(() => {
				send({ type: 'error', code: 'search_timeout', message: 'This search took too long. Try a smaller area or more specific filters.' });
				send({ type: 'done' }); abort.abort(); finish();
			}, deadlineMs);
			let cleaned = false;
			cleanup = () => {
				if (cleaned) return;
				cleaned = true; clearInterval(heartbeat); clearTimeout(timer);
				requestSignal.removeEventListener('abort', disconnect); release();
			};
			requestSignal.addEventListener('abort', disconnect, { once: true });
			if (requestSignal.aborted) { disconnect(); return; }
			controller.enqueue(encoder.encode(': connected\n\n'));
			void withRequestSignal(abort.signal, async () => {
				try {
					for await (const event of produce()) {
						abort.signal.throwIfAborted(); send(event);
					}
				} catch {
					send({ type: 'error', code: 'request_failed', message: 'The search could not finish. Please retry shortly.' });
				} finally {
					send({ type: 'done' }); finish();
				}
			});
		},
		cancel() { closed = true; abort.abort(); cleanup(); }
	});
}
