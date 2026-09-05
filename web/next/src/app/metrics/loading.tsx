import { PageSkeleton, SkeletonChart, SkeletonStatCards } from "@/components/shell/page-skeleton"

export default function Loading() {
  return (
    <PageSkeleton actions={false}>
      <SkeletonStatCards />
      <SkeletonChart />
      <SkeletonChart />
    </PageSkeleton>
  )
}
