'use client'

import { useCallback, useSyncExternalStore } from 'react'

const EVENT = 'pcr:preference'

/**
 * A viewer preference backed by localStorage.
 *
 * Uses `useSyncExternalStore` rather than the read-in-an-effect pattern:
 * localStorage genuinely is an external store, the server snapshot is the
 * default, and the client snapshot is whatever is stored — so there is no
 * hydration mismatch and no cascading render on mount.
 *
 * Every read and write is wrapped, because storage throws outright in some
 * private-browsing modes and returns null when site data is cleared. A
 * preference that cannot be stored degrades to the default rather than
 * breaking the page.
 */
export function usePreference<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    // `storage` covers other tabs; the custom event covers this one, which
    // does not receive its own storage events.
    window.addEventListener('storage', onChange)
    window.addEventListener(EVENT, onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener(EVENT, onChange)
    }
  }, [])

  const getSnapshot = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return (allowed as readonly string[]).includes(stored ?? '') ? (stored as T) : fallback
    } catch {
      return fallback
    }
  }, [key, allowed, fallback])

  const getServerSnapshot = useCallback(() => fallback, [fallback])

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const set = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next)
      } catch {
        // Nothing to do — the change still applies for this page view.
      }
      window.dispatchEvent(new Event(EVENT))
    },
    [key],
  )

  return [value, set]
}
