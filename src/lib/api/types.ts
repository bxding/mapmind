import type { Plan } from '$lib/oql/plan';

export type ChatMessage = {
	role: 'user' | 'assistant';
	content: string;
};

export type ExamplePoint = {
	lat: number;
	lon: number;
};

export type AgentRequest = {
	messages: ChatMessage[];
	previousPlan?: Plan;
	bbox?: { south: number; west: number; north: number; east: number };
	examplePoints?: ExamplePoint[];
	date?: string;
	adiff?: [string, string];
};

export type OverpassRequest = {
	query: string;
};
