import { env } from "@packages/env/db"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "@/schema"
import type { Database } from "@/types"

declare global {
  var db: Database | undefined
}

const requiresSsl =
  env.POSTGRES_URL.includes("sslmode=require") ||
  env.POSTGRES_URL.includes("supabase.co") ||
  env.POSTGRES_URL.includes("neon.tech") ||
  env.NODE_ENV === "production"

const client = postgres(env.POSTGRES_URL, {
  ssl: requiresSsl ? "require" : undefined,
  max: env.NODE_ENV === "production" ? 10 : 5,
  idle_timeout: 30,
  connect_timeout: 10,
})

const db: Database = globalThis.db ?? drizzle(client, { schema })

if (env.NODE_ENV !== "production") {
  globalThis.db = db
}

export { db }
export * from "@/console"
export * from "@/schema"
export type * from "@/types"
