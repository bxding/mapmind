import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentStream } from './agentStream';
import { requestSignal } from '$lib/agent/requestContext.server';
import type { AgentEvent } from '$lib/agent/events';

const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);
afterEach(() => vi.useRealTimers());

describe('agent streaming lifecycle', () => {
	it('sends a header-flushing comment and heartbeats while Qwen is quiet', async () => {
		vi.useFakeTimers(); const release = vi.fn(); let resume!: () => void;
		async function* produce(): AsyncGenerator<AgentEvent> { await new Promise<void>(r => { resume = r; }); yield { type: 'answer', text: 'Done' }; }
		const stream = agentStream(new AbortController().signal, produce, release);
		const reader = stream.getReader();
		expect(decode((await reader.read()).value)).toBe(': connected\n\n');
		await vi.advanceTimersByTimeAsync(15000);
		expect(decode((await reader.read()).value)).toBe(': keepalive\n\n');
		resume();
		expect(decode((await reader.read()).value)).toContain('"answer"');
		expect(decode((await reader.read()).value)).toContain('"done"');
		expect((await reader.read()).done).toBe(true);
		expect(release).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
	});
	it('closes on the deadline even if the producer is still waiting', async () => {
		vi.useFakeTimers(); const release = vi.fn(); let signal: AbortSignal | undefined;
		async function* produce(): AsyncGenerator<AgentEvent> { signal = requestSignal(); await new Promise(() => {}); }
		const reader = agentStream(new AbortController().signal, produce, release, 1000).getReader();
		await reader.read(); await vi.advanceTimersByTimeAsync(1000);
		expect(decode((await reader.read()).value)).toContain('search_timeout');
		expect(decode((await reader.read()).value)).toContain('"done"');
		expect((await reader.read()).done).toBe(true); expect(signal?.aborted).toBe(true);
		expect(release).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
	});
	it('cancels upstream work and releases capacity when the client disconnects', async () => {
		vi.useFakeTimers(); const release = vi.fn(); let signal: AbortSignal | undefined;
		async function* produce(): AsyncGenerator<AgentEvent> { signal = requestSignal(); await new Promise(() => {}); }
		const reader = agentStream(new AbortController().signal, produce, release).getReader();
		await reader.read(); await reader.cancel();
		expect(signal?.aborted).toBe(true); expect(release).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
	});
});
