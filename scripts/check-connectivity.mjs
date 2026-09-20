import { lookup } from 'node:dns/promises';

const endpoints = (process.env.OVERPASS_URLS || 'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter').split(',').map(s => s.trim()).filter(Boolean);
function code(error) {
  if (typeof error?.code === 'string') return error.code;
  if (error?.errors) return error.errors.map(code).join(',');
  if (error?.cause) return code(error.cause);
  return error?.name || 'UNKNOWN';
}
let reachable = false;
for (const endpoint of endpoints.slice(0, 3)) {
  let host = 'invalid endpoint';
  const start = Date.now();
  try {
    const url = new URL(endpoint);
    host = url.hostname;
    const addresses = await lookup(host, { all: true });
    console.log(JSON.stringify({ host, addresses }));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MapMind/0.1 connectivity check' },
      body: new URLSearchParams({ data: '[out:json][timeout:5];out count;' }),
      signal: AbortSignal.timeout(10000)
    });
    console.log(JSON.stringify({ host, status: response.status, milliseconds: Date.now() - start }));
    await response.body?.cancel();
    reachable ||= response.ok;
  } catch (error) {
    console.log(JSON.stringify({ host, code: code(error), milliseconds: Date.now() - start }));
  }
}
process.exitCode = reachable ? 0 : 1;
