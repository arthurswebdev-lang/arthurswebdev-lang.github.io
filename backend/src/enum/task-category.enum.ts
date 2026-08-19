/**
 * Fixed set — categories are part of the code, not data, so there are no
 * endpoints to create or rename them. Each keeps its slot: adding one later
 * appends, it never re-shuffles the others.
 *
 * `OTHER` is the bucket for anything created without picking a category, which
 * keeps the field non-nullable and makes "uncategorised" filterable like any
 * other value.
 */
export enum TaskCategory {
  IMPORTANT = 'IMPORTANT',
  WORK = 'WORK',
  SUPPLEMENTS = 'SUPPLEMENTS',
  FOOD = 'FOOD',
  EDUCATION = 'EDUCATION',
  SELFCARE = 'SELFCARE',
  GYM = 'GYM',
  READING = 'READING',
  OTHER = 'OTHER',
}
