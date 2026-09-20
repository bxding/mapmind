import { validateGeometry } from '$lib/geo/geometry';
import { ServiceError } from '../errors';
import { checkCancelled } from '../requestContext.server';
import { overpassServers } from '../overpassServers';
export { DEFAULT_OVERPASS_URLS as OVERPASS_MIRRORS } from '../overpassServers';
import type { MapElement } from '$lib/agent/events';
import { countFromPayload, toMapElements, type OverpassResponse } from '$lib/overpass';
import { DAY_MS, cached, fetchText, overpassLimit, HttpError, networkErrorCode } from '$lib/agent/net';

const ERROR_REMARK = /error|timed out|out of memory|too many|exceeded/i;

export type OverpassRun = {
	count: number;
	elements: MapElement[];
	remark: string | null;
};

/** Overpass Turbo shortcuts are not valid Overpass API — catch them before we spend a slot. */
export function assertRunnable(oql: string): void {
	if (oql.includes('{{')) {
		throw new Error(
			'Query still contains an Overpass Turbo shortcut ({{geocodeArea}} / {{bbox}}). Resolve places to area ids with findPlace first.'
		);
	}
}

// Cool down unreachable/busy hosts rather than retrying the same host for every tool call.
type FailureKind = 'busy' | 'timeout' | 'connection';
const unavailableUntil = new Map<string, { until: number; kind: FailureKind }>();
let preferred: { url: string; until: number } | undefined;

async function fetchOverpass(oql: string): Promise<string> {
	const configured = overpassServers();
	const recent = preferred && preferred.until > Date.now() && configured.includes(preferred.url) ? preferred.url : undefined;
	const urls = recent ? [recent, ...configured.filter(url => url !== recent)] : configured;
	const failures: FailureKind[] = [];
	for (const url of urls) {
		checkCancelled();
		const recentFailure = unavailableUntil.get(url);
		if (recentFailure && recentFailure.until > Date.now()) { failures.push(recentFailure.kind); continue; }
		try {
			const text = await overpassLimit(() => fetchText(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ data: oql }).toString(),
				timeoutMs: 40_000,
				retries: 0
			}));
			preferred = { url, until: Date.now() + 300_000 };
			return text;
		} catch (err) {
			checkCancelled();
			if (err instanceof ServiceError) throw err;
			if (err instanceof HttpError && err.status < 500 && ![403, 406, 408, 429].includes(err.status)) {
				throw new ServiceError('overpass_query_failed', 'The map service rejected the query. Try more specific filters or a smaller area.');
			}
			const kind: FailureKind = err instanceof HttpError && (err.status >= 500 || [406, 429].includes(err.status)) ? 'busy'
				: /timeout|timedout|abort/i.test(networkErrorCode(err)) ? 'timeout' : 'connection';
			failures.push(kind);
			unavailableUntil.set(url, { until: Date.now() + 30_000, kind });
		}
	}
	const message = failures.some(kind => kind === 'busy' || kind === 'timeout')
		? 'The OpenStreetMap query services are busy or responding too slowly. Please retry in 30 seconds.'
		: 'The server could not connect to an OpenStreetMap query service. Please retry in 30 seconds.';
	throw new ServiceError('overpass_unavailable', message);
}

/**
 * Runs OverpassQL against the public API. Same transport as /api/overpass, but callable
 * from server-side agent code (which has no origin to fetch its own route from).
 * Cached for an hour so a retry loop does not hammer a shared endpoint.
 */
export async function runOverpass(oql: string, ttlMs = DAY_MS / 24): Promise<OverpassRun> {
	assertRunnable(oql);
	return cached('overpass-v4', oql, ttlMs, async () => {
		const text = await fetchOverpass(oql);
		let payload: OverpassResponse;
		try { payload = JSON.parse(text) as OverpassResponse; }
		catch { throw new ServiceError('overpass_invalid', 'Overpass returned a non-JSON response. Please retry shortly.'); }
		if (!payload || !Array.isArray(payload.elements)) throw new ServiceError('overpass_invalid', 'Overpass returned an invalid response.');
		if (payload.remark && ERROR_REMARK.test(payload.remark)) {
			throw new ServiceError('overpass_query_failed', /timed out/i.test(payload.remark)
				? 'Overpass timed out. Narrow the search area or simplify the filters.'
				: 'Overpass could not execute the query within its memory limit. Narrow the area or add more specific filters.');
		}
		if (payload.elements.length > 2000) throw new ServiceError('response_too_large', 'The map service returned too many places. Narrow the area or filters.');
		for (const el of payload.elements) {
			if (!el || !Number.isSafeInteger(el.id) || !['node', 'way', 'relation', 'count'].includes(el.type) ||
				(el.tags && (typeof el.tags !== 'object' || Object.values(el.tags).some((v) => typeof v !== 'string'))) ||
				(el.lat != null && (!Number.isFinite(el.lat) || Math.abs(el.lat) > 90)) ||
				(el.lon != null && (!Number.isFinite(el.lon) || Math.abs(el.lon) > 180)) ||
				(el.center && (!Number.isFinite(el.center.lat) || Math.abs(el.center.lat) > 90 || !Number.isFinite(el.center.lon) || Math.abs(el.center.lon) > 180))) {
				throw new ServiceError('overpass_invalid', 'Overpass returned invalid map data.');
			}
		}
		try { validateGeometry(payload.elements); }
		catch { throw new ServiceError('response_too_large', 'The map geometry is too large or incomplete. Narrow the area or use more specific filters.'); }
		const isCountOnly = payload.elements.length > 0 && payload.elements.every((el) => el.tags && 'total' in el.tags && (el.type as string) === 'count');
		const elements = isCountOnly ? [] : toMapElements(payload);
		const count = isCountOnly ? (countFromPayload(payload) ?? 0) : elements.length;
		if (!Number.isSafeInteger(count) || count < 0) throw new ServiceError('overpass_invalid', 'Overpass returned an invalid count.');
		return { count, elements, remark: payload.remark ? 'OpenStreetMap data may be incomplete.' : null };
	});
}
