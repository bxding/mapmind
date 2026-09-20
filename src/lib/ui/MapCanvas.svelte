<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { clusterPoints } from './clusters';
	import { geometryPaths } from '$lib/geo/geometry';
	import { latestGroups } from '$lib/geo/groups';
	import { app, VT_CENTER, VT_ZOOM } from './state.svelte';
	import type { Map as LeafletMap, LayerGroup } from 'leaflet';

	let el: HTMLDivElement;
	let map: LeafletMap | undefined;
	let results: LayerGroup | undefined;
	let samples: LayerGroup | undefined;
	let focusLayer: LayerGroup | undefined;
	let groupLayer: LayerGroup | undefined;
	let showGroups = $state(true);
	let clusterEnabled = $state(true);
	let zoom = $state(VT_ZOOM);
	const shapeCount = $derived(app.elements.filter(e => e.geometry).length);
	const grouping = $derived(latestGroups(app.events));
	let ready = $state(false);
	let destroyed = false;

	onMount(async () => {
		const L = (await import('leaflet')).default;
		await import('leaflet/dist/leaflet.css');
		if (destroyed) return;
		map = L.map(el, { zoomControl: false, preferCanvas: true }).setView(VT_CENTER, VT_ZOOM);
		map.createPane('mapFocus').style.zIndex = '625';
		L.control.zoom({ position: 'bottomright' }).addTo(map);
		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
			maxZoom: 19
		}).addTo(map);
		groupLayer = L.layerGroup().addTo(map);
		results = L.layerGroup().addTo(map);
		samples = L.layerGroup().addTo(map);
		focusLayer = L.layerGroup().addTo(map);
		function updateBounds() {
			if (!map) return;
			const b = map.getBounds();
			app.bbox = { south: Math.max(-90, b.getSouth()), west: Math.max(-180, b.getWest()), north: Math.min(90, b.getNorth()), east: Math.min(180, b.getEast()) };
		}
		map.on('moveend', updateBounds);
		map.on('zoomend', () => { if (map) zoom = map.getZoom(); });
		updateBounds();
		ready = true;

		map.on('click', (e) => {
			if (!app.exampleMode || app.busy || app.examplePoints.length >= 3) return;
			app.examplePoints = [...app.examplePoints, { lat: e.latlng.lat, lon: e.latlng.lng }];
		});
	});

	$effect(() => {
		if (!ready) return;
		const elems = app.elements;
		const clustered = clusterEnabled && zoom < 19;
		const level = zoom;
		void import('leaflet').then(({ default: L }) => {
			if (destroyed || !map || !results) return;
			results.clearLayers();
			for (const item of elems) {
				if (!item.geometry) continue;
				const color = item.action === 'delete' ? '#ff6b6b' : item.action === 'create' ? '#4ade80' : item.geometry.type === 'Polygon' ? '#72d6a0' : '#5bc8fa';
				const paths = geometryPaths(item.geometry).map(path => path.map(([lon, lat]) => [lat, lon] as [number, number]));
				const shape = item.geometry.type === 'Polygon'
					? L.polygon(paths, { color, weight: 2, fillOpacity: 0.16 })
					: L.polyline(paths, { color, weight: 4, opacity: 0.9 });
				shape.bindTooltip(textLabel(item.tags?.name ?? item.tags?.highway ?? item.tags?.leisure ?? `${item.type}/${item.id}`)).addTo(results);
			}
			for (const cluster of clusterPoints(elems, (lat, lon) => map!.project([lat, lon], level), clustered)) {
				if (cluster.members.length > 1) {
					const icon = L.divIcon({ className: 'waypoint-cluster', html: `<span>${cluster.members.length}</span>`, iconSize: [40, 40], iconAnchor: [20, 20] });
					L.marker([cluster.lat, cluster.lon], { icon, title: `${cluster.members.length} places — zoom in`, keyboard: true })
						.bindTooltip(textLabel(`${cluster.members.length} places · click to expand`))
						.on('click', () => {
							if (!map) return;
							const b = L.latLngBounds(cluster.members.map(e => [e.lat!, e.lon!] as [number, number]));
							const targetZoom = Math.min(19, Math.max(map.getZoom() + 2, map.getBoundsZoom(b, false, L.point(100, 100))));
							map.setView(b.getCenter(), targetZoom);
						}).addTo(results);
				} else {
					const item = cluster.members[0];
					const color = item.action === 'delete' ? '#ff6b6b' : item.action === 'create' ? '#4ade80' : '#d4f542';
					L.circleMarker([cluster.lat, cluster.lon], { radius: 7, color: '#1a1a1a', weight: 1.5, fillColor: color, fillOpacity: 0.95 })
						.bindTooltip(textLabel(item.tags?.name ?? item.tags?.amenity ?? `${item.type}/${item.id}`)).addTo(results);
				}
			}
		});
	});

	// Fit only on a new result set, so zooming into clusters never resets the viewport.
	$effect(() => {
		if (!ready) return;
		const elems = app.elements;
		void import('leaflet').then(({ default: L }) => {
			if (destroyed || !map) return;
			const bounds = L.latLngBounds([]);
			for (const item of elems) {
				if (item.geometry) for (const path of geometryPaths(item.geometry)) for (const [lon, lat] of path) bounds.extend([lat, lon]);
				else if (item.lat != null && item.lon != null) bounds.extend([item.lat, item.lon]);
			}
			if (bounds.isValid()) {
				const mobile = window.innerWidth <= 700;
				map.fitBounds(bounds, { paddingTopLeft: mobile ? [24, 24] : [460, 48], paddingBottomRight: [32, 32], maxZoom: 16 });
			}
		});
	});

	$effect(() => {
		if (!ready) return;
		const overlay = grouping;
		const visible = showGroups;
		void import('leaflet').then(({ default: L }) => {
			if (destroyed || !groupLayer) return;
			groupLayer.clearLayers();
			if (!visible || !overlay) return;
			for (const group of overlay.groups) {
				const counts = Object.entries(group.counts).map(([label, count]) => `${count} ${label}`).join(', ');
				L.circle([group.lat, group.lon], { radius: group.radiusMeters, color: '#55c9f5', weight: 2, fillColor: '#55c9f5', fillOpacity: 0.10 })
					.bindTooltip(textLabel(`${group.name}: ${counts} within ${group.radiusMeters} m (straight-line, approximate centers)`))
					.addTo(groupLayer);
			}
			groupLayer.eachLayer(layer => { if ('bringToBack' in layer) (layer as import('leaflet').Circle).bringToBack(); });
		});
	});

	$effect(() => {
		if (!ready) return;
		const focus = app.mapFocus;
		void import('leaflet').then(({ default: L }) => {
			if (destroyed || !map || !focusLayer) return;
			focusLayer.clearLayers();
			if (!focus) return;
			const bounds = L.latLngBounds([]);
			for (const item of focus.elements) {
				let layer;
				if (item.geometry) {
					const paths = geometryPaths(item.geometry).map(p => p.map(([lon, lat]) => [lat, lon] as [number, number]));
					for (const p of paths) for (const point of p) bounds.extend(point);
					layer = item.geometry.type === 'Polygon' ? L.polygon(paths, { pane: 'mapFocus', color: '#ffb454', weight: 5, fillOpacity: 0.25 }) : L.polyline(paths, { pane: 'mapFocus', color: '#ffb454', weight: 7 });
				} else if (item.lat != null && item.lon != null) {
					bounds.extend([item.lat, item.lon]);
					layer = L.circleMarker([item.lat, item.lon], { pane: 'mapFocus', radius: 12, color: '#ffb454', weight: 4, fillColor: '#fff', fillOpacity: 0.8 });
				}
				layer?.bindTooltip(textLabel(item.tags?.name ?? `${item.type}/${item.id}`), { permanent: true, direction: 'top' }).addTo(focusLayer);
			}
			if (bounds.isValid()) {
				const mobile = window.innerWidth <= 700;
				map.fitBounds(bounds, { paddingTopLeft: mobile ? [35, 45] : [460, 60], paddingBottomRight: [40, 70], maxZoom: 18 });
			}
			focusLayer.eachLayer(layer => { if ('bringToFront' in layer) (layer as import('leaflet').Path).bringToFront(); });
		});
	});

	function textLabel(text: string) {
		const span = document.createElement('span');
		span.textContent = text;
		return span;
	}

	$effect(() => {
		if (!ready) return;
		const points = app.examplePoints;
		void import('leaflet').then(({ default: L }) => {
			if (destroyed || !samples) return;
			samples.clearLayers();
			for (const [i, p] of points.entries()) {
				L.circleMarker([p.lat, p.lon], { radius: 8, color: '#1a1a1a', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
					.bindTooltip(textLabel(`Example ${i + 1}`)).addTo(samples);
			}
		});
	});

	onDestroy(() => {
		destroyed = true;
		map?.remove();
	});
</script>

<div class="map" bind:this={el}></div>
{#if app.elements.length || grouping}
	<div class="group-legend">
		<label><input type="checkbox" bind:checked={clusterEnabled} /> Group nearby pins</label>
		{#if shapeCount}<small>{shapeCount} road / area shapes · hover for details</small>{/if}
		{#if grouping}
		<label><input type="checkbox" bind:checked={showGroups} /> Nearby groups · {grouping.groups.length}{grouping.truncated ? ` of ${grouping.totalGroups}` : ''}</label>
		<small>Circles show straight-line proximity to mapped centers.</small>
		{/if}
	</div>
{/if}

<style>
	:global(.leaflet-marker-icon.waypoint-cluster) { display: grid; place-items: center; border-radius: 50%; background: #d4f542; color: #172025; border: 3px solid #1d252b; box-shadow: 0 0 0 5px #d4f54244; font: 700 14px system-ui; }
	:global(.waypoint-cluster:focus-visible) { outline: 3px solid #fff; outline-offset: 3px; }
	.group-legend { position: absolute; bottom: 28px; left: 460px; z-index: 500; padding: 10px 14px; border-radius: 12px; background: #1d252bec; color: #f0f4ee; max-width: 300px; font-size: 13px; }
	.group-legend label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
	.group-legend input { accent-color: #55c9f5; }
	.group-legend small { display: block; margin-top: 5px; color: #b7c6cc; font-size: 11px; }
	@media (max-width: 700px) { .group-legend { left: 12px; bottom: calc(58dvh + 12px); max-width: 230px; } }
	.map {
		position: absolute;
		inset: 0;
		z-index: 0;
	}
	@media (max-width: 700px) { .map { bottom: 58dvh; } }
</style>
