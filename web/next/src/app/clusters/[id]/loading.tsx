import { PageSkeleton, SkeletonCard } from "@/components/shell/page-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageSkeleton>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={6} />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div className="space-y-6 lg:col-span-5">
          <SkeletonCard lines={5} />
        </div>
      </div>
    </PageSkeleton>
  )
}
