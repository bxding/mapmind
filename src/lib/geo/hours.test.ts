import { describe, expect, it } from 'vitest';
import { opensPast, parseClock, parseLateThreshold, splitByHours } from './hours';
import type { MapElement } from '$lib/agent/events';

const NINE_PM = 21 * 60;

describe('parseClock', () => {
	it('parses valid times and rejects junk', () => {
		expect(parseClock('09:30')).toBe(570);
		expect(parseClock('24:00')).toBe(1440);
		expect(parseClock('9.30')).toBeNull();
		expect(parseClock('99:99')).toBeNull();
	});
});

describe('opensPast', () => {
	it('treats 24/7 as always open', () => {
		expect(opensPast('24/7', NINE_PM)).toBe(true);
	});

	it('handles a plain span', () => {
		expect(opensPast('Mo-Fr 08:00-22:00', NINE_PM)).toBe(true);
		expect(opensPast('Mo-Fr 08:00-17:00', NINE_PM)).toBe(false);
	});

	it('uses the latest span when several are listed', () => {
		expect(opensPast('Mo-Fr 08:00-17:00; Sa 18:00-23:00', NINE_PM)).toBe(true);
	});

	it('handles spans that wrap past midnight', () => {
		expect(opensPast('Th-Sa 20:00-02:00', NINE_PM)).toBe(true);
		expect(opensPast('Th-Sa 20:00-02:00', 60)).toBe(true);
		expect(opensPast('Th-Sa 20:00-02:00', 10 * 60)).toBe(false);
	});

	it('returns null when the tag is missing or unparseable', () => {
		expect(opensPast(undefined, NINE_PM)).toBeNull();
		expect(opensPast('sunrise-sunset', NINE_PM)).toBeNull();
		expect(opensPast('off', NINE_PM)).toBeNull();
	});
});

describe('splitByHours', () => {
	it('separates open, closed, and untagged elements', () => {
		const elements: MapElement[] = [
			{ id: 1, type: 'node', tags: { opening_hours: '24/7' } },
			{ id: 2, type: 'node', tags: { opening_hours: 'Mo-Su 07:00-15:00' } },
			{ id: 3, type: 'node', tags: { name: 'no hours' } }
		];
		const split = splitByHours(elements, NINE_PM);
		expect(split.open.map((e) => e.id)).toEqual([1]);
		expect(split.closed.map((e) => e.id)).toEqual([2]);
		expect(split.unknown.map((e) => e.id)).toEqual([3]);
	});
});

describe('parseLateThreshold', () => {
	it('reads the demo follow-up', () => {
		expect(parseLateThreshold('only ones open past 9pm')).toBe(NINE_PM);
	});

	it('handles explicit 24h times and bare evening hours', () => {
		expect(parseLateThreshold('open after 22:30')).toBe(22 * 60 + 30);
		expect(parseLateThreshold('still open past 10')).toBe(22 * 60);
	});

	it('falls back to 22:00 for vague lateness and null otherwise', () => {
		expect(parseLateThreshold('somewhere open late')).toBe(22 * 60);
		expect(parseLateThreshold('cafes in Blacksburg')).toBeNull();
	});
});
