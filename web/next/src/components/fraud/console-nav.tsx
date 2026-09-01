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
    <header className="bg-background/85 sticky top-0 z-50 w-full border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-foreground flex shrink-0 items-center gap-2 font-bold tracking-tight"
          >
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <RiShieldCheckLine className="size-4.5" aria-hidden />
            </div>
            <span className="text-sm font-bold sm:text-base">{t("nav.brand")}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors lg:text-sm",
                  isActive(item)
                    ? "bg-muted text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {t(item.msgKey)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <span className="border-border/80 bg-muted/30 text-muted-foreground hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium xl:inline">
            {t("nav.syntheticData")}
          </span>
          <Button
            render={<Link href="/connect" />}
            size="sm"
            className="hidden h-8 px-3 text-xs font-semibold shadow-sm sm:inline-flex"
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
        <div className="bg-background border-b px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive(item)
                    ? "bg-muted font-medium text-foreground"
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
                className="w-full justify-center"
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
