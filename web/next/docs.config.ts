import type { DocsConfig } from "./src/lib/docs"

const docsConfig = {
  docs: {
    "Getting Started": [
      {
        "/docs": {
          title: "Introduction",
          description: "AI Risk Manager: coordinated fraud rings, not single payments.",
        },
      },
    ],
    Architecture: [
      {
        "/docs/architecture": {
          title: "Architecture",
          description: "Dashboard, Hono API, Postgres, Python detector, TypeScript fallback.",
        },
      },
      {
        "/docs/api": {
          title: "HTTP API",
          description: "Clusters, holds, ingest, voice, metrics.",
        },
      },
      {
        "/docs/detector": {
          title: "Detector",
          description: "Graph, Louvain, corroboration scoring, hybrid model.",
        },
      },
    ],
  },
  console: {
    "Getting Started": [
      {
        "/console/docs": {
          title: "Console",
          description: "Operator screens and what each one is for.",
        },
      },
    ],
  },
} satisfies DocsConfig

export default docsConfig
