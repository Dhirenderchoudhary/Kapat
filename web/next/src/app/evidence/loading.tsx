import { PageSkeleton, SkeletonCard, SkeletonChart } from "@/components/shell/page-skeleton"

export default function Loading() {
  return (
    <PageSkeleton actions={false}>
      <SkeletonChart />
      <SkeletonCard lines={5} />
      <SkeletonChart />
    </PageSkeleton>
  )
}
