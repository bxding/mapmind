import { env } from '$env/dynamic/private';

export function serverSettings() {
	return { apiKey: env.OPENWEBUI_API_KEY, baseUrl: env.OPENWEBUI_BASE_URL, model: env.OPENWEBUI_MODEL };
}
