import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertRunnable, runOverpass } from './runOverpass';
import { fetchText, HttpError } from '$lib/agent/net';
import { ServiceError } from '../errors';
import { withRequestSignal } from '../requestContext.server';
vi.mock('../overpassServers', () => ({ overpassServers: () => ['https://primary.test/api/interpreter', 'https://backup.test/api/interpreter'] }));

vi.mock('$lib/agent/net', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/agent/net')>()),
	cached: async (_ns: string, _key: string, _ttl: number, produce: () => Promise<unknown>) => produce(),
	fetchText: vi.fn(),
	overpassLimit: <T>(fn: () => Promise<T>) => fn(),
	DAY_MS: 86_400_000
}));

const http = vi.mocked(fetchText);

let testTime = Date.now();
beforeEach(() => { http.mockReset(); testTime += 600000; vi.spyOn(Date, 'now').mockReturnValue(testTime); });
afterEach(() => vi.restoreAllMocks());

describe('assertRunnable', () => {
	it('blocks Overpass Turbo shortcuts the real API rejects', () => {
		expect(() => assertRunnable('{{geocodeArea:"Blacksburg"}}->.a;')).toThrow(/Turbo shortcut/);
		expect(() => assertRunnable('nwr["amenity"="cafe"](area.searchArea);')).not.toThrow();
	});
});

describe('runOverpass', () => {
	it('parses elements and reads the centre of a way', async () => {
		http.mockResolvedValueOnce(
			JSON.stringify({
				elements: [{ id: 5, type: 'way', center: { lat: 37.2, lon: -80.4 }, tags: { amenity: 'cafe' } }]
			})
		);
		const run = await runOverpass('nwr["amenity"="cafe"](37,-81,38,-80);out center;');
		expect(run.count).toBe(1);
		expect(run.elements[0]).toMatchObject({ id: 5, lat: 37.2, lon: -80.4 });
	});

	it('preserves upstream road geometry and rejects invalid coordinates', async () => {
		http.mockResolvedValueOnce(JSON.stringify({ elements: [{ id: 5, type: 'way', geometry: [{ lat: 37, lon: -80 }, { lat: 37.1, lon: -80.1 }] }] }));
		expect((await runOverpass('out geom;')).elements[0].geometry?.type).toBe('LineString');
		http.mockResolvedValueOnce(JSON.stringify({ elements: [{ id: 5, type: 'way', geometry: [{ lat: 999, lon: 0 }] }] }));
		await expect(runOverpass('out geom;')).rejects.toThrow(/geometry/);
	});

	it('reads the total out of an out count; response', async () => {
		http.mockResolvedValueOnce(
			JSON.stringify({ elements: [{ id: 0, type: 'count', tags: { total: '42' } }] })
		);
		const run = await runOverpass('out count;');
		expect(run.count).toBe(42);
		expect(run.elements).toEqual([]);
	});

	it('treats a timeout remark as a failure, not as an empty result', async () => {
		// Overpass answers 200 OK here, so an unchecked caller would report "nothing found".
		http.mockResolvedValueOnce(
			JSON.stringify({
				elements: [],
				remark: 'runtime error: Query timed out in "query" at line 4 after 26 seconds.'
			})
		);
		await expect(runOverpass('nwr["amenity"="cafe"];out;')).rejects.toThrow(/timed out/);
	});

	it('replaces upstream remarks with a safe note', async () => {
		http.mockResolvedValueOnce(JSON.stringify({ elements: [], remark: 'data is from OSM' }));
		const run = await runOverpass('nwr["amenity"="cafe"];out;');
		expect(run.count).toBe(0);
		expect(run.remark).toBe('OpenStreetMap data may be incomplete.');
	});

	it('explains a non-JSON response instead of throwing a parse error', async () => {
		http.mockResolvedValueOnce('<html>502 Bad Gateway</html>');
		await expect(runOverpass('out;')).rejects.toThrow(/non-JSON/);
	});
	it('never returns HTML from a 504 response', async () => {
		http.mockRejectedValue(new HttpError(504, '<html>private upstream diagnostics</html>', 'https://upstream.invalid'));
		await expect(runOverpass('out;')).rejects.toThrow('busy or responding too slowly');
	});
	it('retains the timeout diagnosis during cooldown instead of blaming outbound connectivity', async () => {
		http.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
		await expect(runOverpass('query one')).rejects.toThrow('responding too slowly');
		await expect(runOverpass('query two')).rejects.toThrow('responding too slowly');
		expect(http).toHaveBeenCalledTimes(2);
	});

	it('rejects malformed payloads instead of reporting empty results', async () => {
		http.mockResolvedValueOnce(JSON.stringify({ unexpected: true }));
		await expect(runOverpass('out;')).rejects.toThrow('invalid response');
	});


	it('tries the backup once when the primary cannot connect', async () => {
		http.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(JSON.stringify({ elements: [{ id: 1, type: 'node', lat: 37.2, lon: -80.4 }] }));
		const result = await runOverpass('out center;');
		expect(result.elements).toHaveLength(1);
		expect(http.mock.calls.map(call => call[0])).toEqual(['https://primary.test/api/interpreter', 'https://backup.test/api/interpreter']);
		expect(http.mock.calls.every(call => call[1]?.retries === 0)).toBe(true);
	});
	it('cools down a rate-limited endpoint across subsequent queries', async () => {
		http.mockRejectedValueOnce(new HttpError(429, 'private diagnostic', 'https://primary.test')).mockResolvedValue(JSON.stringify({ elements: [] }));
		await runOverpass('query one'); await runOverpass('query two');
		expect(http.mock.calls.map(call => call[0])).toEqual(['https://primary.test/api/interpreter', 'https://backup.test/api/interpreter', 'https://backup.test/api/interpreter']);
	});
	it('does not retry an oversized response on another host', async () => {
		http.mockRejectedValue(new ServiceError('response_too_large', 'Response too large'));
		await expect(runOverpass('out;')).rejects.toMatchObject({ code: 'response_too_large' });
		expect(http).toHaveBeenCalledTimes(1);
	});
	it('does not fail over after user cancellation', async () => {
		const controller = new AbortController();
		http.mockImplementationOnce(async () => { controller.abort(); throw new TypeError('fetch failed'); });
		await expect(withRequestSignal(controller.signal, () => runOverpass('out;'))).rejects.toMatchObject({ name: 'AbortError' });
		expect(http).toHaveBeenCalledTimes(1);
	});

});

const TEST_MIRRORS = ['https://primary.test/api/interpreter', 'https://backup.test/api/interpreter'];
describe('mirror failover', () => {
	const ok = JSON.stringify({ elements: [{ id: 1, type: 'node', lat: 1, lon: 2 }] });

	it('moves to the next mirror when one is rate limited', async () => {
		http
			.mockRejectedValueOnce(new HttpError(429, 'slow down', TEST_MIRRORS[0]!))
			.mockResolvedValueOnce(ok);

		const run = await runOverpass('out center;');
		expect(run.count).toBe(1);
		expect(http).toHaveBeenCalledTimes(2);
		expect(http.mock.calls[0]![0]).toBe(TEST_MIRRORS[0]);
		expect(http.mock.calls[1]![0]).toBe(TEST_MIRRORS[1]);
	});

	it('does not burn every mirror on a query that is simply wrong', async () => {
		http.mockResolvedValue('<html>not json</html>');
		await expect(runOverpass('out center;')).rejects.toThrow(/non-JSON/);
		expect(http).toHaveBeenCalledTimes(1);
	});

	it('gives up with the last error when every mirror is down', async () => {
		// One rejection per mirror, each consumed exactly once. A persistent
		// mockImplementation leaves a rejected promise behind that Node reports
		// as unhandled after the test ends.
		for (const _mirror of TEST_MIRRORS) {
			http.mockRejectedValueOnce(new HttpError(504, 'busy', 'overpass'));
		}
		let caught: unknown;
		try {
			await runOverpass('out center;');
		} catch (err) {
			caught = err;
		}
		expect((caught as Error).message).toMatch(/busy or responding too slowly/);
		expect(http).toHaveBeenCalledTimes(TEST_MIRRORS.length);
	});
});

describe('preferred mirror', () => {
	it('reuses the working backup even after the failed primary cooldown expires', async () => {
		http.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(JSON.stringify({ elements: [] }));
		await runOverpass('first');
		vi.mocked(Date.now).mockReturnValue(testTime + 31000);
		await runOverpass('second');
		expect(http.mock.calls.map(call => call[0])).toEqual([TEST_MIRRORS[0], TEST_MIRRORS[1], TEST_MIRRORS[1]]);
	});
});
