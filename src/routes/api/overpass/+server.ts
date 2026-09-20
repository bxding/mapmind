import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Public searches must pass through the model and the validated Plan executor. */
export const POST: RequestHandler = () => json(
	{ error: 'Direct queries are no longer supported. Use /api/agent to search.' },
	{ status: 410 }
);
