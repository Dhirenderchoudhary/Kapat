"use client"

import { RiGlobalLine } from "@remixicon/react"
import { createContext, useCallback, useContext, useEffect, useState } from "react"

import {
  LOCALES,
  LOCALE_LABEL,
  t as translate,
  type Locale,
  type MessageKey,
} from "@/lib/i18n/messages"

const STORAGE_KEY = "risk-manager-locale"

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: "en",
  setLocale: () => {},
})

/**
 * Locale is held per browser, not per account, because this build has no merchant login
 * (Design.md 4) and a language preference that survives a refresh is worth more than one tied to
 * an account that does not exist yet.
 *
 * Starts on "en" for the first render on both server and client, then reads storage in an effect.
 * Reading storage during render would produce different HTML on the two sides and trip a hydration
 * mismatch, which in this app would flash the wrong language on the screen where someone decides
 * about money.
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en")

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored && (LOCALES as readonly string[]).includes(stored)) {
        setLocaleState(stored as Locale)
        return
      }
      // No stored choice: take a hint from the browser, but only for languages actually translated
      // here. Guessing beyond that would show a half-English screen.
      const nav = navigator.language.slice(0, 2)
      if ((LOCALES as readonly string[]).includes(nav)) setLocaleState(nav as Locale)
    } catch {
      // Private browsing or blocked storage. English is a fine default; nothing else breaks.
    }
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // Preference just won't persist. Not worth surfacing an error over.
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  return useContext(LocaleContext)
}

/** Translation hook. `t("hold.release")` reads better at the call site than passing locale around. */
export function useT(): (key: MessageKey) => string {
  const { locale } = useLocale()
  return useCallback((key: MessageKey) => translate(locale, key), [locale])
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale()
  return (
    <div className="relative inline-flex items-center">
      <RiGlobalLine
        className="text-muted-foreground pointer-events-none absolute left-2 size-3.5"
        aria-hidden
      />
      <label className="inline-flex items-center">
        <span className="sr-only">Language</span>
        <select
          value={locale}
          aria-label="Select language"
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="bg-background text-foreground hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border pr-2.5 pl-7 text-xs font-medium transition-colors outline-none focus-visible:ring-2"
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABEL[l]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
