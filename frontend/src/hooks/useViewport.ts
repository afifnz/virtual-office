import { useEffect, useState } from 'react'

function useMedia(query: string, fallback = false): boolean {
  const [match, setMatch] = useState<boolean>(() =>
    typeof window === 'undefined' ? fallback : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** <= 760 px: phone layout (bottom sheet feed, full-screen taskboard). */
export function useIsMobile(): boolean {
  return useMedia('(max-width: 760px)')
}

/** <= 430 px: small phone (tightest HUD, single column everything). */
export function useIsNarrow(): boolean {
  return useMedia('(max-width: 430px)')
}

/** Touch-only devices get the on-screen pad and no hover cards. */
export function useIsTouch(): boolean {
  return useMedia('(hover: none) and (pointer: coarse)')
}
