import { HeldPayments } from "@/components/fraud/held-payments"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"

export const dynamic = "force-dynamic"

export default function HoldsPage() {
  return (
    <PageShell size="lg" className="space-y-8">
      <PageHeader
        title="Held payments"
        description="Waiting on your decision. Authorisations expire after 3 days, per Razorpay policy."
      />
      <HeldPayments />
    </PageShell>
  )
}
