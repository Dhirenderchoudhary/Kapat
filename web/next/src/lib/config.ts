import { BUILD_VERSION } from "@packages/env"
import { env } from "@packages/env/web-next"

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Server-side API host. Taken only from env. Never a baked production URL: a missing
 * INTERNAL_API_URL used to fall through to a deployed host, so local server renders silently
 * read production data. If the public API URL is the same origin as the website (same-origin
 * /api rewrite), INTERNAL_API_URL must be set to the real API process or this returns
 * undefined and calls fail closed instead of looping.
 */
const getInternalApiUrl = () => {
  if (typeof window !== "undefined") return undefined
  if (env.INTERNAL_API_URL) return env.INTERNAL_API_URL
  const web = originOf(env.NEXT_PUBLIC_APP_URL)
  const pub = originOf(env.NEXT_PUBLIC_API_URL)
  if (pub && web && pub === web) return undefined
  return env.NEXT_PUBLIC_API_URL
}

export const config = {
  app: {
    url: env.NEXT_PUBLIC_APP_URL,
    version: BUILD_VERSION,
  },
  api: {
    url: env.NEXT_PUBLIC_API_URL,
    internalUrl: getInternalApiUrl(),
  },
} as const
