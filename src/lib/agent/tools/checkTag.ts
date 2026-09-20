import { DAY_MS, cached, fetchJson, taginfoLimit } from '$lib/agent/net';

const TAGINFO = 'https://taginfo.openstreetmap.org/api/4';

export type TagCheck = {
	key: string;
	value?: string;
	count: number;
	ok: boolean;
	/** Exists in OSM, but too rare to build a query on — almost always a mistagging. */
	rare?: boolean;
	/** Popular values for the key, offered when the key/value pair looks wrong. */
	suggestions?: { value: string; count: number }[];
};

/**
 * "Does it exist" is the wrong bar: building=dorm exists (2 objects) and building=dormitory
 * is the real tag (75k). Genuine tags land orders of magnitude above these thresholds, so
 * anything below is treated as a typo and answered with real alternatives.
 */
export const MIN_USEFUL_VALUE = 50;
export const MIN_USEFUL_KEY = 10;

type StatsResponse = { data?: { type?: string; count?: number }[] };
type ValuesResponse = { data?: { value?: string; count?: number }[] };

/** taginfo splits counts per element type; "all" is the total we care about. */
function totalFrom(payload: StatsResponse): number {
	const all = payload.data?.find((row) => row.type === 'all');
	if (all?.count != null) return all.count;
	return payload.data?.reduce((sum, row) => sum + (row.count ?? 0), 0) ?? 0;
}

async function topValues(key: string): Promise<{ value: string; count: number }[]> {
	const url = `${TAGINFO}/key/values?${new URLSearchParams({
		key,
		page: '1',
		rp: '12',
		sortname: 'count_all',
		sortorder: 'desc'
	})}`;
	try {
		const payload = await cached('taginfo-values', url, 7 * DAY_MS, () =>
			taginfoLimit(() => fetchJson<ValuesResponse>(url, { timeoutMs: 20_000 }))
		);
		return (payload.data ?? [])
			.filter((row) => row.value)
			.map((row) => ({ value: row.value as string, count: row.count ?? 0 }));
	} catch {
		return [];
	}
}

/**
 * Is this key (or key=value) actually in common use in OSM?
 * The cheap guard against the model inventing tags like `building=dorm`.
 */
export async function checkTag(key: string, value?: string): Promise<TagCheck> {
	const trimmedKey = key.trim();
	if (!trimmedKey) throw new Error('checkTag: key is required');
	const trimmedValue = value?.trim() || undefined;

	const url = trimmedValue
		? `${TAGINFO}/tag/stats?${new URLSearchParams({ key: trimmedKey, value: trimmedValue })}`
		: `${TAGINFO}/key/stats?${new URLSearchParams({ key: trimmedKey })}`;

	const payload = await cached('taginfo', url, 7 * DAY_MS, () =>
		taginfoLimit(() => fetchJson<StatsResponse>(url, { timeoutMs: 20_000 }))
	);

	const count = totalFrom(payload);
	const threshold = trimmedValue ? MIN_USEFUL_VALUE : MIN_USEFUL_KEY;
	const ok = count >= threshold;
	const check: TagCheck = { key: trimmedKey, value: trimmedValue, count, ok };
	if (count > 0 && !ok) check.rare = true;
	if (!ok && trimmedValue) check.suggestions = await topValues(trimmedKey);
	return check;
}
