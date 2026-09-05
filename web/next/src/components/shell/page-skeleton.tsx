import { PageShell } from "@/components/shell/page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * The pieces every route's loading.tsx is built from.
 *
 * Why these exist at all: every console page is force-dynamic and reads a separate API
 * deployment, so a navigation is a server round trip that took long enough for a reviewer to
 * think the app had frozen. A route with no loading.tsx renders nothing at all until that round
 * trip finishes, and <Link prefetch> has nothing to fetch ahead of time either. A loading file
 * fixes both: the click paints instantly, and the skeleton is what the router prefetches.
 *
 * These are deliberately shaped like the real page rather than generic grey bars. A skeleton whose
 * blocks land where the content lands reads as the page arriving; one that does not reads as a
 * second, different screen flashing past.
 */

export function SkeletonHeader({ actions = true }: { actions?: boolean }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {actions && <Skeleton className="h-9 w-32" />}
    </div>
  )
}

export function SkeletonStatCards({ count = 3 }: { count?: number }) {
  return (
    <div className={cn("grid gap-4", count === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="border-border/80 bg-card/60 rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
          <Skeleton className="mt-3 h-8 w-20" />
          <Skeleton className="mt-2 h-3 w-36" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 6, columns = 7 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="bg-muted/40 flex gap-4 border-b px-4 py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-border divide-y">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-4">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-xl border p-5", className)}>
      <Skeleton className="h-4 w-40" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  )
}

export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4 rounded-xl border p-6", className)}>
      <Skeleton className="h-4 w-36" />
      <div className="flex h-40 items-end gap-3">
        {[70, 45, 88, 32, 60, 78, 40].map((h, i) => (
          <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

/** A whole-page fallback for the console routes: header, then whatever the page's body is. */
export function PageSkeleton({
  size = "lg",
  actions = true,
  children,
}: {
  size?: "sm" | "md" | "lg" | "full"
  actions?: boolean
  children: React.ReactNode
}) {
  return (
    <PageShell size={size} className="space-y-8" aria-busy aria-label="Loading">
      <SkeletonHeader actions={actions} />
      {children}
    </PageShell>
  )
}
