<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { app } from './state.svelte';
	import { createChatSession, progressLabel } from './chat';
	import TraceList from './TraceList.svelte';
	import { turnElements } from './mentions';
	import MarkdownAnswer from './MarkdownAnswer.svelte';

	const session = createChatSession(app);
	let draft = $state('');
	let input: HTMLTextAreaElement;
	let content: HTMLDivElement;
	let nearBottom = $state(true);
	const demos = ['Which dorm at Virginia Tech has the most cafés within 800 m?', 'Cafés in Blacksburg with outdoor seating'];
	const current = $derived(app.turns.at(-1));
	const announcement = $derived(current ? progressLabel(current) : '');

	function jumpToLatest() { if (content) content.scrollTop = content.scrollHeight; nearBottom = true; }
	function onScroll() { nearBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 80; }
	$effect(() => {
		// Follow actual content updates, without moving readers who scrolled back.
		JSON.stringify(app.turns.map(t => [t.answer, t.events.length, t.status]));
		if (nearBottom) void tick().then(jumpToLatest);
	});
	async function send(text: string) {
		if (!text.trim() || app.busy) return;
		draft = ''; nearBottom = true;
		await session.send(text);
	}
	function onSubmit(e: SubmitEvent) { e.preventDefault(); void send(draft); }
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
			e.preventDefault(); if (!e.repeat) void send(draft);
		}
	}
	function clearChat() { session.clear(); draft = ''; nearBottom = true; input?.focus(); }
	onDestroy(() => session.stop());
</script>

<aside aria-label="Map search">
	<header>
		<div class="brand"><span class="brand-mark" aria-hidden="true">✳</span><div><h1>MapMind</h1><p>Your map, in conversation</p></div></div>
		<button class="icon-button clear" type="button" aria-label="Clear chat" title="Clear chat" disabled={!app.turns.length && !draft && !app.examplePoints.length && !app.exampleMode} onclick={clearChat}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
		</button>
	</header>
	<div class="content" bind:this={content} onscroll={onScroll}>
		{#if !app.turns.length}
			<div class="welcome"><div class="welcome-mark" aria-hidden="true">✳</div><h2>What’s out there?</h2><p>Find your next spot, explore a neighborhood,<br />or ask what’s nearby.</p>
				<div class="demos">{#each demos as question}<button type="button" onclick={() => void send(question)}>{question}<span aria-hidden="true">↗</span></button>{/each}</div>
			</div>
		{/if}
		<div class="conversation" role="log" aria-label="Conversation" aria-live="off">
			{#each app.turns as turn (turn.id)}
				<article class="turn" aria-label="Search conversation">
					<div class="user"><span class="sr-only">You: </span>{turn.question}</div>
					<div class="assistant">
						<div class="assistant-name"><span aria-hidden="true">✳</span> MapMind</div>
						<details class="activity">
							<summary><span class:working={turn.status === 'working'} class="activity-dot" aria-hidden="true"></span><span>{progressLabel(turn)}</span><span class="chevron" aria-hidden="true">›</span></summary>
							<div class="activity-body"><p class="detail-heading">Search details</p><TraceList events={turn.events} busy={turn.status === 'working'} /></div>
						</details>
						{#if turn.answer}<MarkdownAnswer text={turn.answer} elements={turnElements(turn.events)} />{/if}
						{#if turn.status === 'error'}<div class="error" role="alert"><p>That search couldn’t finish.</p><p class="error-detail">{turn.error}</p></div>{/if}
						{#if turn.status === 'stopped' && !turn.answer}<p class="stopped">You stopped this search.</p>{/if}
						{#if (turn.status === 'stopped' || turn.status === 'error') && turn === current}<button class="retry" type="button" disabled={app.busy} onclick={() => void session.retry(turn)}>↻ Try again</button>{/if}
					</div>
				</article>
			{/each}
		</div>
	</div>
	{#if !nearBottom}<button class="jump" type="button" onclick={jumpToLatest}>↓ Jump to latest</button>{/if}
	<div class="compose-area">
		<div class="mode">
			<button class:on={app.exampleMode} aria-pressed={app.exampleMode} type="button" disabled={app.busy} onclick={() => (app.exampleMode = !app.exampleMode)}><span aria-hidden="true">⌖</span> Select examples</button>
			{#if app.examplePoints.length}<button type="button" disabled={app.busy} onclick={() => (app.examplePoints = [])}>Clear {app.examplePoints.length}</button><button class="find-similar" type="button" disabled={app.busy || app.examplePoints.length < 2} onclick={() => void send(`Find places like these ${app.examplePoints.length} examples I clicked on the map.`)}>Find similar ↗</button>{/if}
		</div>
		{#if app.exampleMode}<p class="selection-hint">Select 2–3 places on the map. {app.examplePoints.length}/3 selected.</p>{/if}
		<form onsubmit={onSubmit}>
			<textarea bind:this={input} bind:value={draft} onkeydown={onKeydown} rows="2" maxlength="8000" aria-label="Ask the map" aria-describedby="input-hint" placeholder={app.busy ? 'Write your next question…' : 'Ask anything about the map…'}></textarea>
			<div class="composer-bottom"><span>Explore with MapMind</span>
				{#if app.busy}<button class="send stop" type="button" aria-label="Stop search" title="Stop search" onclick={() => session.stop()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg></button>{:else}<button class="send" type="submit" aria-label="Send message" title="Send message" disabled={!draft.trim()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>{/if}
			</div>
		</form>
		<p class="input-hint" id="input-hint">Enter to send <span aria-hidden="true">·</span> Shift+Enter for a new line</p>
	</div>
	<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
</aside>

<style>
	aside { position: absolute; z-index: 500; top: 16px; left: 16px; bottom: 16px; width: min(420px, calc(100vw - 32px)); display: flex; flex-direction: column; background: #171c23f5; border: 1px solid #ffffff14; border-radius: 22px; backdrop-filter: blur(20px); box-shadow: 0 12px 48px #0004; overflow: hidden; color: var(--paper); }
	header { display: flex; align-items: center; justify-content: space-between; padding: 20px; border-bottom: 1px solid #ffffff0b; }
	.brand { display: flex; align-items: center; gap: 10px; }.brand-mark { color: var(--lime); font-size: 32px; }
	h1 { margin: 0; font-size: 19px; letter-spacing: -.6px; font-weight: 600; }header p { margin: 3px 0 0; color: #a1a8ad; font-size: 11px; }
	button { font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer; transition: background .15s; }button:hover:enabled { background: #ffffff0d; }button:disabled { opacity: .35; cursor: not-allowed; }button:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--lime); outline-offset: 3px; }
	.icon-button { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: #a1a8ad; }svg { width: 20px; height: 20px; }
	.content { flex: 1; min-height: 0; overflow: auto; overflow-wrap: anywhere; padding: 24px 20px; scrollbar-width: thin; scrollbar-color: #ffffff25 transparent; }
	.welcome { padding-top: clamp(10px, 5vh, 64px); }.welcome-mark { font-size: 42px; color: var(--lime); margin-bottom: 16px; }h2 { font-size: 27px; font-weight: 500; letter-spacing: -.8px; margin: 0 0 10px; }.welcome p { font-size: 14px; line-height: 1.7; color: #a1a8ad; margin: 0; }
	.demos { display: grid; gap: 8px; margin-top: 28px; }.demos button { display: flex; align-items: center; gap: 16px; text-align: left; padding: 13px 14px; border: 1px solid #ffffff12; border-radius: 12px; font-size: 12px; line-height: 1.6; }.demos span { margin-left: auto; color: #a1a8ad; }
	.conversation { display: flex; flex-direction: column; gap: 28px; }.user { width: fit-content; max-width: 90%; margin-left: auto; border-radius: 18px 18px 4px 18px; background: #2b333d; padding: 12px 16px; font-size: 14px; line-height: 1.65; white-space: pre-wrap; }.assistant { margin-top: 22px; }.assistant-name { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; margin-bottom: 10px; }.assistant-name span { color: var(--lime); font-size: 20px; }
	.activity { margin-bottom: 12px; }summary { display: flex; align-items: center; gap: 8px; width: fit-content; cursor: pointer; list-style: none; color: #a1a8ad; font-size: 12px; padding: 5px 0; }summary::-webkit-details-marker { display: none; }.activity-dot { width: 6px; height: 6px; border-radius: 50%; background: #849080; }.activity-dot.working { background: var(--lime); animation: pulse 1.5s ease-in-out infinite; }.chevron { font-size: 20px; line-height: 12px; transition: transform .15s; }details[open] .chevron { transform: rotate(90deg); }.activity-body { margin-top: 10px; padding: 12px; border: 1px solid #ffffff12; border-radius: 12px; background: #10141b80; }.detail-heading { font-size: 11px; color: #a1a8ad; margin: 0 0 12px; }.stopped, .error { font-size: 13px; line-height: 1.6; }.stopped { color: #a1a8ad; }.error { border-left: 2px solid var(--danger); padding-left: 12px; }.error p { margin: 4px 0; }.error-detail { color: #a1a8ad; }.retry { margin-top: 10px; padding: 8px 12px; border: 1px solid #ffffff20; border-radius: 9px; font-size: 12px; }
	.jump { align-self: center; border: 1px solid #ffffff20; border-radius: 20px; padding: 7px 14px; font-size: 12px; margin-bottom: 8px; background: #252d36; }
	.compose-area { padding: 10px 16px 14px; }.mode { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }.mode button { padding: 7px 8px; border-radius: 8px; font-size: 11px; color: #a1a8ad; }.mode .on { color: var(--lime); background: #d4f54210; }.mode .find-similar { color: var(--paper); }.selection-hint { font-size: 11px; color: #a1a8ad; margin: 0 0 10px; }
	form { padding: 12px; border: 1px solid #ffffff20; border-radius: 17px; background: #222932; }form:focus-within { border-color: #d4f54270; }textarea { display: block; width: 100%; field-sizing: content; min-height: 46px; max-height: 140px; resize: none; background: transparent; border: 0; color: var(--paper); font-size: 14px; line-height: 1.6; padding: 0; }textarea:focus-visible { outline: none; }textarea::placeholder { color: #919ba5; }.composer-bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }.composer-bottom > span { color: #919ba5; font-size: 10px; }.send { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--lime); color: var(--ink); }.send:hover:enabled { background: #e1ff65; }.stop { background: var(--paper); }.input-hint { font-size: 10px; color: #919ba5; text-align: center; margin: 9px 0 0; }.input-hint span { padding: 0 4px; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	@keyframes pulse { 0%, 100% { opacity: .4; box-shadow: 0 0 0 0 #d4f54200; }50% { opacity: 1; box-shadow: 0 0 0 4px #d4f54215; } }
	@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
	@media (max-width: 700px) { aside { top: 42dvh; bottom: 0; left: 0; width: 100%; border-radius: 20px 20px 0 0; }header { padding: 12px 16px; }.brand-mark { font-size: 26px; }header p { display: none; }.content { padding: 16px; }.welcome { padding-top: 0; }.welcome-mark { display: none; }h2 { font-size: 23px; }.demos { margin-top: 16px; }.compose-area { padding-bottom: max(10px, env(safe-area-inset-bottom)); }textarea { font-size: 16px; }.input-hint { display: none; } }
</style>
