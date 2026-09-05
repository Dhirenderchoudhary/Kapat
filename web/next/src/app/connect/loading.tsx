import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <main aria-busy aria-label="Loading">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="mt-4 h-5 w-full max-w-xl" />
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-xl border p-5">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-6 h-80 w-full rounded-xl" />
      </div>
    </main>
  )
}
