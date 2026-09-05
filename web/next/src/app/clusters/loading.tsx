import { PageSkeleton, SkeletonStatCards, SkeletonTable } from "@/components/shell/page-skeleton"

export default function Loading() {
  return (
    <PageSkeleton>
      <SkeletonStatCards />
      <SkeletonTable rows={6} columns={7} />
    </PageSkeleton>
  )
}
