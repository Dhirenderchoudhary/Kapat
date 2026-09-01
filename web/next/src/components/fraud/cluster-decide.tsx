"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { apiClient, unwrap } from "@/lib/api/client"

// No merchant auth/login on these pages (Design.md §4) - every decision made here is attributed
// to this placeholder identity rather than inventing a fake login system. Wiring a real merchant
// identity is future work once auth exists on this dashboard, not something to fake now
// (Rules.md Principle 5).
const DECIDED_BY_PLACEHOLDER = "dashboard-merchant"

type DecisionAction = "freeze" | "block" | "escalate" | "dismiss"

const DISMISS_REASON_OPTIONS = [
  { value: "legitimate_shared_household", label: "Legitimate shared household" },
  { value: "coincidental_overlap", label: "Coincidental overlap" },
  { value: "other", label: "Other" },
] as const

type LatestDecision = {
  action: string
  reason: string | null
  decidedBy: string
  decidedAt: string
}

const ACTION_LABEL: Record<string, string> = {
  freeze: "Frozen",
  block: "Blocked",
  escalate: "Escalated",
  dismiss: "Dismissed",
}

// Design.md §1.2's Decide section: Freeze / Block / Escalate / Dismiss. Freeze/Block/Escalate
// confirm before firing (ConfirmDialog, matching every other "are you sure" in the app); Dismiss
// requires a reason picked from a short set of options, not a free-text box (Rules.md
// Principle 10 - the reason is data the false-positive-cost metric depends on, enforced at the
// schema level by merchant_decisions_dismiss_reason_check, not just this UI).
export function ClusterDecide({
  clusterId,
  status,
  latestDecision,
}: {
  clusterId: string
  status: string
  latestDecision: LatestDecision | null
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [confirmAction, setConfirmAction] = useState<"freeze" | "block" | "escalate" | null>(null)
  const [dismissOpen, setDismissOpen] = useState(false)
  const [dismissReasonOption, setDismissReasonOption] = useState<string>(
    DISMISS_REASON_OPTIONS[0].value,
  )
  const [dismissOtherText, setDismissOtherText] = useState("")

  const decide = useMutation({
    mutationFn: async ({ action, reason }: { action: DecisionAction; reason?: string }) => {
      const { data, error } = await unwrap(
        apiClient.clusters[":id"].decision.$post({
          param: { id: clusterId },
          json: { action, reason, decidedBy: DECIDED_BY_PLACEHOLDER },
        }),
      )
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: (_data, variables) => {
      toast.add({
        title: `Cluster ${ACTION_LABEL[variables.action].toLowerCase()}`,
        type: "success",
      })
      setConfirmAction(null)
      setDismissOpen(false)
      queryClient.invalidateQueries({ queryKey: ["clusters"] })
      router.refresh()
    },
    onError: (error) => {
      toast.add({ title: error.message, type: "error" })
    },
  })

  const isDecided = status === "resolved"

  if (isDecided && latestDecision) {
    return (
      <div className="rounded-md border p-3 text-sm">
        <div className="font-medium">
          {ACTION_LABEL[latestDecision.action] ?? latestDecision.action}
        </div>
        <div className="text-muted-foreground mt-1">
          by {latestDecision.decidedBy} ·{" "}
          {new Date(latestDecision.decidedAt).toLocaleString("en-IN")}
        </div>
        {latestDecision.reason && <p className="mt-2">{latestDecision.reason}</p>}
      </div>
    )
  }

  const dismissReason =
    dismissReasonOption === "other"
      ? dismissOtherText.trim()
      : (DISMISS_REASON_OPTIONS.find((o) => o.value === dismissReasonOption)?.label ?? "")

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <Button
          variant="destructive"
          onClick={() => setConfirmAction("freeze")}
          disabled={decide.isPending}
        >
          Freeze
        </Button>
        <Button
          variant="destructive"
          onClick={() => setConfirmAction("block")}
          disabled={decide.isPending}
        >
          Block
        </Button>
        <Button
          variant="outline"
          onClick={() => setConfirmAction("escalate")}
          disabled={decide.isPending}
        >
          Escalate
        </Button>
        <Button
          variant="secondary"
          onClick={() => setDismissOpen(true)}
          disabled={decide.isPending}
        >
          Dismiss
        </Button>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        pending={decide.isPending}
        title={
          confirmAction
            ? `${confirmAction[0]!.toUpperCase()}${confirmAction.slice(1)} this cluster?`
            : ""
        }
        description="This acts on every account in the cluster and is logged to the audit trail."
        action={
          confirmAction ? confirmAction[0]!.toUpperCase() + confirmAction.slice(1) : "Confirm"
        }
        variant="destructive"
        onConfirm={() => {
          if (confirmAction) decide.mutate({ action: confirmAction })
        }}
      />

      <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss this cluster</DialogTitle>
            <DialogDescription>
              A reason is required (Rules.md Principle 10) - it feeds the false-positive-cost
              metric, so pick the one that actually matches what you found.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={dismissReasonOption}
            onValueChange={(v) => setDismissReasonOption(String(v))}
          >
            {DISMISS_REASON_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <RadioGroupItem value={option.value} id={`dismiss-reason-${option.value}`} />
                <Label htmlFor={`dismiss-reason-${option.value}`}>{option.label}</Label>
              </div>
            ))}
          </RadioGroup>

          {dismissReasonOption === "other" && (
            <Textarea
              placeholder="Describe why this cluster is being dismissed"
              value={dismissOtherText}
              onChange={(e) => setDismissOtherText(e.target.value)}
            />
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDismissOpen(false)}
              disabled={decide.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              disabled={decide.isPending || dismissReason.length === 0}
              onClick={() => decide.mutate({ action: "dismiss", reason: dismissReason })}
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
