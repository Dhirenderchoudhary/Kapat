import { BUILD_VERSION } from "@packages/env"
import { env } from "@packages/env/web-next"

// Server-only env vars
/**
 * The base URL server components use to reach the API.
 *
 * THE BUG THIS COMMENT EXISTS TO PREVENT
 * ======================================
 * This used to fall back to the DEPLOYED Vercel API whenever INTERNAL_API_URL was unset. On a
 * developer's machine that meant every server-rendered page silently read production data while
 * every client-side call read localhost, so the dashboard showed a believable mixture of the two:
 * the ring queue listed remote clusters, and clicking one 404'd because that id only existed
 * remotely. Nothing errored. It just quietly showed the wrong database, which is far worse than
 * failing, and it cost a lot of time to find.
 *
 * So the fallback order is now: INTERNAL_API_URL, then the same URL the browser uses, and only
 * then the deployed default. Locally that lands on localhost:4000 without anyone configuring
 * anything, and a deployment that genuinely needs a different internal hostname still sets
 * INTERNAL_API_URL explicitly.
 */
const getInternalApiUrl = () => {
  if (typeof window === "undefined") {
    return (
      env.INTERNAL_API_URL ||
      env.NEXT_PUBLIC_API_URL ||
      "https://razorpay-buildathon-api.vercel.app"
    )
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
