import { z } from 'zod';
import { planSchema } from '$lib/oql/plan';
import { validateExecutablePlan } from '$lib/agent/validatePlan';

const bbox = z.object({
	south: z.number().min(-90).max(90), north: z.number().min(-90).max(90),
	west: z.number().min(-180).max(180), east: z.number().min(-180).max(180)
}).refine((b) => b.south < b.north && b.west < b.east, 'Invalid bounding box');
export const requestSchema = z.object({
	messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(8000) }).strict()).min(1).max(30),
	previousPlan: planSchema.optional(),
	bbox: bbox.optional(),
	examplePoints: z.array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict()).max(3).optional(),
	date: z.iso.datetime().optional(),
	adiff: z.tuple([z.iso.datetime(), z.iso.datetime()]).optional()
}).strict().superRefine((body, ctx) => {
	if (body.messages.at(-1)?.role !== 'user') ctx.addIssue({ code: 'custom', message: 'The last message must be from the user' });
	if (body.previousPlan) {
		try { validateExecutablePlan(body.previousPlan); }
		catch { ctx.addIssue({ code: 'custom', message: 'Invalid previous plan' }); }
	}
});

export async function readRequest(request: Request): Promise<unknown> {
	const limit = 64 * 1024;
	if (Number(request.headers.get('content-length')) > limit) throw new Error('Request too large');
	const reader = request.body?.getReader();
	if (!reader) throw new Error('Missing body');
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) { await reader.cancel(); throw new Error('Request too large'); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return JSON.parse(new TextDecoder().decode(bytes));
}

// Single-process guard for the demo deployment. No forwarded header is trusted here.
const clients = new Map<string, { until: number; count: number; active: number }>();
let active = 0;
export function acquireRequest(ip: string, now = Date.now()): (() => void) | null {
	for (const [key, value] of clients) if (value.until <= now && value.active === 0) clients.delete(key);
	let client = clients.get(ip);
	if (!client) {
		if (clients.size >= 10000) return null;
		client = { until: now + 60000, count: 0, active: 0 };
		clients.set(ip, client);
	}
	if (client.until <= now) { client.until = now + 60000; client.count = 0; }
	if (active >= 4 || client.active >= 1 || client.count >= 10) return null;
	client.count++; client.active++; active++;
	let released = false;
	return () => { if (!released) { released = true; client.active--; active--; } };
}
