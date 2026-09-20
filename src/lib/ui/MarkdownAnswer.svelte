<script lang="ts">
	import type { MapElement } from '$lib/agent/events';
	import { app } from './state.svelte';
	import { linkMapMentions } from './mentions';
	import { renderMarkdown } from './markdown';
	let { text, elements = [] }: { text: string; elements?: MapElement[] } = $props();
	let container: HTMLDivElement;
	$effect(() => {
		html;
		if (container) linkMapMentions(container, elements, items => { app.mapFocus = { elements: items }; });
	});
	const html = $derived(renderMarkdown(text));
</script>

<div class="markdown" bind:this={container}>{@html html}</div>

<style>
	.markdown :global(.map-mention) { display: inline; padding: 0; border: 0; background: none; font: inherit; color: var(--lime); text-align: inherit; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; cursor: pointer; }
	.markdown :global(.map-mention:hover) { text-decoration-style: solid; }
	.markdown :global(.map-mention:focus-visible) { outline: 2px solid var(--lime); outline-offset: 3px; border-radius: 2px; }
	.markdown { font-size: 14px; line-height: 1.8; overflow-wrap: anywhere; }
	.markdown :global(p) { margin: 0 0 12px; }
	.markdown :global(h1), .markdown :global(h2), .markdown :global(h3), .markdown :global(h4), .markdown :global(h5), .markdown :global(h6) { font-weight: 600; line-height: 1.4; margin: 20px 0 8px; }
	.markdown :global(h1) { font-size: 21px; }.markdown :global(h2) { font-size: 18px; }.markdown :global(h3) { font-size: 16px; }
	.markdown :global(h4), .markdown :global(h5), .markdown :global(h6) { font-size: 14px; }
	.markdown :global(strong) { font-weight: 650; }
	.markdown :global(ul), .markdown :global(ol) { padding-left: 23px; margin: 8px 0 14px; }
	.markdown :global(li) { padding-left: 3px; margin: 5px 0; }
	.markdown :global(li > p) { margin: 0 0 6px; }
	.markdown :global(a) { color: var(--lime); text-decoration: underline; text-underline-offset: 3px; }
	.markdown :global(a:focus-visible) { outline: 2px solid var(--lime); outline-offset: 3px; }
	.markdown :global(code) { font-family: var(--mono); font-size: .88em; background: #ffffff0c; border-radius: 4px; padding: 2px 5px; }
	.markdown :global(pre) { max-width: 100%; overflow-x: auto; background: #10141b; border: 1px solid #ffffff12; border-radius: 10px; padding: 12px; line-height: 1.6; }
	.markdown :global(pre code) { padding: 0; background: transparent; white-space: pre; }
	.markdown :global(blockquote) { margin: 12px 0; padding-left: 14px; border-left: 2px solid var(--lime-dim); color: #a1a8ad; }
	.markdown :global(hr) { border: 0; border-top: 1px solid #ffffff20; margin: 20px 0; }
	.markdown :global(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 12px; margin: 12px 0; }
	.markdown :global(th), .markdown :global(td) { border: 1px solid #ffffff20; padding: 8px 10px; text-align: left; }
	.markdown :global(th) { background: #ffffff08; font-weight: 600; }
	.markdown > :global(:first-child) { margin-top: 0; }.markdown > :global(:last-child) { margin-bottom: 0; }
</style>
