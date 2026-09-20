import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchText, readLimitedText, networkErrorCode } from './net';
import { withRequestSignal } from './requestContext.server';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('bounded upstream transport', () => {
	it('cancels an oversized chunked response without content-length', async () => {
		const cancel = vi.fn();
		const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); }, cancel });
		await expect(readLimitedText(new Response(body), 8)).rejects.toMatchObject({ code: 'response_too_large' });
		expect(cancel).toHaveBeenCalledTimes(1);
	});
	it('rejects a large advertised response before reading it', async () => {
		const cancel = vi.fn();
		await expect(readLimitedText(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Length': '1000' } }), 8)).rejects.toMatchObject({ code: 'response_too_large' });
		expect(cancel).toHaveBeenCalledTimes(1);
	});
	it('handles multibyte UTF-8 at byte boundaries', async () => {
		const bytes = new TextEncoder().encode('Café');
		const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
		await expect(readLimitedText(new Response(stream), bytes.length)).resolves.toBe('Café');
	});
	it('does not retry response-size failures', async () => {
		const fetch = vi.fn(async () => new Response('too much data'));
		vi.stubGlobal('fetch', fetch); vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(fetchText('https://map.test', { maxBytes: 2, retries: 2 })).rejects.toMatchObject({ code: 'response_too_large' });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('logs the host and network code without credentials or response bodies', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed secret-value', { cause: { code: 'ENETUNREACH' } }); }));
		const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(fetchText('https://map.test/private-token?key=secret', { retries: 0 })).rejects.toThrow();
		expect(log).toHaveBeenCalledWith('MapMind upstream request failed', expect.objectContaining({ host: 'map.test', code: 'ENETUNREACH' }));
		expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private-token/);
	});
	it.each([429, 502, 504])('logs upstream HTTP %s without response bodies', async status => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('private upstream body', { status })));
		const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(fetchText('https://map.test', { retries: 0 })).rejects.toMatchObject({ status });
		expect(log).toHaveBeenCalledWith('MapMind upstream request failed', expect.objectContaining({ host: 'map.test', status }));
		expect(JSON.stringify(log.mock.calls)).not.toContain('private upstream body');
	});

	it('does not start a request after cancellation', async () => {
		const controller = new AbortController(); controller.abort();
		const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
		await expect(withRequestSignal(controller.signal, () => fetchText('https://map.test'))).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetch).not.toHaveBeenCalled();
	});
	it('extracts useful codes from IPv4/IPv6 aggregate errors', () => {
		expect(networkErrorCode(new TypeError('fetch failed', { cause: { errors: [{ code: 'ENETUNREACH' }, { code: 'ETIMEDOUT' }] } }))).toBe('ENETUNREACH,ETIMEDOUT');
	});
});
