<script lang="ts">
	import type { AgentEvent } from '$lib/agent/events';
	let { events, busy = false }: { events: AgentEvent[]; busy?: boolean } = $props();

	function label(event: AgentEvent): string {
		switch (event.type) {
			case 'status':
				return event.message;
			case 'tool_call':
				return `tool → ${event.name}`;
			case 'tool_result':
				return `${event.result && typeof event.result === 'object' && 'error' in event.result ? 'Needs attention' : 'Completed'}: ${event.name}`;
			case 'plan':
				return 'typed plan';
			case 'oql':
				return 'compiled OverpassQL';
			case 'explain':
				return event.text;
			case 'results':
				return `${event.count} elements`;
			case 'answer':
				return 'answer';
			case 'error':
				return event.message;
			case 'done':
				return 'done';
		}
	}
</script>

<ol>
	{#each events as event, i (i)}
		<li class={event.type}>
			<span class="kind">{event.type}</span>
			<span class="body">
				{label(event)}
				{#if event.type === 'tool_result' && event.result && typeof event.result === 'object' && 'error' in event.result}
					<pre>{String(event.result.error)}</pre>
				{/if}
				{#if event.type === 'tool_call'}<details><summary>Arguments</summary><pre>{JSON.stringify(event.args, null, 2)}</pre></details>{/if}
				{#if event.type === 'tool_result'}<details><summary>Result</summary><pre>{JSON.stringify(event.result, null, 2)}</pre></details>{/if}
				{#if event.type === 'plan'}<details><summary>Plan</summary><pre>{JSON.stringify(event.plan, null, 2)}</pre></details>{/if}
				{#if event.type === 'oql'}
					<pre>{event.oql}</pre>
				{/if}
			</span>
		</li>
	{/each}
	{#if busy && events.length === 0}
		<li class="status"><span class="kind">status</span><span class="body">waiting on the agent…</span></li>
	{/if}
</ol>

<style>
	summary { cursor: pointer; color: var(--muted); margin-top: 6px; }
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	li {
		display: grid;
		grid-template-columns: 68px minmax(0, 1fr);
		gap: 8px;
		font-size: 12px;
		line-height: 1.4;
	}
	.kind {
		font-family: var(--mono);
		color: var(--lime-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 10px;
		padding-top: 2px;
	}
	.error .kind {
		color: var(--danger);
	}
	.tool_call .kind {
		color: #7dd3fc;
	}
	pre {
		margin: 6px 0 0;
		padding: 8px;
		background: #0c1016;
		border: 1px solid var(--panel-border);
		color: var(--lime);
		font-family: var(--mono);
		font-size: 11px;
		white-space: pre-wrap;
		overflow: auto;
		max-height: 140px;
	}
</style>
