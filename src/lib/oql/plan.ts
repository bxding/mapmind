import { z } from 'zod';

export const elementTypeSchema = z.enum(['node', 'way', 'relation', 'nwr']);
export type ElementType = z.infer<typeof elementTypeSchema>;

export const filterOpSchema = z.enum(['=', '!=', '~', 'exists', '!exists']);
export type FilterOp = z.infer<typeof filterOpSchema>;

export const tagFilterSchema = z.object({
	key: z.string().min(1).max(128),
	op: filterOpSchema,
	value: z.string().max(256).optional()
});
export type TagFilter = z.infer<typeof tagFilterSchema>;

export const withinSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('scope') }),
	z.object({
		kind: z.literal('around'),
		set: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
		radius: z.number().min(1).max(100000)
	}),
	z.object({ kind: z.literal('inside'), set: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/) })
]);
export type Within = z.infer<typeof withinSchema>;

export const setSchema = z.object({
	name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
	types: z.array(elementTypeSchema).min(1).max(4),
	filters: z.array(tagFilterSchema).max(12).default([]),
	within: withinSchema.default({ kind: 'scope' })
});
export type PlanSet = z.infer<typeof setSchema>;

export const scopeSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('place'),
		name: z.string().min(1).max(200),
		areaId: z.number().int().positive().optional()
	}),
	z.object({
		kind: z.literal('bbox'),
		south: z.number().min(-90).max(90),
		west: z.number().min(-180).max(180),
		north: z.number().min(-90).max(90),
		east: z.number().min(-180).max(180)
	}),
	z.object({ kind: z.literal('global') })
]);
export type Scope = z.infer<typeof scopeSchema>;

export const outputSchema = z.object({
	mode: z.enum(['center', 'geom', 'skel', 'count', 'tags']),
	limit: z.number().int().min(1).max(2000).optional()
});
export type Output = z.infer<typeof outputSchema>;

export const planSchema = z.object({
	scope: scopeSchema,
	date: z.iso.datetime().optional(),
	adiff: z.tuple([z.iso.datetime(), z.iso.datetime()]).optional(),
	timeout: z.number().int().min(1).max(60).optional(),
	sets: z.array(setSchema).min(1).max(8),
	combine: z
		.object({
			op: z.enum(['union', 'difference']),
			of: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/)).min(2).max(8)
		})
		.optional(),
	recurse: z.enum(['down', 'none']).optional(),
	output: outputSchema.default({ mode: 'center', limit: 200 })
}).strict();
export type Plan = z.infer<typeof planSchema>;

export function parsePlan(input: unknown): Plan {
	return planSchema.parse(input);
}
