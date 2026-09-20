import { json } from '@sveltejs/kit';
import { runAgent } from '$lib/agent/loop';
import { serverSettings } from '$lib/agent/settings.server';
import { agentStream } from '$lib/server/agentStream';
import { acquireRequest, readRequest, requestSchema } from '$lib/server/requests';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	const origin = request.headers.get('origin');
	if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
		return json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
	}
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
		return json({ error: 'Send an application/json request.' }, { status: 415 });
	}
	const release = acquireRequest(getClientAddress());
	if (!release) return json({ error: 'A search is already running or the service is busy. Try again shortly.' }, { status: 429, headers: { 'Retry-After': '10' } });
	let body;
	try {
		const parsed = requestSchema.safeParse(await readRequest(request));
		if (!parsed.success) throw new Error('Invalid request');
		body = parsed.data;
	} catch {
		release();
		return json({ error: 'Invalid search request. Check the message, map bounds, and example points (maximum 3).' }, { status: 400 });
	}
	const stream = agentStream(request.signal, () => runAgent(body, serverSettings()), release);
	return new Response(stream, { headers: {
		'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
		'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff'
	} });
};
