import { EMPTY_QUERY } from "@pond/schema/filters/types";
import { expect, it } from "vitest";
import { z } from "zod";
import { LibraryQueryRequestSchema } from "../../../shared/library-query";

it("publishes the library query tool as JSON Schema", () => {
  expect(() => z.toJSONSchema(LibraryQueryRequestSchema)).not.toThrow();
});

it("accepts a nested library query and fills the empty default", () => {
  expect(LibraryQueryRequestSchema.parse({})).toMatchObject({
    query: EMPTY_QUERY,
  });
  expect(
    LibraryQueryRequestSchema.parse({
      keywords: "pond",
      query: {
        combinator: "and",
        rules: [
          {
            combinator: "or",
            rules: [{ field: "source", operator: "eq", value: "twitter" }],
          },
        ],
      },
    }),
  ).toMatchObject({
    keywords: "pond",
    query: {
      combinator: "and",
      rules: [
        {
          combinator: "or",
          rules: [{ field: "source", operator: "eq", value: "twitter" }],
        },
      ],
    },
  });
});
