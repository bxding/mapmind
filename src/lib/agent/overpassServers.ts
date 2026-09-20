import { env } from '$env/dynamic/private';
import { ServiceError } from './errors';

export const DEFAULT_OVERPASS_URLS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.private.coffee/api/interpreter'
];

export function overpassServers(): string[] {
	const configured = env.OVERPASS_URLS?.trim();
	const urls = configured ? configured.split(',').map(value => value.trim()).filter(Boolean) : DEFAULT_OVERPASS_URLS;
	if (!urls.length || urls.length > 3 || urls.some(value => {
		try { const url = new URL(value); return !['https:', 'http:'].includes(url.protocol) || Boolean(url.username || url.password); }
		catch { return true; }
	})) throw new ServiceError('overpass_configuration', 'The map service is not configured correctly on the server.');
	return [...new Set(urls)];
}
