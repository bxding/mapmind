import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_USEFUL_VALUE, checkTag } from './checkTag';
import { fetchJson } from '$lib/agent/net';

vi.mock('$lib/agent/net', async () => ({
	// Pass straight through: the cache is not what these tests are about.
	cached: async (_ns: string, _key: string, _ttl: number, produce: () => Promise<unknown>) => produce(),
	fetchJson: vi.fn(),
	taginfoLimit: <T>(fn: () => Promise<T>) => fn(),
	DAY_MS: 86_400_000
}));

const json = vi.mocked(fetchJson);

const stats = (count: number) => ({ data: [{ type: 'all', count }] });
const values = (rows: [string, number][]) => ({
	data: rows.map(([value, count]) => ({ value, count }))
});

beforeEach(() => json.mockReset());

describe('checkTag', () => {
	it('accepts a tag in common use', async () => {
		json.mockResolvedValueOnce(stats(649_795));
		const check = await checkTag('amenity', 'cafe');
		expect(check).toMatchObject({ key: 'amenity', value: 'cafe', count: 649_795, ok: true });
		expect(check.suggestions).toBeUndefined();
	});

	it('rejects a value that exists but is really a mistagging, and suggests real ones', async () => {
		// building=dorm is 2 objects in the live database; building=dormitory is ~75k.
		json
			.mockResolvedValueOnce(stats(2))
			.mockResolvedValueOnce(values([['house', 9_000_000], ['dormitory', 75_363]]));

		const check = await checkTag('building', 'dorm');
		expect(check.ok).toBe(false);
		expect(check.rare).toBe(true);
		expect(check.suggestions?.map((s) => s.value)).toContain('dormitory');
	});

	it('does not flag a missing tag as merely rare', async () => {
		json.mockResolvedValueOnce(stats(0)).mockResolvedValueOnce(values([]));
		const check = await checkTag('amenity', 'not_a_real_value');
		expect(check.ok).toBe(false);
		expect(check.rare).toBeUndefined();
	});

	it('still answers when the suggestion lookup fails', async () => {
		json.mockResolvedValueOnce(stats(3)).mockRejectedValueOnce(new Error('taginfo down'));
		const check = await checkTag('building', 'dorm');
		expect(check.ok).toBe(false);
		expect(check.suggestions).toEqual([]);
	});

	it('uses the key endpoint and a lower bar when no value is given', async () => {
		json.mockResolvedValueOnce(stats(12));
		const check = await checkTag('outdoor_seating');
		expect(json.mock.calls[0]![0]).toContain('/key/stats');
		expect(check.ok).toBe(true);
		expect(MIN_USEFUL_VALUE).toBeGreaterThan(10);
	});

	it('requires a key', async () => {
		await expect(checkTag('  ')).rejects.toThrow(/key is required/);
	});
});
