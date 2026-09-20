import { checkCancelled, requestSignal } from './requestContext.server';
import { ServiceError } from './errors';
import { MAX_RESPONSE_BYTES } from './limits';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Nominatim and taginfo both ask for a real contact string. Reuse the Overpass one. */
import { USER_AGENT } from '$lib/overpass';
export { USER_AGENT };

const CACHE_DIR = path.resolve('.cache');

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly body: string,
		url: string
	) {
		super(`Map data service returned HTTP ${status}.`);
		this.name = 'HttpError';
	}
}

const sleep = (ms: number) => new Promise<void>((resolve, reject) => {
	const signal = requestSignal();
	if (signal?.aborted) { reject(signal.reason); return; }
	const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
	function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); }
	signal?.addEventListener('abort', abort, { once: true });
});

/**
 * Serializes calls to one host and keeps at least `minIntervalMs` between them.
 * Nominatim's usage policy is one request per second; taginfo asks for restraint.
 */
function rateLimiter(minIntervalMs: number) {
	let last = 0;
	let chain: Promise<unknown> = Promise.resolve();
	return function limit<T>(fn: () => Promise<T>): Promise<T> {
		const run = chain.then(async () => {
			checkCancelled();
			const wait = last + minIntervalMs - Date.now();
			if (wait > 0) await sleep(wait);
			checkCancelled();
			last = Date.now();
			return fn();
		});
		chain = run.catch(() => undefined);
		return run;
	};
}

export const nominatimLimit = rateLimiter(1100);
export const taginfoLimit = rateLimiter(250);
export const overpassLimit = rateLimiter(1000);

export type FetchOptions = {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	/** Retries once on 429/5xx/network error. */
	retries?: number;
	maxBytes?: number;
};

export function networkErrorCode(error: unknown): string {
	if (!error || typeof error !== 'object') return 'UNKNOWN';
	const item = error as { code?: string; name?: string; cause?: unknown; errors?: unknown[] };
	if (typeof item.code === 'string') return item.code;
	if (item.errors?.length) return [...new Set(item.errors.map(networkErrorCode))].join(',');
	if (item.cause) return networkErrorCode(item.cause);
	return item.name ?? 'UNKNOWN';
}

export async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
	const tooLarge = () => new ServiceError('response_too_large', 'The map response is too large. Zoom in or add a more specific filter.');
	if (Number(response.headers.get('content-length')) > maxBytes) {
		await response.body?.cancel(); throw tooLarge();
	}
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let size = 0, text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return text + decoder.decode();
			size += value.byteLength;
			if (size > maxBytes) { await reader.cancel(); throw tooLarge(); }
			text += decoder.decode(value, { stream: true });
		}
	} finally { reader.releaseLock(); }
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
	const { method = 'GET', headers = {}, body, timeoutMs = 30_000, retries = 1, maxBytes = MAX_RESPONSE_BYTES } = options;
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		checkCancelled();
		if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(url, {
				method,
				headers: { 'User-Agent': USER_AGENT, ...headers },
				body,
				signal: requestSignal() ? AbortSignal.any([controller.signal, requestSignal()!]) : controller.signal
			});
			const text = await readLimitedText(res, maxBytes);
			if (res.ok) return text;
			// Route every HTTP failure through the same logging/retry path, including 429/5xx.
			throw new HttpError(res.status, text, url);
		} catch (err) {
			checkCancelled();
			console.warn('MapMind upstream request failed', { host: new URL(url).hostname, code: networkErrorCode(err), status: err instanceof HttpError ? err.status : undefined, attempt: attempt + 1 });
			if (err instanceof ServiceError || (err instanceof HttpError && err.status !== 429 && err.status < 500)) throw err;
			lastError = err;
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
	const text = await fetchText(url, options);
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error('Map data service returned an invalid response.');
	}
}

type CacheEnvelope<T> = { at: number; value: T };

function cachePath(namespace: string, key: string): string {
	const hash = createHash('sha256').update(key).digest('hex').slice(0, 32);
	return path.join(CACHE_DIR, `${namespace}-${hash}.json`);
}

/**
 * Disk-backed memo in `.cache/` (gitignored). Every filesystem error is swallowed:
 * a cold or read-only cache must never fail a live request.
 */
export async function cached<T>(
	namespace: string,
	key: string,
	ttlMs: number,
	produce: () => Promise<T>
): Promise<T> {
	checkCancelled();
	const file = cachePath(namespace, key);
	try {
		if ((await stat(file)).size > MAX_RESPONSE_BYTES) throw new Error('Cached response is too large');
		const raw = await readFile(file, 'utf8');
		const envelope = JSON.parse(raw) as CacheEnvelope<T>;
		if (Date.now() - envelope.at < ttlMs) return envelope.value;
	} catch {
		// cache miss, unreadable, or stale JSON — fall through to the live call
	}
	const value = await produce();
	try {
		await mkdir(CACHE_DIR, { recursive: true });
		await writeFile(file, JSON.stringify({ at: Date.now(), value } satisfies CacheEnvelope<T>));
	} catch {
		// non-fatal
	}
	return value;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
