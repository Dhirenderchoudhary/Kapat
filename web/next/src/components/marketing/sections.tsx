import { RiCheckLine, RiCloseLine, RiSubtractLine } from "@remixicon/react"

import { cn } from "@/lib/utils"

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className,
}: {
  id?: string
  eyebrow?: string
  title: string
  lead?: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn("border-t py-16 sm:py-24", className)}>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {eyebrow && (
          <div className="text-primary bg-primary/5 mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-semibold tracking-wider uppercase">
            {eyebrow}
          </div>
        )}
        <h2 className="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        {lead && (
          <p className="text-muted-foreground mt-4 max-w-3xl text-base leading-relaxed sm:text-lg">
            {lead}
          </p>
        )}
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  )
}

type Cell = boolean | "partial"

function CellIcon({ value }: { value: Cell }) {
  if (value === true)
    return (
      <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
        <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500/10">
          <RiCheckLine className="size-4" aria-hidden />
        </div>
        <span className="sr-only">Yes</span>
      </span>
    )
  if (value === "partial")
    return (
      <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
        <div className="flex size-6 items-center justify-center rounded-full bg-amber-500/10">
          <RiSubtractLine className="size-4" aria-hidden />
        </div>
        <span className="sr-only">Partial</span>
      </span>
    )
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1">
      <div className="bg-muted flex size-6 items-center justify-center rounded-full">
        <RiCloseLine className="size-4 opacity-50" aria-hidden />
      </div>
      <span className="sr-only">No</span>
    </span>
  )
}

export function CompareTable({
  columns,
  rows,
}: {
  columns: string[]
  rows: { label: string; note?: string; values: Cell[] }[]
}) {
  return (
    <div className="glass-panel relative overflow-x-auto rounded-xl border shadow-sm">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-muted/40 border-b">
            <th className="text-foreground p-4 text-left font-semibold">Capability</th>
            {columns.map((c, i) => (
              <th
                key={c}
                className={cn(
                  "p-4 text-left font-semibold",
                  i === columns.length - 1 && "text-primary font-bold",
                  i !== columns.length - 1 && "text-muted-foreground",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.label} className="hover:bg-muted/20 transition-colors">
              <td className="p-4 align-top">
                <div className="text-foreground font-semibold">{row.label}</div>
                {row.note && <div className="text-muted-foreground mt-1 text-xs">{row.note}</div>}
              </td>
              {row.values.map((v, i) => (
                <td key={i} className="p-4 align-top">
                  <CellIcon value={v} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
