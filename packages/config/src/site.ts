// Brand identity for this app: the single source a fork edits to rebrand. web reads it via lib/config.ts.
export const site = {
  name: "AI Risk Manager",
  description:
    "Detects coordinated fraud rings that per-transaction scoring misses. Graph corroboration, voice verification, merchant decision.",
  tagline: "Rings, not single payments.",
  social: {
    discord: "",
    github: "",
    x: "",
  },
  // Local-only dev agent identity (api/hono agents router).
  agent: {
    name: "LocalAgent",
    email: "agent@local.host",
  },
  apiReferenceDescription:
    "Hono API for cluster detection, payment holds, Sarvam voice, and Razorpay ingest. The agent never captures or refunds except on a named merchant decision.",
  llmsFullPreamble: "",
} as const

export type Site = typeof site

// Optional surfaces a fork enables or disables. Typed boolean (not `as const`) so a fork can flip them and the runtime gates are not dead code. Off means the routes 404 and the links, nav, sitemap, llms, and search drop the surface. waitlist off makes the home a plain landing page.
export const features = {
  allowlist: false,
  apiDocs: true,
  blog: true,
  docs: true,
  internalDocs: true,
  waitlist: false,
}

export type Feature = keyof typeof features
