<script lang="ts">
	let dialog: HTMLDialogElement;
</script>

<button class="info" type="button" aria-label="About MapMind" title="About MapMind" onclick={() => dialog.showModal()}>i</button>
<dialog bind:this={dialog} aria-labelledby="about-title">
	<header><h2 id="about-title">About MapMind</h2><button type="button" aria-label="Close about window" onclick={() => dialog.close()}>✕</button></header>
	<p>Built by <strong>Brian Ding</strong> and <strong>Advay Iyer</strong>.</p>
	<p>MapMind turns plain-English questions into searches of OpenStreetMap, with a map and a visible record of each search.</p>
	<p>Research credit: Staniek, Schumann, Züfle, and Riezler,
		<a href="https://aclanthology.org/2024.tacl-1.31/" target="_blank" rel="noreferrer">Text-to-OverpassQL</a> (TACL 2024).
		We use examples from their <a href="https://github.com/raphael-sch/OverpassNL" target="_blank" rel="noreferrer">OverpassNL dataset</a>.</p>
	<p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, available under the ODbL.
		Searches use the <a href="https://overpass-api.de/" target="_blank" rel="noreferrer">Overpass API</a>, Nominatim, and taginfo.</p>
	<p>Language model: Qwen3.5, served through Open WebUI.</p>
	<form method="dialog"><button type="submit">Close</button></form>
</dialog>

<style>
	.info { position: absolute; top: max(16px, env(safe-area-inset-top)); right: max(16px, env(safe-area-inset-right)); z-index: 600; width: 36px; height: 36px; border-radius: 50%; font-family: Georgia, serif; font-style: italic; font-size: 17px; }
	button { border: 1px solid var(--panel-border); background: var(--ink); color: var(--paper); cursor: pointer; padding: 6px 12px; }
	button:focus-visible, a:focus-visible { outline: 2px solid var(--lime); outline-offset: 4px; }
	dialog { width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow: auto; padding: 24px; border: 1px solid var(--panel-border); background: var(--ink); color: var(--paper); line-height: 1.6; font-size: 14px; }
	dialog::backdrop { background: rgb(0 0 0 / 60%); }
	header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
	h2 { margin: 0; font-size: 21px; }
	a { color: var(--lime); }
	form { display: flex; justify-content: flex-end; }

</style>
