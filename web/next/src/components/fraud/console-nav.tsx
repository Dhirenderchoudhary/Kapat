"use client"

import {
  RiAlarmWarningLine,
  RiBarChartBoxLine,
  RiCloseLine,
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
import { LanguageSwitcher, useT } from "@/components/fraud/locale"
import { Button } from "@/components/ui/button"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"

interface NavItem {
  href: string
  msgKey: MessageKey
  icon?: RemixiconComponentType
  exact?: boolean
}

const NAV: NavItem[] = [
  { href: "/", msgKey: "nav.overview", exact: true },
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
    <header className="border-border/60 bg-background/70 sticky top-0 z-50 w-full border-b backdrop-blur-xl transition-all duration-300">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="group text-foreground flex shrink-0 items-center gap-2 font-bold tracking-tight"
          >
            <div className="relative flex size-8 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 shadow-[0_0_15px_-3px_rgba(16,185,129,0.3)] transition-transform group-hover:scale-105">
              <RiShieldCheckLine className="size-5" aria-hidden />
              <span className="absolute -top-0.5 -right-0.5 flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight sm:text-base">
                {t("nav.brand")}
              </span>
              <span className="-mt-1 hidden text-[10px] font-medium text-emerald-500 sm:inline dark:text-emerald-400">
                AI Fraud Shield
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item) ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 lg:text-sm",
                  isActive(item)
                    ? "bg-accent/80 text-foreground font-semibold shadow-xs border border-border/80"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {item.icon && <item.icon className="size-3.5 opacity-70" aria-hidden />}
                {t(item.msgKey)}
                {isActive(item) && (
                  <span className="bg-primary/70 absolute right-3 bottom-0 left-3 h-[2px] rounded-full" />
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-medium text-emerald-600 lg:flex dark:text-emerald-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span>Telemetry Active</span>
          </div>
          <Button
            render={<Link href="/connect" />}
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground hidden h-8 px-3 text-xs font-semibold shadow-sm transition-all hover:scale-[1.02] sm:inline-flex"
          >
            {t("nav.connect")}
          </Button>
          <LanguageSwitcher />
          <ModeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Toggle navigation"
            aria-expanded={open}
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
        <div className="bg-background/95 border-border/80 animate-in slide-in-from-top-2 border-b px-4 py-3 backdrop-blur-2xl duration-200 md:hidden">
          <nav className="flex flex-col gap-1.5" aria-label="Mobile">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive(item)
                    ? "bg-accent font-medium text-foreground border border-border/60"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {item.icon && <item.icon className="size-4" aria-hidden />}
                <span>{t(item.msgKey)}</span>
              </Link>
            ))}
            <div className="mt-2 border-t pt-2">
              <Button
                render={<Link href="/connect" />}
                onClick={() => setOpen(false)}
                className="w-full justify-center shadow-xs"
                size="sm"
              >
                {t("nav.connect")}
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
