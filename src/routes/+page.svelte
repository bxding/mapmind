<script lang="ts">
	import MapCanvas from '$lib/ui/MapCanvas.svelte';
	import AboutDialog from '$lib/ui/AboutDialog.svelte';
	import ChatDock from '$lib/ui/ChatDock.svelte';
</script>

<svelte:head>
	<title>MapMind — search OpenStreetMap</title>
	<meta name="description" content="Search OpenStreetMap in plain English." />
</svelte:head>

<main>
	<MapCanvas />
	<ChatDock />
	<AboutDialog />
</main>

<style>
	main { position: relative; height: 100%; min-height: 100dvh; }
</style>
