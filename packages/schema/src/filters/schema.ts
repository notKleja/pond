import { z } from "zod";
import { FIELD_IDS } from "./meta";
import {
  COMPARATORS_BY_TYPE,
  type ComparatorId,
  type FieldId,
  type Predicate,
  type Query,
} from "./types";

/** SAFETY: FIELD_IDS is derived from the non-empty FIELD_DESCRIPTORS registry. */
const fieldIds = FIELD_IDS as readonly [FieldId, ...FieldId[]];
/** SAFETY: COMPARATORS_BY_TYPE declares at least one comparator. */
const operatorIds = [...new Set(Object.values(COMPARATORS_BY_TYPE).flat())] as [
  ComparatorId,
  ...ComparatorId[],
];

export const PredicateSchema: z.ZodType<Predicate> = z.object({
  id: z.string().optional(),
  field: z.enum(fieldIds),
  operator: z.enum(operatorIds),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string(), z.number()])),
    z.object({ hex: z.string(), tolerance: z.number() }),
  ]),
  negate: z.boolean().optional(),
});

export const QuerySchema: z.ZodType<Query> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    combinator: z.enum(["and", "or"]),
    not: z.boolean().optional(),
    rules: z.array(z.union([PredicateSchema, QuerySchema])),
  }),
);
