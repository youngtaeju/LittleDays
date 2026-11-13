import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import { formatMonth } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'

const monthNameFormats = new Map<string, Intl.DateTimeFormat>()
const yearFormats = new Map<string, Intl.DateTimeFormat>()

function format(
  cache: Map<string, Intl.DateTimeFormat>,
  lng: string,
  options: Intl.DateTimeFormatOptions,
  month: string,
): string {
  let f = cache.get(lng)
  if (!f) {
    f = new Intl.DateTimeFormat(lng, { ...options, timeZone: 'UTC' })
    cache.set(lng, f)
  }
  return f.format(new Date(`${month}-01T00:00:00Z`))
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, '0'),
)

// 연, 월 고르기. 기록 있는 가장 오래된 해 ~ 올해(기록 없거나 조회 실패면 올해만), 최근 해부터.
// 이번 달 이후 비활성.
export function MonthPickerSheet({
  month,
  thisMonth,
  onPick,
  onClose,
}: {
  month: string
  thisMonth: string
  onPick: (month: string) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  // ['assets'] 접두: 업로드, 휴지통, 촬영일 변경 무효화 공유.
  const months = useQuery({
    queryKey: ['assets', 'months'],
    queryFn: () => call(api.GET('/api/assets/months')),
    staleTime: 60_000,
  })
  const thisYear = Number(thisMonth.slice(0, 4))
  const oldest = Math.min(
    thisYear,
    ...(months.data ?? []).map((m) => Number(m.month.slice(0, 4))),
  )
  const years = Array.from(
    { length: thisYear - oldest + 1 },
    (_, i) => thisYear - i,
  )

  return (
    <AdaptiveSheet title={t('calendar.pickMonth')} onClose={onClose}>
      {months.isPending ? (
        <p className="py-2 text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : (
        <div className="grid gap-4 pt-2">
          {years.map((year) => (
            <section key={year} className="grid gap-1">
              <h3 className="text-sm font-semibold text-muted-foreground tabular-nums">
                {format(
                  yearFormats,
                  lng,
                  { year: 'numeric' },
                  `${String(year)}-01`,
                )}
              </h3>
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                {MONTHS.map((mm) => {
                  const value = `${String(year)}-${mm}`
                  const current = value === month
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-label={formatMonth(value, lng)}
                      aria-pressed={current}
                      disabled={value > thisMonth}
                      onClick={() => {
                        onPick(value)
                      }}
                      className={cn(
                        'h-11 rounded-full text-sm tabular-nums disabled:text-muted-foreground',
                        current
                          ? 'bg-primary font-semibold text-primary-foreground'
                          : 'hover:bg-muted',
                      )}
                    >
                      {format(monthNameFormats, lng, { month: 'short' }, value)}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </AdaptiveSheet>
  )
}
