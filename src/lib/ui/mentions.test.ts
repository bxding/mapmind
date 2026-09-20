import { expect, it } from 'vitest';
import { mentionMatcher, turnElements } from './mentions';
import type { MapElement } from '$lib/agent/events';
const place = (id: number, name: string): MapElement => ({ id, type: 'node', lat: 37, lon: -80, tags: { name } });
it('links exact known names with word boundaries, case folding and longest match', () => {
	const match = mentionMatcher([place(1, 'Park'), place(2, 'Park Lane'), place(3, 'A+B Café')]);
	expect(match('PARK LANE near A+B Café, not Parking.').map(m => [m.text, m.elements[0].id])).toEqual([['PARK LANE', 2], ['A+B Café', 3]]);
});
it('preserves ambiguity and ignores unknown or unlocated features', () => {
	const match = mentionMatcher([place(1, 'Library'), place(2, 'Library'), { id: 3, type: 'node', tags: { name: 'Ghost' } }]);
	expect(match('Library')[0].elements).toHaveLength(2); expect(match('Ghost or Somewhere')).toEqual([]);
});
it('retains per-turn objects across multiple results and deduplicates OSM IDs', () => {
	expect(turnElements([{ type: 'results', count: 1, elements: [place(1, 'Park')] }, { type: 'results', count: 2, elements: [place(1, 'Park'), place(2, 'Library')] }])).toHaveLength(2);
});
