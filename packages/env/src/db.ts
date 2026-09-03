import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

import "@/lib/utils"
import { NODE_ENV } from "@/lib/constants"
import { polyfillServer } from "@/lib/polyfill"

export const env = createEnv({
  server: {
    NODE_ENV,
    POSTGRES_URL: z.url(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    // POSTGRES_URL is used VERBATIM. Do not reintroduce a host rewrite here.
    //
    // This used to swap "localhost" for "host.docker.internal" whenever INTERNAL_API_URL was set,
    // on the assumption that anything setting that variable was running inside a container. That
    // assumption is wrong: INTERNAL_API_URL is about how the Next server reaches the API, and says
    // nothing about where Postgres lives. Setting it on a macOS host silently rewrote a working
    // database URL into a hostname that does not resolve outside Docker, and every query in the
    // app started failing with ENOTFOUND - with the connection string in .env still looking
    // perfectly correct. If a container needs a different host, it sets a different POSTGRES_URL.
    POSTGRES_URL: polyfillServer(process.env.POSTGRES_URL, "postgres://polyfill.local:5432/db"),
  },
  emptyStringAsUndefined: true,
})
