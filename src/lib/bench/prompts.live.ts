import { describe, expect, it } from 'vitest';
import { compileAndRun } from '$lib/agent/tools/compileAndRun';
import { countNearby, elementLabel } from '$lib/geo/nearby';
import type { Plan, Scope } from '$lib/oql/plan';

/**
 * Presentation bench: the demo prompts, written as Plans and run against live Overpass.
 *
 * This measures what the COMPILER can express and what OSM actually holds — not whether
 * Qwen understands the English, which needs OPENWEBUI_API_KEY. Opt-in: `npm run test:prompts`.
 */

const box = (south: number, west: number, north: number, east: number): Scope => ({
	kind: 'bbox',
	south,
	west,
	north,
	east
});

const AREAS = {
	amsterdam: box(52.35, 4.85, 52.4, 4.95),
	berlin: box(52.48, 13.33, 52.55, 13.45),
	rome: box(41.87, 12.46, 41.92, 12.52),
	york: box(53.95, -1.1, 53.97, -1.07),
	nl: box(52.2, 4.4, 52.7, 5.4),
	bergen: box(60.3, 5.2, 60.45, 5.4)
};

type Probe = { id: number; title: string; where: string; plan: Plan };

const out = { mode: 'center' as const, limit: 30 };
const t = (key: string, value: string) => ({ key, op: '=' as const, value });
const re = (key: string, value: string) => ({ key, op: '~' as const, value });
const has = (key: string) => ({ key, op: 'exists' as const });

const PROBES: Probe[] = [
	{
		id: 1,
		title: 'Ghost railway network',
		where: 'Berlin',
		plan: {
			scope: AREAS.berlin,
			sets: [{ name: 'g', types: ['way'], filters: [re('railway', 'abandoned|disused|razed')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 2,
		title: 'Rivers that disappear into culverts',
		where: 'Berlin',
		plan: {
			scope: AREAS.berlin,
			sets: [{ name: 'w', types: ['way'], filters: [re('waterway', 'river|stream'), has('tunnel')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 5,
		title: 'The underground shopping city',
		where: 'Amsterdam',
		plan: {
			scope: AREAS.amsterdam,
			sets: [{ name: 'u', types: ['nwr'], filters: [has('shop'), t('location', 'underground')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 7,
		title: 'Surviving outline of a walled city',
		where: 'York',
		plan: {
			scope: AREAS.york,
			sets: [
				{ name: 'wall', types: ['way'], filters: [t('barrier', 'city_wall')], within: { kind: 'scope' } },
				{ name: 'hist', types: ['way'], filters: [t('historic', 'citywalls')], within: { kind: 'scope' } }
			],
			combine: { op: 'union', of: ['wall', 'hist'] },
			output: out
		}
	},
	{
		id: 8,
		title: 'Streets that pass through buildings',
		where: 'Berlin',
		plan: {
			scope: AREAS.berlin,
			sets: [{ name: 'p', types: ['way'], filters: [t('tunnel', 'building_passage')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 9,
		title: 'Businesses that float',
		where: 'Amsterdam',
		plan: {
			scope: AREAS.amsterdam,
			sets: [{ name: 'f', types: ['nwr'], filters: [t('floating', 'yes')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 11,
		title: 'Unusual vending machines',
		where: 'Berlin',
		plan: {
			scope: AREAS.berlin,
			sets: [
				{
					name: 'v',
					types: ['nwr'],
					filters: [t('amenity', 'vending_machine'), re('vending', 'pizza|milk|eggs|flowers|bicycle_tube|bread|honey')],
					within: { kind: 'scope' }
				}
			],
			output: out
		}
	},
	{
		id: 12,
		title: 'The miniature railway empire',
		where: 'Netherlands',
		plan: {
			scope: AREAS.nl,
			sets: [{ name: 'm', types: ['way'], filters: [t('railway', 'miniature')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 13,
		title: 'Actual mazes',
		where: 'Netherlands',
		plan: {
			scope: AREAS.nl,
			sets: [{ name: 'z', types: ['nwr'], filters: [t('attraction', 'maze')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 17,
		title: 'Bridges that move',
		where: 'Amsterdam',
		plan: {
			scope: AREAS.amsterdam,
			sets: [{ name: 'b', types: ['way'], filters: [has('bridge:movable')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 37,
		title: 'Water crossing over water (aqueducts)',
		where: 'Netherlands',
		plan: {
			scope: AREAS.nl,
			sets: [{ name: 'a', types: ['way'], filters: [t('bridge', 'aqueduct')], within: { kind: 'scope' } }],
			output: out
		}
	},
	{
		id: 15,
		title: 'Archaeology beside the supermarket',
		where: 'Rome',
		plan: {
			scope: AREAS.rome,
			sets: [
				{ name: 'shops', types: ['nwr'], filters: [re('shop', 'supermarket|mall')], within: { kind: 'scope' } },
				{ name: 'digs', types: ['nwr'], filters: [t('historic', 'archaeological_site')], within: { kind: 'around', set: 'shops', radius: 100 } }
			],
			output: out
		}
	},
	{
		id: 18,
		title: 'Waterfalls beside everyday life',
		where: 'Bergen',
		plan: {
			scope: AREAS.bergen,
			sets: [
				{ name: 'stops', types: ['node'], filters: [t('highway', 'bus_stop')], within: { kind: 'scope' } },
				{ name: 'falls', types: ['nwr'], filters: [t('waterway', 'waterfall')], within: { kind: 'around', set: 'stops', radius: 300 } }
			],
			output: out
		}
	},
	{
		id: 20,
		title: 'Two generations of wind power',
		where: 'Netherlands',
		plan: {
			scope: AREAS.nl,
			sets: [
				{ name: 'turbines', types: ['nwr'], filters: [t('generator:source', 'wind')], within: { kind: 'scope' } },
				{ name: 'mills', types: ['nwr'], filters: [t('man_made', 'windmill')], within: { kind: 'around', set: 'turbines', radius: 1000 } }
			],
			output: out
		}
	},
	{
		id: 6,
		title: 'Stations the trains forgot',
		where: 'Berlin',
		plan: {
			scope: AREAS.berlin,
			sets: [
				{ name: 'stations', types: ['nwr'], filters: [t('building', 'train_station')], within: { kind: 'scope' } },
				{ name: 'rails', types: ['way'], filters: [t('railway', 'rail')], within: { kind: 'scope' } },
				{ name: 'nearRail', types: ['nwr'], filters: [t('building', 'train_station')], within: { kind: 'around', set: 'rails', radius: 500 } }
			],
			combine: { op: 'difference', of: ['stations', 'nearRail'] },
			output: out
		}
	},
	{
		id: 21,
		title: 'The main-character bench',
		where: 'Amsterdam',
		plan: {
			scope: AREAS.amsterdam,
			sets: [
				{ name: 'benches', types: ['node'], filters: [t('amenity', 'bench')], within: { kind: 'scope' } },
				{ name: 'roads', types: ['way'], filters: [re('highway', 'primary|secondary|trunk|motorway')], within: { kind: 'scope' } },
				{ name: 'nearRoad', types: ['node'], filters: [t('amenity', 'bench')], within: { kind: 'around', set: 'roads', radius: 300 } }
			],
			combine: { op: 'difference', of: ['benches', 'nearRoad'] },
			output: out
		}
	},
	{
		id: 30,
		title: 'Gardens in the industrial district (tests `inside`)',
		where: 'Berlin',
		plan: {
			scope: AREAS.berlin,
			sets: [
				{ name: 'industrial', types: ['way'], filters: [t('landuse', 'industrial')], within: { kind: 'scope' } },
				{ name: 'plots', types: ['nwr'], filters: [t('landuse', 'allotments')], within: { kind: 'inside', set: 'industrial' } }
			],
			output: out
		}
	}
];

type Row = { id: number; title: string; where: string; count: number | string; sample: string };

const rows: Row[] = [];

describe('presentation prompt bench', () => {
	it('runs every expressible prompt against live Overpass', async () => {
		for (const probe of PROBES) {
			try {
				const run = await compileAndRun(probe.plan);
				const names = run.elements
					.map(elementLabel)
					.filter((n) => !/^(node|way|relation)\//.test(n))
					.slice(0, 3);
				rows.push({
					id: probe.id,
					title: probe.title,
					where: probe.where,
					count: run.probeCount ?? run.count,
					sample: names.join(', ') || '(unnamed features)'
				});
			} catch (err) {
				rows.push({
					id: probe.id,
					title: probe.title,
					where: probe.where,
					count: 'ERROR',
					sample: err instanceof Error ? err.message.slice(0, 90) : String(err)
				});
			}
		}

		console.log('\n\n| # | Prompt | Where | Hits | Examples |');
		console.log('|---|---|---|---|---|');
		for (const row of rows) {
			console.log(`| ${row.id} | ${row.title} | ${row.where} | ${row.count} | ${row.sample} |`);
		}
		expect(rows).toHaveLength(PROBES.length);
	});

	it('#40 playground with cafés but no toilet — needs local counting, not Overpass', async () => {
		const near = (name: string, filters: Plan['sets'][number]['filters']): Plan => ({
			scope: box(52.36, 4.88, 52.38, 4.91),
			sets: [{ name, types: ['nwr'], filters, within: { kind: 'scope' } }],
			output: { mode: 'center', limit: 200 }
		});

		const playgrounds = await compileAndRun(near('p', [t('leisure', 'playground')]));
		const cafes = await compileAndRun(near('c', [t('amenity', 'cafe')]));
		const toilets = await compileAndRun(near('t', [t('amenity', 'toilets')]));

		const withCafes = countNearby(playgrounds.elements, cafes.elements, 300);
		const withToilets = countNearby(playgrounds.elements, toilets.elements, 500);
		const toiletCount = new Map(withToilets.map((r) => [`${r.origin.type}/${r.origin.id}`, r.count]));

		const gaps = withCafes.filter(
			(r) => r.count >= 3 && (toiletCount.get(`${r.origin.type}/${r.origin.id}`) ?? 0) === 0
		);

		console.log(
			`\n#40: ${playgrounds.count} playgrounds, ${cafes.count} cafés, ${toilets.count} toilets ->` +
				` ${gaps.length} playgrounds with 3+ cafés nearby and no toilet within 500 m`
		);
		for (const gap of gaps.slice(0, 5)) {
			console.log(`   - ${elementLabel(gap.origin)} (${gap.count} cafés)`);
		}
		expect(gaps.length).toBeGreaterThanOrEqual(0);
	});
});
