import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => {
        mq.removeEventListener('change', onChange)
      }
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

// 데스크톱(사이드바) 기준. Tailwind lg 와 같은 값.
export const WIDE = '(min-width: 1024px)'
