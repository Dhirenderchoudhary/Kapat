import { resolver } from "hono-openapi"
import type { z } from "zod"

// Spreads into describeRoute so Scalar's Try It sends a real JSON body instead of an empty POST.
// Cast matches the existing x-codeSamples `as object` escape: resolver() is a runtime schema
// handle, not an OpenAPI SchemaObject at the type level.
export function jsonRequestBody(schema: z.ZodType) {
  return {
    requestBody: {
      required: true,
      content: {
        "application/json": { schema: resolver(schema) },
      },
    },
  } as object
}
