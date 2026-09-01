import { BUILD_VERSION } from "@packages/env"
import { env } from "@packages/env/web-next"

// Server-only env vars
const getInternalApiUrl = () => {
  if (typeof window === "undefined") {
    return env.INTERNAL_API_URL || "https://razorpay-buildathon-api.vercel.app"
  }
  return undefined
}

const getClientApiUrl = () => {
  return env.NEXT_PUBLIC_API_URL || "https://razorpay-buildathon-api.vercel.app"
}

export const config = {
  // Runtime / env-derived app values (NOT brand, brand lives in @packages/config/site)
  app: {
    url: env.NEXT_PUBLIC_APP_URL || "https://razorpay-buildathon-next.vercel.app",
    version: BUILD_VERSION,
  },

  // API configuration
  api: {
    url: getClientApiUrl(),
    internalUrl: getInternalApiUrl(),
  },
} as const
