import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from './events';
import type { AgentRequest } from '$lib/api/types';
import { planSchema } from '$lib/oql/plan';
import { runAgent } from './loop';
import { runOverpass } from './tools/runOverpass';
import { findPlace } from './tools/findPlace';
import { inferFromExamples } from './tools/inferFromExamples';
import { ServiceError } from './errors';

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: complete } }; } }));
vi.mock('./settings.server', () => ({ serverSettings: () => ({}) }));
vi.mock('./tools/runOverpass', () => ({ runOverpass: vi.fn() }));
vi.mock('./tools/findPlace', () => ({ findPlace: vi.fn() }));
vi.mock('./tools/inferFromExamples', () => ({ inferFromExamples: vi.fn() }));
vi.mock('$lib/retrieval', () => ({ retrievalBlock: vi.fn(async () => 'Reference examples') }));
const plan = planSchema.parse({ scope: { kind: 'bbox', south: 37.21, west: -80.45, north: 37.25, east: -80.4 }, sets: [{ name: 'cafes', types: ['nwr'], filters: [{ key: 'amenity', op: '=', value: 'cafe' }] }] });
const cafe = { id: 1, type: 'node' as const, lat: 37.22, lon: -80.42, tags: { name: 'Test café', amenity: 'cafe', opening_hours: '08:00-15:00' } };
const ask = (extra: Partial<AgentRequest> = {}): AgentRequest => ({ messages: [{ role: 'user', content: 'Find cafés' }], ...extra });
function tool(name: string, args: unknown) { return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 'call', function: { name, arguments: JSON.stringify(args) } }] } }] }; }
function answer(text = 'One café matched: Test café.') { return { choices: [{ message: { role: 'assistant', content: text } }] }; }
async function collect(req = ask(), apiKey = 'test-key', baseUrl = 'https://openwebui.example.com') { const out: AgentEvent[] = []; for await (const e of runAgent(req, { apiKey, baseUrl })) out.push(e); return out; }

beforeEach(() => {
	vi.clearAllMocks(); complete.mockReset();
	vi.mocked(runOverpass).mockReset().mockImplementation(async (oql) => ({ count: 1, elements: oql.includes('out count;') ? [] : [cafe], remark: null }));
	vi.mocked(findPlace).mockResolvedValue({ displayName: 'Blacksburg', osmType: 'relation', osmId: 123, areaId: 3600000123, lat: 37.2, lon: -80.4, bounds: { south: 37.2, west: -80.5, north: 37.3, east: -80.3 } });
	vi.mocked(inferFromExamples).mockResolvedValue({ plan, summary: 'Both share amenity=cafe', matched: [cafe] });
});

describe('Qwen-only agent', () => {
	it('executes the model plan and uses only its final answer', async () => {
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan })).mockResolvedValueOnce(answer());
		const events = await collect();
		expect(events.filter((e) => e.type === 'answer')).toEqual([{ type: 'answer', text: 'One café matched: Test café.' }]);
		expect(events.some((e) => e.type === 'results')).toBe(true);
		expect(runOverpass).toHaveBeenCalledTimes(2);
	});
	it('does not query maps or answer locally when the key is absent', async () => {
		const events = await collect(ask(), '');
		expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'model_not_configured' }));
		expect(complete).not.toHaveBeenCalled(); expect(runOverpass).not.toHaveBeenCalled();
		expect(events.some((e) => e.type === 'answer')).toBe(false);
	});
	it.each(['', '   '])('requires an explicitly configured model endpoint (%j)', async baseUrl => {
		const events = await collect(ask(), 'test-key', baseUrl);
		expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'model_not_configured' }));
		expect(complete).not.toHaveBeenCalled();
		expect(runOverpass).not.toHaveBeenCalled();
	});

	it('hides provider bodies and credentials on model failures', async () => {
		complete.mockRejectedValue(new Error('Authorization: Bearer test-key <html>private upstream body</html>'));
		const events = await collect();
		expect(JSON.stringify(events)).not.toMatch(/test-key|html|private upstream/);
		expect(events).toContainEqual(expect.objectContaining({ code: 'model_unavailable' }));
		expect(runOverpass).not.toHaveBeenCalled();
	});
	it('does not generate a fallback answer after successful tools then a model failure', async () => {
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan })).mockRejectedValueOnce(new Error('offline'));
		const events = await collect();
		expect(events.some((e) => e.type === 'results')).toBe(true);
		expect(events.some((e) => e.type === 'answer')).toBe(false);
	});
	it('returns validation feedback so the model can repair an unsafe plan', async () => {
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan: { ...plan, rawOql: 'out;' } })).mockResolvedValueOnce(tool('compileAndRun', { plan })).mockResolvedValueOnce(answer());
		const events = await collect();
		expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', result: expect.objectContaining({ error: 'Plan did not validate' }) }));
		expect(runOverpass).toHaveBeenCalledTimes(2);
	});
	it('resolves and overrides invented area IDs', async () => {
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan: { ...plan, scope: { kind: 'place', name: 'Blacksburg', areaId: 999 } } })).mockResolvedValueOnce(answer());
		const events = await collect();
		expect(findPlace).toHaveBeenCalledWith('Blacksburg');
		expect(events.find((e) => e.type === 'oql')).toMatchObject({ oql: expect.stringContaining('area(3600000123)') });
	});
	it('does not execute an ambiguous area name after lookup failure', async () => {
		vi.mocked(findPlace).mockRejectedValue(new ServiceError('place_not_found', 'No matching place.'));
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan: { ...plan, scope: { kind: 'place', name: 'Somewhere' } } })).mockResolvedValueOnce(answer('Which city do you mean?'));
		const events = await collect();
		expect(runOverpass).not.toHaveBeenCalled();
		expect(events).toContainEqual({ type: 'answer', text: 'Which city do you mean?' });
	});
	it('sends follow-up context and clears the map if the hours filter keeps nothing', async () => {
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan, label: 'cafes' })).mockResolvedValueOnce(tool('filterHours', { label: 'cafes', minute: 1260 })).mockResolvedValueOnce(answer('None are tagged as open that late.'));
		const events = await collect(ask({ previousPlan: plan }));
		expect(complete.mock.calls[0]![0].messages).toContainEqual(expect.objectContaining({ content: expect.stringContaining('previous plan') }));
		expect(events.findLast((e) => e.type === 'results')).toMatchObject({ count: 0, elements: [] });
	});
	it('makes Qwen choose and execute the inferred example plan before answering', async () => {
		complete.mockResolvedValueOnce(tool('inferFromExamples', {})).mockResolvedValueOnce(tool('compileAndRun', { plan })).mockResolvedValueOnce(answer('These examples are cafés.'));
		const events = await collect(ask({ examplePoints: [{ lat: 37.22, lon: -80.42 }, { lat: 37.23, lon: -80.43 }], bbox: plan.scope.kind === 'bbox' ? plan.scope : undefined }));
		expect(inferFromExamples).toHaveBeenCalledTimes(1);
		expect(events.filter((e) => e.type === 'answer')).toEqual([{ type: 'answer', text: 'These examples are cafés.' }]);
		expect(complete).toHaveBeenCalledTimes(3);
	});
	it('keeps Overpass failures distinct from successful empty results', async () => {
		vi.mocked(runOverpass).mockRejectedValue(new ServiceError('overpass_unavailable', 'Overpass is busy.'));
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan })).mockResolvedValueOnce(answer('The map service is busy; please retry.'));
		const events = await collect();
		expect(events.some((e) => e.type === 'results')).toBe(false);
		expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'overpass_unavailable', message: 'Overpass is busy.' }));
		expect(complete).toHaveBeenCalledTimes(1);
	});
	it('stops repeated queries and model rounds without a canned answer', async () => {
		complete.mockResolvedValue(tool('compileAndRun', { plan }));
		const events = await collect();
		expect(complete).toHaveBeenCalledTimes(24); expect(runOverpass).toHaveBeenCalledTimes(16);
		expect(events).toContainEqual(expect.objectContaining({ code: 'model_incomplete' }));
		expect(events.some((e) => e.type === 'answer')).toBe(false);
	});
	it('reports actual truncation to the model', async () => {
		vi.mocked(runOverpass).mockImplementation(async (oql) => ({ count: oql.includes('out count;') ? 500 : 1, elements: oql.includes('out count;') ? [] : [cafe], remark: null }));
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan })).mockResolvedValueOnce(answer());
		const events = await collect();
		expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', result: expect.objectContaining({ truncated: true, probeCount: 500 }) }));
	});

	it('rejects a country-sized named place before contacting Overpass', async () => {
		vi.mocked(findPlace).mockResolvedValue({ displayName: 'Virginia', osmType: 'relation', osmId: 1, areaId: 3600000001, lat: 37, lon: -80, bounds: { south: 36, west: -84, north: 40, east: -75 } });
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan: { ...plan, scope: { kind: 'place', name: 'Virginia' } } }));
		const events = await collect();
		expect(runOverpass).not.toHaveBeenCalled();
		expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'search_area_too_large' }));
		expect(complete).toHaveBeenCalledTimes(1);
	});
	it('does not allow an invented area ID to bypass the place-size check', async () => {
		vi.mocked(findPlace).mockResolvedValue({ displayName: 'Unknown bounds', osmType: 'relation', osmId: 1, areaId: 3600000001, lat: 37, lon: -80 });
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan: { ...plan, scope: { kind: 'place', name: 'Unknown', areaId: 123 } } }));
		const events = await collect();
		expect(runOverpass).not.toHaveBeenCalled();
		expect(events).toContainEqual(expect.objectContaining({ code: 'place_extent_unavailable' }));
	});

	it('emits map locations alongside a model-requested count and exposes both totals', async () => {
		complete.mockResolvedValueOnce(tool('compileAndRun', { plan: { ...plan, output: { mode: 'count' } } })).mockResolvedValueOnce(answer('One café is mapped.'));
		const events = await collect();
		expect(events).toContainEqual({ type: 'results', count: 1, elements: [cafe] });
		expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', result: expect.objectContaining({ count: 1, probeCount: 1, displayedCount: 1 }) }));
		expect(events.findLast(e => e.type === 'oql')).toMatchObject({ oql: expect.stringContaining('out geom 200;') });
	});

	it('finishes a multi-category grouping after more than three queries', async () => {
		let id = 0;
		vi.mocked(runOverpass).mockImplementation(async oql => ({ count: 1, elements: oql.includes('out count;') ? [] : [{ ...cafe, id: ++id }], remark: null }));
		for (const label of ['initial', 'books', 'benches', 'parks']) complete.mockResolvedValueOnce(tool('compileAndRun', { plan, label }));
		complete.mockResolvedValueOnce(tool('findNearbyGroups', { originsLabel: 'books', targetsLabels: ['benches', 'parks'], radiusMeters: 300 })).mockResolvedValueOnce(answer('One group has both a bench and a park center within 300 m.'));
		const events = await collect();
		expect(runOverpass).toHaveBeenCalledTimes(8);
		expect(events.findLast(e => e.type === 'results')).toMatchObject({ count: 3 });
		expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', name: 'findNearbyGroups', result: expect.objectContaining({ totalGroups: 1, displayedGroups: 1, groups: [expect.objectContaining({ counts: { benches: 1, parks: 1 }, radiusMeters: 300 })] }) }));
	});
	it('does not claim groups based on truncated category data', async () => {
		vi.mocked(runOverpass).mockImplementation(async oql => ({ count: oql.includes('out count;') ? 1500 : 1, elements: oql.includes('out count;') ? [] : [cafe], remark: null }));
		for (const label of ['books', 'parks']) complete.mockResolvedValueOnce(tool('compileAndRun', { plan, label }));
		complete.mockResolvedValueOnce(tool('findNearbyGroups', { originsLabel: 'books', targetsLabels: ['parks'], radiusMeters: 300 })).mockResolvedValueOnce(answer('Please choose a smaller area.'));
		const events = await collect();
		expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', name: 'findNearbyGroups', result: { error: expect.stringContaining('complete result sets') } }));
	});

	it('supplies the real remaining budget despite stale assistant history', async () => {
		for (let i = 0; i < 3; i++) complete.mockResolvedValueOnce(tool('compileAndRun', { plan, label: `set${i}` }));
		complete.mockResolvedValueOnce(answer());
		await collect(ask({ messages: [{ role: 'user', content: 'Find groups' }, { role: 'assistant', content: 'I hit the 3-query limit.' }, { role: 'user', content: 'Try again' }] }));
		expect(complete.mock.calls[0][0].messages.at(-1)).toMatchObject({ role: 'system', content: expect.stringContaining('0 of 8 query attempts used; 8 remaining') });
		expect(complete.mock.calls[3][0].messages.at(-1)).toMatchObject({ role: 'system', content: expect.stringContaining('3 of 8 query attempts used; 5 remaining') });
		expect(complete.mock.calls[3][0].messages.at(-1).content).toContain('remain available even at zero remaining queries');
	});

});
