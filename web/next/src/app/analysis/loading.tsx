import { PageSkeleton, SkeletonCard, SkeletonChart } from "@/components/shell/page-skeleton"

export default function Loading() {
  return (
    <PageSkeleton actions={false}>
      <SkeletonChart />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
    </PageSkeleton>
  )
}
