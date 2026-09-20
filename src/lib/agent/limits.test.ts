import { describe, expect, it } from 'vitest';
import { assertSearchBounds } from './limits';

describe('geographic query budget', () => {
	it('accepts a city or campus viewport', () => {
		expect(() => assertSearchBounds({ south: 37.2, north: 37.3, west: -80.5, east: -80.3 })).not.toThrow();
	});
	it.each([
		{ south: 36, north: 40, west: -84, east: -75 },
		{ south: 37, north: 37.01, west: -84, east: -75 },
		{ south: 0, north: 1, west: 0, east: 1 }
	])('rejects large regions and long thin queries %#', bounds => {
		expect(() => assertSearchBounds(bounds)).toThrow('too large');
	});
	it.each([
		{ south: 38, north: 37, west: -81, east: -80 },
		{ south: 37, north: 38, west: 170, east: -170 },
		{ south: NaN, north: 38, west: -81, east: -80 }
	])('rejects invalid bounds %#', bounds => {
		expect(() => assertSearchBounds(bounds)).toThrow('invalid');
	});
});
