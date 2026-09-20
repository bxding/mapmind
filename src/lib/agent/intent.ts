import { parseLateThreshold } from '$lib/geo/hours';
import type { Plan, Scope, TagFilter } from '$lib/oql/plan';

/**
 * A deterministic English -> Plan parser.
 *
 * This is NOT the product — Qwen is. It exists because a hackathon demo cannot depend on
 * a remote model staying up, and because it gives us something to unit test offline.
 * The loop tries the model first and falls back here.
 */

export type Category = { label: string; filters: TagFilter[] };

const eq = (key: string, value: string): TagFilter => ({ key, op: '=', value });

/** Lowercase and strip diacritics so "Cafés", "cafes" and "café" all hit one pattern. */
export function normalizeText(text: string): string {
	return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Most specific first: "fast food" must beat "food", "coffee shop" must beat "shop". */
const LEXICON: { pattern: RegExp; category: Category }[] = [
	{ pattern: /\bfast[- ]food\b/, category: { label: 'fast food', filters: [eq('amenity', 'fast_food')] } },
	{ pattern: /\b(cafes?|coffee(?:\s+shops?)?|espresso)\b/, category: { label: 'café', filters: [eq('amenity', 'cafe')] } },
	{ pattern: /\b(dorms?|dormitor(?:y|ies)|residence halls?)\b/, category: { label: 'dorm', filters: [eq('building', 'dormitory')] } },
	{ pattern: /\b(restaurants?|dining|places to eat)\b/, category: { label: 'restaurant', filters: [eq('amenity', 'restaurant')] } },
	{ pattern: /\bpubs?\b/, category: { label: 'pub', filters: [eq('amenity', 'pub')] } },
	{ pattern: /\b(bars?|breweries|brewery)\b/, category: { label: 'bar', filters: [eq('amenity', 'bar')] } },
	{ pattern: /\blibrar(?:y|ies)\b/, category: { label: 'library', filters: [eq('amenity', 'library')] } },
	{ pattern: /\b(bicycle|bike)\s+(?:parking|racks?)\b/, category: { label: 'bike parking', filters: [eq('amenity', 'bicycle_parking')] } },
	{ pattern: /\b(bike|bicycle)\s+shops?\b/, category: { label: 'bike shop', filters: [eq('shop', 'bicycle')] } },
	{ pattern: /\bparking\b/, category: { label: 'parking', filters: [eq('amenity', 'parking')] } },
	{ pattern: /\bbenches?\b/, category: { label: 'bench', filters: [eq('amenity', 'bench')] } },
	{ pattern: /\b(toilets?|restrooms?|bathrooms?)\b/, category: { label: 'toilets', filters: [eq('amenity', 'toilets')] } },
	{ pattern: /\b(drinking water|water fountains?|bottle fill)\b/, category: { label: 'drinking water', filters: [eq('amenity', 'drinking_water')] } },
	{ pattern: /\batms?\b/, category: { label: 'ATM', filters: [eq('amenity', 'atm')] } },
	{ pattern: /\bbanks?\b/, category: { label: 'bank', filters: [eq('amenity', 'bank')] } },
	{ pattern: /\b(pharmac(?:y|ies)|drug ?stores?)\b/, category: { label: 'pharmacy', filters: [eq('amenity', 'pharmacy')] } },
	{ pattern: /\bhospitals?\b/, category: { label: 'hospital', filters: [eq('amenity', 'hospital')] } },
	{ pattern: /\b(supermarkets?|grocer(?:y|ies)|grocery stores?)\b/, category: { label: 'supermarket', filters: [eq('shop', 'supermarket')] } },
	{ pattern: /\b(convenience stores?|corner stores?)\b/, category: { label: 'convenience store', filters: [eq('shop', 'convenience')] } },
	{ pattern: /\b(book ?stores?|book ?shops?)\b/, category: { label: 'bookshop', filters: [eq('shop', 'books')] } },
	{ pattern: /\b(gyms?|fitness)\b/, category: { label: 'gym', filters: [eq('leisure', 'fitness_centre')] } },
	{ pattern: /\bplaygrounds?\b/, category: { label: 'playground', filters: [eq('leisure', 'playground')] } },
	{ pattern: /\bparks?\b/, category: { label: 'park', filters: [eq('leisure', 'park')] } },
	{ pattern: /\bbus stops?\b/, category: { label: 'bus stop', filters: [eq('highway', 'bus_stop')] } },
	{ pattern: /\b(charging stations?|ev chargers?)\b/, category: { label: 'charging station', filters: [eq('amenity', 'charging_station')] } },
	{ pattern: /\bhotels?\b/, category: { label: 'hotel', filters: [eq('tourism', 'hotel')] } },
	{ pattern: /\bmuseums?\b/, category: { label: 'museum', filters: [eq('tourism', 'museum')] } },
	{ pattern: /\b(churches|church|places? of worship)\b/, category: { label: 'place of worship', filters: [eq('amenity', 'place_of_worship')] } },
	{ pattern: /\bpost offices?\b/, category: { label: 'post office', filters: [eq('amenity', 'post_office')] } },
	{ pattern: /\b(laundromats?|laundr(?:y|ies))\b/, category: { label: 'laundry', filters: [eq('shop', 'laundry')] } },
	{ pattern: /\b(hairdressers?|barbers?|salons?)\b/, category: { label: 'hairdresser', filters: [eq('shop', 'hairdresser')] } },
	{ pattern: /\b(gas stations?|fuel stations?|petrol)\b/, category: { label: 'fuel', filters: [eq('amenity', 'fuel')] } },
	{ pattern: /\bvending machines?\b/, category: { label: 'vending machine', filters: [eq('amenity', 'vending_machine')] } },
	{ pattern: /\b(trash|waste baskets?|garbage cans?)\b/, category: { label: 'waste basket', filters: [eq('amenity', 'waste_basket')] } },
	{ pattern: /\bschools?\b/, category: { label: 'school', filters: [eq('amenity', 'school')] } },
	{ pattern: /\buniversit(?:y|ies)\b/, category: { label: 'university', filters: [eq('amenity', 'university')] } },
	{ pattern: /\bshops?\b/, category: { label: 'shop', filters: [{ key: 'shop', op: 'exists' }] } },
	{ pattern: /\bbuildings?\b/, category: { label: 'building', filters: [{ key: 'building', op: 'exists' }] } }
];

const MODIFIERS: { pattern: RegExp; filter: TagFilter }[] = [
	{ pattern: /\boutdoor seating\b|\bpatio\b/, filter: eq('outdoor_seating', 'yes') },
	{ pattern: /\bwi-?fi\b|\binternet\b/, filter: { key: 'internet_access', op: '!=', value: 'no' } },
	{ pattern: /\bwheelchair(?:\s+accessible)?\b|\baccessible\b/, filter: eq('wheelchair', 'yes') },
	{ pattern: /\bvegan\b/, filter: eq('diet:vegan', 'yes') },
	{ pattern: /\bvegetarian\b/, filter: eq('diet:vegetarian', 'yes') },
	{ pattern: /\btake ?(?:away|out)\b/, filter: eq('takeaway', 'yes') },
	{ pattern: /\b24[/ ]?7\b|\bopen 24 hours\b/, filter: eq('opening_hours', '24/7') },
	{ pattern: /\bfree\b/, filter: eq('fee', 'no') },
	{ pattern: /\bcovered\b/, filter: eq('covered', 'yes') }
];

const RANK_SPLIT = /\b(?:the\s+)?(?:most|fewest|greatest|largest number of|highest number of)\b/i;

export function findCategory(text: string): Category | null {
	const normalized = normalizeText(text);
	for (const entry of LEXICON) {
		if (entry.pattern.test(normalized)) return entry.category;
	}
	return null;
}

/** "within 800 m", "1.5 km", "half a mile", "10 minute walk". */
export function parseRadius(text: string): number | null {
	const lowered = normalizeText(text);
	const walk = /(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*min(?:ute)?s?\s*(?:walk|walking)/.exec(lowered);
	// ~80 m/min is a normal walking pace; a "10 minute walk" is the 800 m in the demo.
	if (walk) return Math.round(Number(walk[1]) * 80);

	const km = /(\d+(?:\.\d+)?)\s*(?:km|kilometers?|kilometres?)\b/.exec(lowered);
	if (km) return Math.round(Number(km[1]) * 1000);

	const miles = /(\d+(?:\.\d+)?)\s*(?:mi|miles?)\b/.exec(lowered);
	if (miles) return Math.round(Number(miles[1]) * 1609.34);

	const metres = /(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)\b/.exec(lowered);
	if (metres) return Math.round(Number(metres[1]));

	const feet = /(\d+(?:\.\d+)?)\s*(?:ft|feet)\b/.exec(lowered);
	if (feet) return Math.round(Number(feet[1]) * 0.3048);

	return null;
}

const PLACE_STOPWORDS = new Set(['which', 'what', 'where', 'who', 'cafes', 'cafés', 'i', 'the']);

/** "at Virginia Tech", "in Blacksburg" — a run of capitalised words after a preposition. */
export function parsePlaceName(text: string): string | null {
	const matches = [...text.matchAll(/\b(?:at|in|near|around|on|by)\s+((?:[A-Z][\w'’.-]*)(?:\s+(?:of|de|la)\s+[A-Z][\w'’.-]*|\s+[A-Z][\w'’.-]*)*)/g)];
	for (const match of matches) {
		const candidate = match[1]?.trim();
		if (candidate && !PLACE_STOPWORDS.has(candidate.toLowerCase())) return candidate;
	}
	if (/\b(campus|virginia tech|vt)\b/i.test(text)) return 'Virginia Tech';
	if (/\bblacksburg\b/i.test(text)) return 'Blacksburg';
	return null;
}

export function parseModifiers(text: string): TagFilter[] {
	const lowered = normalizeText(text);
	return MODIFIERS.filter((entry) => entry.pattern.test(lowered)).map((entry) => entry.filter);
}

export type Intent = {
	target: Category | null;
	origin: Category | null;
	radius: number | null;
	placeName: string | null;
	modifiers: TagFilter[];
	lateMinute: number | null;
	ranking: boolean;
	/** True when the message only refines an existing plan ("only ones open past 9pm"). */
	refinement: boolean;
};

export function parseIntent(text: string): Intent {
	const normalized = normalizeText(text);
	const ranking = RANK_SPLIT.test(normalized) && /\b(which|what|whose)\b/.test(normalized);
	let target: Category | null = null;
	let origin: Category | null = null;

	if (ranking) {
		const at = normalized.search(RANK_SPLIT);
		// "Which DORM ... has the most CAFÉS" — the origin is named before the superlative.
		origin = findCategory(normalized.slice(0, at));
		target = findCategory(normalized.slice(at));
		if (!target) target = origin;
		if (target === origin) origin = null;
	} else {
		target = findCategory(text);
	}

	const modifiers = parseModifiers(normalized);
	const lateMinute = parseLateThreshold(normalized);
	return {
		target,
		origin,
		radius: parseRadius(text),
		placeName: parsePlaceName(text),
		modifiers,
		lateMinute,
		ranking: ranking && Boolean(origin),
		refinement: !target && (modifiers.length > 0 || lateMinute != null)
	};
}

export type PlanContext = {
	bbox?: { south: number; west: number; north: number; east: number };
	date?: string;
	adiff?: [string, string];
	previousPlan?: Plan;
};

function scopeFor(intent: Intent, context: PlanContext): Scope {
	if (intent.placeName) return { kind: 'place', name: intent.placeName };
	if (context.previousPlan) return context.previousPlan.scope;
	if (context.bbox) return { kind: 'bbox', ...context.bbox };
	return { kind: 'place', name: 'Blacksburg' };
}

function withTime(plan: Plan, context: PlanContext): Plan {
	const next = { ...plan };
	if (context.date) next.date = context.date;
	if (context.adiff) next.adiff = context.adiff;
	return next;
}

export type HeuristicPlan = {
	plan: Plan;
	targetLabel: string;
	/** Present only for "which X has the most Y" — X is fetched separately and ranked locally. */
	originPlan?: Plan;
	originLabel?: string;
	radius?: number;
	lateMinute: number | null;
	placeName: string | null;
};

/** English -> Plan without a model. Returns null when nothing recognisable was asked. */
export function heuristicPlan(text: string, context: PlanContext = {}): HeuristicPlan | null {
	const intent = parseIntent(text);

	// A pure refinement ("only ones open past 9pm") edits the plan we already ran.
	if (!intent.target && intent.refinement && context.previousPlan) {
		const previous = context.previousPlan;
		const sets = previous.sets.map((set, i) =>
			i === previous.sets.length - 1
				? { ...set, filters: [...set.filters, ...intent.modifiers] }
				: set
		);
		return {
			plan: withTime({ ...previous, sets }, context),
			targetLabel: 'result',
			lateMinute: intent.lateMinute,
			placeName: intent.placeName
		};
	}

	if (!intent.target) return null;

	const scope = scopeFor(intent, context);
	const plan: Plan = withTime(
		{
			scope,
			sets: [
				{
					name: 'targets',
					types: ['nwr'],
					filters: [...intent.target.filters, ...intent.modifiers],
					within: { kind: 'scope' }
				}
			],
			output: { mode: 'center', limit: 200 }
		},
		context
	);

	if (!intent.ranking || !intent.origin) {
		return {
			plan,
			targetLabel: intent.target.label,
			lateMinute: intent.lateMinute,
			placeName: intent.placeName
		};
	}

	const originPlan: Plan = withTime(
		{
			scope,
			sets: [
				{ name: 'origins', types: ['nwr'], filters: intent.origin.filters, within: { kind: 'scope' } }
			],
			output: { mode: 'center', limit: 200 }
		},
		context
	);

	return {
		plan,
		targetLabel: intent.target.label,
		originPlan,
		originLabel: intent.origin.label,
		radius: intent.radius ?? 800,
		lateMinute: intent.lateMinute,
		placeName: intent.placeName
	};
}
