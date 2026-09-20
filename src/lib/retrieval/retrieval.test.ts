import { describe, expect, it } from 'vitest';
import { retrievalBlock, retrieveExamples, tagHints, tokenize } from './index';

describe('tokenize', () => {
	it('lowercases, drops stopwords, and keeps tag-shaped tokens', () => {
		expect(tokenize('Find all the cafes in Blacksburg')).toEqual(['cafes', 'blacksburg']);
		expect(tokenize('addr:street')).toEqual(['addr:street']);
	});
});

describe('retrieveExamples', () => {
	it('retrieves lexically similar OverpassNL questions', async () => {
		const examples = await retrieveExamples('cafes in Blacksburg', 5);
		expect(examples).toHaveLength(5);
		expect(examples[0]!.score).toBeGreaterThanOrEqual(examples[4]!.score);
		expect(examples.some((example) => /caf|coffee/i.test(example.nl))).toBe(true);
	});

	it('surfaces the tag a question implies', async () => {
		const examples = await retrieveExamples('drinking water fountains', 8);
		const hints = tagHints(examples);
		expect(hints.some((hint) => hint.key === 'amenity')).toBe(true);
	});

	it('returns nothing for a question with no content words', async () => {
		expect(await retrieveExamples('the and of', 5)).toEqual([]);
	});
});

describe('tagHints', () => {
	it('counts key=value pairs and ignores per-object noise keys', () => {
		const hints = tagHints([
			{ nl: 'a', query: '(node["amenity"="cafe"];node["name"="X"];);out;' },
			{ nl: 'b', query: 'node["amenity"="cafe"]["outdoor_seating"];out;' }
		]);
		expect(hints[0]).toEqual({ key: 'amenity', value: 'cafe', hits: 2 });
		expect(hints.some((hint) => hint.key === 'name')).toBe(false);
		expect(hints).toContainEqual({ key: 'outdoor_seating', value: undefined, hits: 1 });
	});
});

describe('retrievalBlock', () => {
	it('builds a prompt block that warns against copying the syntax', async () => {
		const block = await retrievalBlock('cafes near a university', 3);
		expect(block).toContain('Do not copy their syntax');
		expect(block).toContain('Tags most common across these examples');
	});

	it('is empty when nothing matches', async () => {
		expect(await retrievalBlock('the and of', 3)).toBe('');
	});
});
