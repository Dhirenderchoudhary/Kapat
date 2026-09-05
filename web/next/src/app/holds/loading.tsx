import { PageSkeleton, SkeletonStatCards, SkeletonTable } from "@/components/shell/page-skeleton"

export default function Loading() {
  return (
    <PageSkeleton actions={false}>
      <SkeletonStatCards count={2} />
      <SkeletonTable rows={5} columns={5} />
    </PageSkeleton>
  )
}
