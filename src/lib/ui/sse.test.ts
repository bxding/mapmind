import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAgent } from './sse';
const body = { messages: [{ role: 'user' as const, content: 'cafés' }] };
afterEach(() => vi.unstubAllGlobals());
describe('SSE client', () => {
	it('surfaces HTTP errors instead of pretending the stream succeeded', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Service busy' }, { status: 429 })));
		await expect(streamAgent(body, vi.fn())).rejects.toThrow('Service busy');
	});
	it('detects a truncated stream', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"type":"status","message":"searching"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
		await expect(streamAgent(body, vi.fn())).rejects.toThrow('before the search finished');
	});
	it('handles chunked UTF-8 answers and done events', async () => {
		const encoded = new TextEncoder().encode('data: {"type":"answer","text":"Café"}\r\n\r\ndata: {"type":"done"}\r\n\r\n');
		const stream = new ReadableStream({ start(c) { for (const byte of encoded) c.enqueue(new Uint8Array([byte])); c.close(); } });
		vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })));
		const onEvent = vi.fn(); await streamAgent(body, onEvent);
		expect(onEvent).toHaveBeenCalledWith({ type: 'answer', text: 'Café' }); expect(onEvent).toHaveBeenCalledWith({ type: 'done' });
	});
	it('ignores keepalive comments without adding activity events', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(': connected\n\n: keepalive\n\ndata: {"type":"done"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
		const onEvent = vi.fn(); await streamAgent(body, onEvent);
		expect(onEvent).toHaveBeenCalledTimes(1); expect(onEvent).toHaveBeenCalledWith({ type: 'done' });
	});
	it('explains a failed browser connection without exposing fetch failed', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
		await expect(streamAgent(body, vi.fn())).rejects.toThrow('Could not connect to MapMind');
	});
	it('explains a dropped connection mid-stream', async () => {
		const stream = new ReadableStream({ start(c) { c.error(new TypeError('fetch failed')); } });
		vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })));
		await expect(streamAgent(body, vi.fn())).rejects.toThrow('connection to MapMind was interrupted');
	});

});
