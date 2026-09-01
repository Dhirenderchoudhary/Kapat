import Link from "next/link"

// The synthetic-data disclosure lives in the footer of every page, not just the landing page.
// A merchant should never be more than one glance away from knowing what the numbers on screen
// are actually measured on.
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-10 text-sm sm:px-6">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/" className="hover:text-foreground">
            Overview
          </Link>
          <Link href="/clusters" className="hover:text-foreground">
            Ring queue
          </Link>
          <Link href="/metrics" className="hover:text-foreground">
            Accuracy
          </Link>
          <Link href="/connect" className="hover:text-foreground">
            Connect
          </Link>
        </div>
        <p className="mt-6 max-w-3xl text-xs leading-relaxed">
          Every account, address, phone number and transaction in this deployment is synthetic and
          generated from a fixed seed. Reported accuracy is measured on a held-out split of that
          synthetic data, which validates the implementation but not yet its performance on live
          merchant traffic. Defence-only: this system detects coordinated abuse against a merchant
          and hands it to a person to decide on. It never freezes, blocks, or moves money by itself.
        </p>
      </div>
    </footer>
  )
}
