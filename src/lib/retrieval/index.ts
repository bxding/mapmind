import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * k-shot retrieval over OverpassNL (Staniek et al., TACL 2024).
 *
 * Their ablation is the reason this file exists: random 5-shot scored 25.4 EX on dev,
 * sBERT-retrieved 5-shot scored 40.4. Retrieval is the single biggest lever in the paper.
 * We use lexical BM25 rather than sBERT — no model to ship, and the win is mostly in
 * surfacing the *tags* real mappers used for this kind of question.
 */

const DATA_DIR = path.resolve('data/overpassnl');
const STOPWORDS = new Set([
	'a', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'find', 'for',
	'from', 'get', 'give', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'list', 'me', 'my', 'near',
	'of', 'on', 'or', 'show', 'that', 'the', 'their', 'there', 'they', 'this', 'to', 'want', 'was',
	'what', 'where', 'which', 'with', 'within', 'you', 'your'
]);

const K1 = 1.2;
const B = 0.75;

export type Example = { nl: string; query: string };
export type ScoredExample = Example & { score: number };
export type TagHint = { key: string; value?: string; hits: number };

export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_:]+/)
		.filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

type Index = {
	examples: Example[];
	docs: Map<string, number>[];
	lengths: number[];
	avgLength: number;
	df: Map<string, number>;
};

let indexPromise: Promise<Index> | null = null;

async function buildIndex(): Promise<Index> {
	const [nlRaw, queryRaw] = await Promise.all([
		readFile(path.join(DATA_DIR, 'dataset.train.nl'), 'utf8'),
		readFile(path.join(DATA_DIR, 'dataset.train.query'), 'utf8')
	]);
	const nl = nlRaw.split('\n');
	const queries = queryRaw.split('\n');
	const examples: Example[] = [];
	for (let i = 0; i < nl.length; i++) {
		const question = nl[i]?.trim();
		const query = queries[i]?.trim();
		if (question && query) examples.push({ nl: question, query });
	}

	const docs: Map<string, number>[] = [];
	const lengths: number[] = [];
	const df = new Map<string, number>();
	for (const example of examples) {
		const tokens = tokenize(example.nl);
		const tf = new Map<string, number>();
		for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
		for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
		docs.push(tf);
		lengths.push(tokens.length);
	}
	const avgLength = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
	return { examples, docs, lengths, avgLength, df };
}

/** The dataset is ~6k lines; parse it once per process. */
export function loadIndex(): Promise<Index> {
	indexPromise ??= buildIndex().catch((err) => {
		indexPromise = null;
		throw err;
	});
	return indexPromise;
}

export async function retrieveExamples(question: string, k = 5): Promise<ScoredExample[]> {
	const index = await loadIndex();
	const terms = tokenize(question);
	if (!terms.length || !index.examples.length) return [];
	const total = index.examples.length;

	const scores: { i: number; score: number }[] = [];
	for (let i = 0; i < total; i++) {
		const tf = index.docs[i]!;
		const length = index.lengths[i]!;
		let score = 0;
		for (const term of terms) {
			const frequency = tf.get(term);
			if (!frequency) continue;
			const documentFrequency = index.df.get(term) ?? 0;
			const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
			score +=
				(idf * (frequency * (K1 + 1))) /
				(frequency + K1 * (1 - B + (B * length) / index.avgLength));
		}
		if (score > 0) scores.push({ i, score });
	}
	scores.sort((a, b) => b.score - a.score);
	return scores.slice(0, k).map(({ i, score }) => ({ ...index.examples[i]!, score }));
}

const TAG_PAIR = /\["([a-z_:]+)"\s*=\s*"([^"]+)"\]/g;
const TAG_KEY = /\["([a-z_:]+)"\]/g;
const NOISE_KEYS = new Set(['name', 'ref', 'uid', 'user', 'source', 'note', 'fixme']);

/** The tags real mappers used for questions like this one — the actual signal for Qwen. */
export function tagHints(examples: Example[], limit = 10): TagHint[] {
	const counts = new Map<string, TagHint>();
	const bump = (key: string, value?: string) => {
		if (NOISE_KEYS.has(key)) return;
		const id = value ? `${key}=${value}` : key;
		const existing = counts.get(id);
		if (existing) existing.hits++;
		else counts.set(id, { key, value, hits: 1 });
	};
	for (const example of examples) {
		for (const match of example.query.matchAll(TAG_PAIR)) bump(match[1]!, match[2]!);
		for (const match of example.query.matchAll(TAG_KEY)) bump(match[1]!);
	}
	return [...counts.values()].sort((a, b) => b.hits - a.hits).slice(0, limit);
}

/**
 * Prompt block. The examples are reference *vocabulary*, not syntax to copy: gold
 * OverpassNL queries use Turbo shortcuts ({{geocodeArea}}, {{bbox}}) that the real
 * Overpass API rejects, and our model emits a Plan anyway.
 */
export async function retrievalBlock(question: string, k = 5): Promise<string> {
	let examples: ScoredExample[] = [];
	try {
		examples = await retrieveExamples(question, k);
	} catch {
		return '';
	}
	if (!examples.length) return '';

	const hints = tagHints(examples);
	const lines = examples.map(
		(example, i) => `${i + 1}. "${example.nl}"\n   tags used: ${
			tagHints([example], 6)
				.map((hint) => (hint.value ? `${hint.key}=${hint.value}` : hint.key))
				.join(', ') || '(none)'
		}`
	);

	return [
		'Similar questions from the OverpassNL corpus (real Overpass Turbo queries).',
		'Use them ONLY to pick tag keys and values. Do not copy their syntax.',
		...lines,
		'',
		`Tags most common across these examples: ${hints
			.map((hint) => (hint.value ? `${hint.key}=${hint.value}` : hint.key))
			.join(', ')}`
	].join('\n');
}
