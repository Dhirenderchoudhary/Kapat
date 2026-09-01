import { BUILD_VERSION } from "@packages/env"
import { env } from "@packages/env/web-next"

// Server-only env vars
const getInternalApiUrl = () => {
  if (typeof window === "undefined") {
    return env.INTERNAL_API_URL
  }
  return undefined
}

const getClientApiUrl = () => {
  return env.NEXT_PUBLIC_API_URL || ""
}

export const config = {
  // Runtime / env-derived app values (NOT brand, brand lives in @packages/config/site)
  app: {
    url: env.NEXT_PUBLIC_APP_URL,
    version: BUILD_VERSION,
  },

  // API configuration
  api: {
    url: getClientApiUrl(),
    internalUrl: getInternalApiUrl(),
  },
} as const
