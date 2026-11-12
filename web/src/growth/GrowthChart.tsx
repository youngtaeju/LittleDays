import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby, GrowthRecord } from '@/api/types'
import { dayNumber } from '@/lib/age'
import { cn } from '@/lib/utils'
import {
  CURVE_LAST_MONTH,
  DAYS_PER_MONTH,
  curves,
  type CurvePoint,
  type GrowthKind,
} from './lms'
import { formatMeasure } from './useGrowth'

// 그림 좌표계. 가로 100% 로 늘어남, 글자는 SVG 밖 HTML.
const W = 320
const H = 160
// 점이 위아래 끝에 잘리지 않을 여백.
const INSET = 8

interface Point {
  id: string
  x: number
  v: number
}

// WHO 곡선과 같은 환산(생후 일수 / 30.4375). 개월 기념일 규칙(lib/age)과 달리 소수 개월.
function ageMonths(birthDate: string, date: string): number {
  return (dayNumber(birthDate, date) - 1) / DAYS_PER_MONTH
}

function valueOf(r: GrowthRecord, kind: GrowthKind): number | null {
  return kind === 'height' ? r.height_cm : r.weight_kg
}

// 기록 범위를 덮는 눈금 간격의 배수 구간. 최소 한 칸.
function xDomain(min: number, max: number) {
  const span = max - min
  const step = span <= 12 ? 3 : span <= 30 ? 6 : 12
  const x0 = Math.floor(min / step) * step
  let x1 = Math.ceil(max / step) * step
  if (x1 - x0 < step) x1 = x0 + step
  return { x0, x1, step }
}

function pathOf(xy: readonly (readonly [number, number])[]): string {
  return xy
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join('')
}

// 기록 점과 선. 성별이 있으면 0~60개월 구간에 WHO 3/15/50/85/97 백분위 곡선 배경.
export function GrowthChart({
  records,
  baby,
  kind,
}: {
  records: readonly GrowthRecord[]
  baby: Baby
  kind: GrowthKind
}) {
  const { t, i18n } = useTranslation()
  const descId = useId()
  const points: Point[] = records
    .flatMap((r) => {
      const v = valueOf(r, kind)
      if (v === null) return []
      const x = ageMonths(baby.birth_date, r.measured_on)
      return x < 0 ? [] : [{ id: r.id, x, v }]
    })
    .sort((a, b) => a.x - b.x)
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) {
    return (
      <p className="text-sm text-muted-foreground">
        {kind === 'height' ? t('growth.emptyHeight') : t('growth.emptyWeight')}
      </p>
    )
  }

  const { x0, x1, step } = xDomain(first.x, last.x)
  const curveEnd = Math.min(x1, CURVE_LAST_MONTH)
  const band: CurvePoint[] =
    baby.sex && x0 < CURVE_LAST_MONTH
      ? curves(baby.sex, kind).filter(
          (c) => c.month >= x0 && c.month <= curveEnd,
        )
      : []

  const values = [
    ...points.map((p) => p.v),
    ...band.flatMap((c) => [c.p3, c.p97]),
  ]
  const vMin = Math.min(...values)
  const vMax = Math.max(...values)
  const pad = (vMax - vMin) * 0.06 || 1
  const y0 = vMin - pad
  const y1 = vMax + pad

  const sx = (x: number) => ((x - x0) / (x1 - x0)) * W
  const sy = (v: number) => INSET + (1 - (v - y0) / (y1 - y0)) * (H - 2 * INSET)
  const line = (pick: (c: CurvePoint) => number) =>
    band.map((c) => [sx(c.month), sy(pick(c))] as const)
  const area = (lo: (c: CurvePoint) => number, hi: (c: CurvePoint) => number) =>
    `${pathOf([...line(hi), ...line(lo).reverse()])}Z`

  const ticks: number[] = []
  for (let m = x0; m <= x1; m += step) ticks.push(m)
  const digits = kind === 'height' ? 0 : 1
  const fmt = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: digits,
  })
  const unitKey =
    kind === 'height' ? 'growth.heightValue' : 'growth.weightValue'
  const yLabels = vMax === vMin ? [vMax] : [vMax, vMin]
  const recorded = points.map((p) => p.v)
  // 스크린리더용 요약. 기록 수, 개월 범위(만 개월), 값 범위.
  const summary = t('growth.chartSummary', {
    count: points.length,
    from: Math.floor(first.x),
    to: Math.floor(last.x),
    min: formatMeasure(t, i18n.language, kind, Math.min(...recorded)),
    max: formatMeasure(t, i18n.language, kind, Math.max(...recorded)),
  })

  return (
    <figure className="grid gap-1">
      <div className="relative pl-12">
        <p id={descId} className="sr-only">
          {summary}
        </p>
        <svg
          role="img"
          aria-label={
            kind === 'height'
              ? t('growth.heightChart')
              : t('growth.weightChart')
          }
          aria-describedby={descId}
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          className="block h-auto w-full overflow-visible"
        >
          {band.length > 1 && (
            <g data-testid="growth-curves" data-end-x={sx(curveEnd)}>
              <path
                d={area(
                  (c) => c.p3,
                  (c) => c.p97,
                )}
                className="fill-muted-foreground/10"
              />
              <path
                d={area(
                  (c) => c.p15,
                  (c) => c.p85,
                )}
                className="fill-muted-foreground/15"
              />
              <path
                d={pathOf(line((c) => c.p50))}
                fill="none"
                strokeWidth={1.2}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                className="stroke-muted-foreground"
              />
            </g>
          )}
          <g data-testid="growth-points">
            {points.length > 1 && (
              <path
                d={pathOf(points.map((p) => [sx(p.x), sy(p.v)] as const))}
                fill="none"
                strokeWidth={2.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-accent-ink"
              />
            )}
            {points.map((p) => (
              <circle
                key={p.id}
                cx={sx(p.x)}
                cy={sy(p.v)}
                r={4}
                strokeWidth={1.5}
                className="fill-accent-ink stroke-background"
              />
            ))}
          </g>
        </svg>
        {/* 세로축 값. 그림 밖 HTML 이라 화면 폭과 무관하게 같은 글자 크기. */}
        {yLabels.map((v) => (
          <span
            key={v}
            aria-hidden
            className="absolute left-0 w-11 -translate-y-1/2 text-right text-2xs text-muted-foreground tabular-nums"
            style={{ top: `${String((sy(v) / H) * 100)}%` }}
          >
            {t(unitKey, { value: fmt.format(v) })}
          </span>
        ))}
      </div>
      <div aria-hidden className="relative ml-12 h-5">
        {ticks.map((m, i) => (
          <span
            key={m}
            className={cn(
              'absolute top-0 text-2xs text-muted-foreground tabular-nums',
              i === ticks.length - 1
                ? '-translate-x-full'
                : i > 0 && '-translate-x-1/2',
            )}
            style={{ left: `${String(((m - x0) / (x1 - x0)) * 100)}%` }}
          >
            {i === 0 || i === ticks.length - 1
              ? t('growth.month', { count: m })
              : m}
          </span>
        ))}
      </div>
      {!baby.sex && (
        <figcaption className="text-xs text-muted-foreground">
          {t('growth.noSexHint')}
        </figcaption>
      )}
    </figure>
  )
}
