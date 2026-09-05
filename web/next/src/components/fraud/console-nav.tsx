"use client"

import {
  RiAlarmWarningLine,
  RiBarChartBoxLine,
  RiCloseLine,
  RiDashboardLine,
  RiMenuLine,
  RiPauseCircleLine,
  RiPieChartLine,
  RiShieldCheckLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { ModeToggle } from "@/components/common/mode-toggle"
import { RouteProgress } from "@/components/common/route-progress"
import { LanguageSwitcher, useT } from "@/components/fraud/locale"
import { Button } from "@/components/ui/button"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"

interface NavItem {
  href: string
  msgKey: MessageKey
  icon: RemixiconComponentType
  exact?: boolean
}

/**
 * Ordered as the work is done, not alphabetically: you look at the overview, work the queue, act
 * on what is held, and only then go to the pages that explain how the detector reaches its
 * verdicts. Overview used to be the one item without an icon; it has one now, because a row where
 * five items carry a glyph and one does not reads as a mistake.
 */
const NAV: NavItem[] = [
  { href: "/", msgKey: "nav.overview", icon: RiDashboardLine, exact: true },
  { href: "/clusters", msgKey: "nav.queue", icon: RiAlarmWarningLine },
  { href: "/holds", msgKey: "nav.holds", icon: RiPauseCircleLine },
  { href: "/analysis", msgKey: "nav.analysis", icon: RiPieChartLine },
  { href: "/evidence", msgKey: "nav.evidence", icon: RiShieldCheckLine },
  { href: "/metrics", msgKey: "nav.accuracy", icon: RiBarChartBoxLine },
]

export function ConsoleNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const t = useT()

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`)

  return (
    <header className="border-border bg-background/85 sticky top-0 z-50 w-full border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
        {/* The mark is a mark, not a status light. It used to carry a pinging dot and a green
            glow, both of which claimed liveness that nothing was measuring, and the glow was a
            hardcoded emerald rgba that survived the accent change and clashed with everything
            around it. The "AI Fraud Shield" line under the wordmark went the same way: it was
            hardcoded English, so Hindi and Marathi readers got it untranslated, and it was
            marketing copy in the chrome of a working console. */}
        <Link
          href="/"
          className="text-foreground focus-visible:ring-ring flex shrink-0 items-center gap-2.5 rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <span className="border-border bg-card text-primary flex size-7 items-center justify-center rounded-md border">
            <RiShieldCheckLine className="size-4" aria-hidden />
          </span>
          <span className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            {t("nav.brand")}
          </span>
        </Link>

        {/* One signal for "you are here", not four. The active item used to carry a background, a
            border, a shadow, a weight change AND a separate underline bar; the underline alone is
            unambiguous and leaves the row quiet. Labels carry the meaning, so the icons are left
            to the mobile menu where they help scanning. */}
        <nav className="hidden min-w-0 flex-1 items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item) ? "page" : undefined}
              className={cn(
                "relative rounded-sm px-2.5 py-4 text-sm whitespace-nowrap transition-colors",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                isActive(item)
                  ? "text-foreground after:bg-primary after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:content-['']"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(item.msgKey)}
              <RouteProgress />
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {/* What used to sit here was a "Telemetry Active" pill with a pulsing dot, hardcoded to
              say Active whether or not anything was connected, ingesting or reachable. This
              project's own rule is that it never states what it has not measured, and an
              always-on liveness badge is exactly that. Wiring it to real connection state would
              be worth doing; asserting it is not. */}
          <Button
            render={<Link href="/connect" />}
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground mr-1 hidden h-8 px-3 text-sm font-medium sm:inline-flex"
          >
            {t("nav.connect")}
            <RouteProgress />
          </Button>
          <LanguageSwitcher />
          <ModeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="console-nav-mobile"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <RiCloseLine className="size-5" aria-hidden />
            ) : (
              <RiMenuLine className="size-5" aria-hidden />
            )}
          </Button>
        </div>
      </div>

      {open && (
        <div id="console-nav-mobile" className="bg-background border-border border-b md:hidden">
          <nav className="mx-auto max-w-6xl px-4 py-2 sm:px-6" aria-label="Mobile">
            <ul className="divide-border divide-y">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(item) ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 py-3 text-sm transition-colors",
                      isActive(item)
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <item.icon
                      className={cn("size-4", isActive(item) ? "text-primary" : "opacity-60")}
                      aria-hidden
                    />
                    <span>{t(item.msgKey)}</span>
                    <RouteProgress />
                  </Link>
                </li>
              ))}
            </ul>
            <Button
              render={<Link href="/connect" />}
              onClick={() => setOpen(false)}
              className="mt-3 mb-2 w-full justify-center"
              size="sm"
            >
              {t("nav.connect")}
              <RouteProgress />
            </Button>
          </nav>
        </div>
      )}
    </header>
  )
}
