import type { MapElement } from '$lib/agent/events';
export type PointCluster = { members: MapElement[]; lat: number; lon: number };
/** Screen-distance grouping only; no shared amenity or geographic relationship is implied. */
export function clusterPoints(elements: MapElement[], project: (lat: number, lon: number) => { x: number; y: number }, enabled = true): PointCluster[] {
	type Bin = { x: number; y: number; members: MapElement[] };
	const bins: Bin[] = [];
	const cells = new Map<string, Bin[]>();
	for (const element of elements) {
		if (element.geometry || element.lat == null || element.lon == null) continue;
		const p = project(element.lat, element.lon);
		const x = Math.floor(p.x / 64), y = Math.floor(p.y / 64);
		let nearest: Bin | undefined;
		let distance = 64 ** 2;
		if (enabled) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
			for (const bin of cells.get(`${x + dx}:${y + dy}`) ?? []) {
				const d = (p.x - bin.x) ** 2 + (p.y - bin.y) ** 2;
				if (d < distance) { nearest = bin; distance = d; }
			}
		}
		if (nearest) nearest.members.push(element);
		else {
			const bin = { x: p.x, y: p.y, members: [element] };
			bins.push(bin);
			const key = `${x}:${y}`;
			const cell = cells.get(key) ?? []; cell.push(bin); cells.set(key, cell);
		}
	}
	return bins.map(({ members }) => ({ members, lat: members.reduce((n, e) => n + e.lat!, 0) / members.length, lon: members.reduce((n, e) => n + e.lon!, 0) / members.length }));
}
