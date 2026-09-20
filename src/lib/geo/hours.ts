import type { MapElement } from '$lib/agent/events';

/**
 * Overpass cannot answer "open past 9pm" — `opening_hours` is free text, not a queryable
 * number. So we fetch the tag and decide here. Deliberately a small subset of the
 * opening_hours spec: explicit HH:MM-HH:MM spans, 24/7, and after-midnight wraps.
 */

const TIME_SPAN = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;

export function parseClock(text: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 24 || minutes > 59) return null;
	return hours * 60 + minutes;
}

/**
 * Is the place open at `minute` (minutes after midnight)?
 * `null` means the tag is missing or we cannot parse it — the caller decides,
 * because silently dropping unknowns empties a map that is mostly untagged.
 */
export function opensPast(openingHours: string | undefined, minute: number): boolean | null {
	if (!openingHours) return null;
	const value = openingHours.trim();
	if (!value || value.toLowerCase() === 'off') return null;
	if (value.includes('24/7')) return true;

	const spans = [...value.matchAll(TIME_SPAN)];
	if (!spans.length) return null;

	for (const span of spans) {
		const start = Number(span[1]) * 60 + Number(span[2]);
		const end = Number(span[3]) * 60 + Number(span[4]);
		// 20:00-02:00 wraps past midnight, so anything at or after opening still counts.
		if (end <= start) {
			if (minute >= start || minute < end) return true;
		} else if (minute >= start && minute < end) {
			return true;
		}
	}
	return false;
}

export type HoursSplit = {
	open: MapElement[];
	closed: MapElement[];
	unknown: MapElement[];
};

export function splitByHours(elements: MapElement[], minute: number): HoursSplit {
	const split: HoursSplit = { open: [], closed: [], unknown: [] };
	for (const el of elements) {
		const verdict = opensPast(el.tags?.opening_hours, minute);
		if (verdict === true) split.open.push(el);
		else if (verdict === false) split.closed.push(el);
		else split.unknown.push(el);
	}
	return split;
}

/** "open past 9pm", "after 21:00", "open late" -> minutes after midnight. */
export function parseLateThreshold(text: string): number | null {
	const lowered = text.toLowerCase();
	const explicit =
		/(?:past|after|until|til|till|beyond)\s+(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?/.exec(lowered);
	if (explicit) {
		let hours = Number(explicit[1]);
		const minutes = Number(explicit[2] ?? 0);
		const meridiem = explicit[3];
		if (meridiem === 'pm' && hours < 12) hours += 12;
		if (meridiem === 'am' && hours === 12) hours = 0;
		// "open past 9" with no am/pm means the evening.
		if (!meridiem && hours <= 11) hours += 12;
		return hours * 60 + minutes;
	}
	if (/\b(open late|late night|late-night|nightlife)\b/.test(lowered)) return 22 * 60;
	return null;
}
