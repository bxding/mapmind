import type { AgentEvent, MapElement } from '$lib/agent/events';

export function turnElements(events: AgentEvent[]): MapElement[] {
	const elements = new Map<string, MapElement>();
	for (const event of events) if (event.type === 'results') for (const e of event.elements) elements.set(`${e.type}/${e.id}`, e);
	return [...elements.values()];
}
export function mentionMatcher(elements: MapElement[]) {
	const names = new Map<string, MapElement[]>();
	for (const e of elements) {
		if (!e.geometry && (e.lat == null || e.lon == null)) continue;
		for (const name of [e.tags?.name, e.tags?.['addr:housename'], e.tags?.operator, `${e.type}/${e.id}`]) {
			if (!name || name.length < 3 || name.length > 300) continue;
			const key = name.toLocaleLowerCase();
			const found = names.get(key) ?? [];
			if (!found.some(f => f.type === e.type && f.id === e.id)) found.push(e);
			names.set(key, found);
		}
	}
	const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = names.size ? new RegExp(`(?<![\\p{L}\\p{N}_])(${[...names.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'giu') : null;
	return (text: string) => pattern ? [...text.matchAll(pattern)].map(m => ({ start: m.index!, text: m[0], elements: names.get(m[0].toLocaleLowerCase())! })) : [];
}

/** Link text nodes after sanitization, preserving Markdown formatting and safe external links. */
export function linkMapMentions(root: HTMLElement, elements: MapElement[], focus: (items: MapElement[]) => void) {
	for (const old of root.querySelectorAll('button.map-mention')) old.replaceWith(document.createTextNode(old.textContent ?? ''));
	root.normalize();
	const match = mentionMatcher(elements);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		if (!node.parentElement?.closest('a, button, code, pre')) nodes.push(node);
	}
	for (const node of nodes) {
		const text = node.textContent ?? '';
		const matches = match(text);
		if (!matches.length) continue;
		const fragment = document.createDocumentFragment();
		let position = 0;
		for (const hit of matches) {
			fragment.append(document.createTextNode(text.slice(position, hit.start)));
			const button = document.createElement('button');
			button.type = 'button'; button.className = 'map-mention'; button.textContent = hit.text;
			button.title = hit.elements.length > 1 ? `Show ${hit.elements.length} matching places on the map` : 'Show on map';
			button.onclick = () => focus(hit.elements);
			fragment.append(button); position = hit.start + hit.text.length;
		}
		fragment.append(document.createTextNode(text.slice(position))); node.replaceWith(fragment);
	}
	for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
		const osm = /^https?:\/\/(?:www\.)?openstreetmap\.org\/(node|way|relation)\/(\d+)\/?(?:[?#].*)?$/.exec(anchor.href);
		const found = osm && elements.filter(e => e.type === osm[1] && String(e.id) === osm[2] && (e.geometry || (e.lat != null && e.lon != null)));
		if (found?.length) { anchor.title = 'Show on map'; anchor.onclick = event => { event.preventDefault(); focus(found); }; }
	}
}
