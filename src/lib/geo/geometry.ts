import type { MapCoordinate, MapGeometry } from '$lib/agent/events';
import type { OverpassElement } from '$lib/overpass';

export type RawGeometryPoint = { lat: number; lon: number };
export const MAX_GEOMETRY_POINTS = 100_000;
const validPoint = (p: RawGeometryPoint) => p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;

/** Validate upstream geometry before conversion; null entries indicate missing coordinates. */
export function validateGeometry(elements: OverpassElement[]) {
	let count = 0;
	function path(points: (RawGeometryPoint | null)[] | undefined) {
		if (points === undefined) return;
		if (!Array.isArray(points)) throw new Error('Invalid geometry');
		count += points.length;
		if (count > MAX_GEOMETRY_POINTS) throw new Error('Too much geometry');
		for (const p of points) if (p !== null && !validPoint(p)) throw new Error('Invalid geometry');
	}
	for (const el of elements) {
		path(el.geometry);
		if (el.members === undefined) continue;
		if (!Array.isArray(el.members)) throw new Error('Invalid members');
		count += el.members.length;
		if (count > MAX_GEOMETRY_POINTS) throw new Error('Too much geometry');
		for (const member of el.members) {
			if (!member || typeof member !== 'object') throw new Error('Invalid member');
			path(member.geometry);
		}
	}
}

function segments(points: (RawGeometryPoint | null)[] = []): MapCoordinate[][] {
	const paths: MapCoordinate[][] = [];
	let current: MapCoordinate[] = [];
	for (const p of points) {
		if (p && validPoint(p)) current.push([p.lon, p.lat]);
		else { if (current.length > 1) paths.push(current); current = []; }
	}
	if (current.length > 1) paths.push(current);
	return paths;
}

export function mapGeometry(el: OverpassElement): MapGeometry | undefined {
	if (el.type === 'node') return;
	if (el.type === 'relation') {
		// Keep disconnected member ways separate. Do not fill incomplete multipolygons or holes.
		const paths = (el.members ?? []).flatMap(m => segments(m.geometry));
		if (paths.length) return { type: 'MultiLineString', coordinates: paths };
		return;
	}
	const paths = segments(el.geometry);
	if (!paths.length) return;
	if (paths.length > 1) return { type: 'MultiLineString', coordinates: paths };
	const ring = paths[0];
	const closed = ring.length >= 4 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1];
	const tags = el.tags ?? {};
	const area = tags.area === 'yes' || (tags.area !== 'no' && !tags.highway && !tags.barrier && !tags.railway && (
		!!tags.building || !!tags.landuse || !!tags.leisure || !!tags.amenity || ['water', 'wood', 'scrub', 'wetland', 'beach'].includes(tags.natural) || tags.waterway === 'riverbank'
	));
	return closed && area ? { type: 'Polygon', coordinates: [ring] } : { type: 'LineString', coordinates: ring };
}

export function geometryPaths(g: MapGeometry): MapCoordinate[][] {
	return g.type === 'LineString' ? [g.coordinates] : g.coordinates;
}
export function geometryCenter(g: MapGeometry | undefined) {
	if (!g) return;
	let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
	for (const path of geometryPaths(g)) for (const [lon, lat] of path) {
		south = Math.min(south, lat); north = Math.max(north, lat); west = Math.min(west, lon); east = Math.max(east, lon);
	}
	return Number.isFinite(south) ? { lat: (south + north) / 2, lon: (west + east) / 2 } : undefined;
}
