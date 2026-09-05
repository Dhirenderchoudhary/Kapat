"use client"

import { useLinkStatus } from "next/link"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

/**
 * Feedback for a navigation that has started but has not painted yet.
 *
 * A reviewer clicking Inspect thought the page had frozen: every console route is force-dynamic
 * against a separate API deployment, and until this branch none of them had a loading.tsx, so a
 * click produced no visible change at all for two to three seconds. The skeletons fix the
 * destination; this fixes the moment before it, which is the part that reads as a broken click.
 *
 * useLinkStatus only reports for the Link it is rendered inside, which is exactly the semantics
 * wanted here: the bar is on screen while the clicked link is pending and comes off when its
 * segment commits. Only one link can be pending at a time, so portalling to the body gives a
 * single app-wide bar without any global navigation state to keep in sync.
 */
export function RouteProgress() {
  const { pending } = useLinkStatus()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!pending || !mounted) return null

  return createPortal(
    <div className="route-progress" role="progressbar" aria-label="Loading page" aria-busy />,
    document.body,
  )
}

/**
 * The same pending state, shown on the control itself. The top bar says "something is loading";
 * this says "the thing you clicked is loading", which is what stops a second, impatient click.
 * Renders `pending` in place of `idle` so the control never changes width mid-navigation.
 */
export function LinkPending({
  idle,
  pending,
}: {
  idle: React.ReactNode
  pending: React.ReactNode
}) {
  const { pending: isPending } = useLinkStatus()
  return <>{isPending ? pending : idle}</>
}
