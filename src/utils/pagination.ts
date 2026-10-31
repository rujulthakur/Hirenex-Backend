import { z } from 'zod';

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  sort: z.string().trim().max(100).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

export interface PageOptions {
  page: number;
  limit: number;
  skip: number;
}

export type SortSpec = Record<string, 1 | -1>;

export function toPageOptions(query: Pick<PaginationQuery, 'page' | 'limit'>): PageOptions {
  return { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
}

/**
 * "?sort=-totalScore,rank" -> { totalScore: -1, rank: 1 }.
 * Only fields in `allowed` are honoured, so clients cannot sort on arbitrary (unindexed or private) fields.
 */
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: SortSpec,
): SortSpec {
  if (!sort) return fallback;
  const spec: SortSpec = {};
  for (const raw of sort.split(',')) {
    const part = raw.trim();
    if (part.length === 0) continue;
    const direction: 1 | -1 = part.startsWith('-') ? -1 : 1;
    const field = part.replace(/^[-+]/, '');
    if (allowed.includes(field)) spec[field] = direction;
  }
  return Object.keys(spec).length > 0 ? spec : fallback;
}

export function buildMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total };
}
