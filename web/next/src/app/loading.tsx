import { Skeleton } from "@/components/ui/skeleton"

/**
 * The landing page reads the metrics and evidence endpoints before it can render a single number,
 * so without this the first paint waits on two cross-service fetches. This is the hero's shape:
 * headline, sub, two buttons, a row of measured figures.
 */
export default function Loading() {
  return (
    <main aria-busy aria-label="Loading">
      <section className="border-b py-20 sm:py-28">
        <div className="mx-auto w-full max-w-6xl space-y-6 px-4 sm:px-6">
          <Skeleton className="h-6 w-40 rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-12 w-full max-w-3xl" />
            <Skeleton className="h-12 w-full max-w-xl" />
          </div>
          <Skeleton className="h-5 w-full max-w-2xl" />
          <div className="flex gap-3">
            <Skeleton className="h-11 w-44" />
            <Skeleton className="h-11 w-36" />
          </div>
          <div className="grid max-w-3xl gap-4 pt-6 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-xl border p-5">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-16 sm:px-6">
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </section>
    </main>
  )
}
