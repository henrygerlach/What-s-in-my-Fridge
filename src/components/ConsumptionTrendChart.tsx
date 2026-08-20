import { useState } from 'react'
import type { PeriodTotals } from '../lib/foodStats'

const CONSUMED_COLOR = '#2c7a4d'
const DISCARDED_COLOR = '#ad3629'

const WIDTH = 320
const HEIGHT = 140
const PADDING_LEFT = 18
const PADDING_BOTTOM = 16
const BAR_GAP = 2
const MAX_BAR_WIDTH = 24

// Rounds a chart's max value up to a clean gridline value (1 / 2 / 5 × 10^n)
// instead of an arbitrary count, per the usual axis-tick convention.
function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const steps = [1, 2, 5, 10]
  const step = steps.find((s) => value <= s * magnitude) ?? 10
  return step * magnitude
}

export default function ConsumptionTrendChart({ data }: { data: PeriodTotals[] }) {
  const [selected, setSelected] = useState<number | null>(null)

  const chartHeight = HEIGHT - PADDING_BOTTOM
  const max = niceMax(Math.max(...data.map((d) => d.consumed + d.discarded)))
  const plotWidth = WIDTH - PADDING_LEFT
  const slotWidth = plotWidth / data.length
  const barWidth = Math.min(MAX_BAR_WIDTH, slotWidth * 0.6)

  const scale = (count: number) => (count / max) * chartHeight
  const active = selected != null ? data[selected] : null

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CONSUMED_COLOR }} />
          Aufgebraucht
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DISCARDED_COLOR }} />
          Weggeworfen
        </span>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-2 w-full" role="img" aria-label="Verlauf aufgebraucht vs. weggeworfen">
        <line
          x1={PADDING_LEFT}
          y1={chartHeight}
          x2={WIDTH}
          y2={chartHeight}
          stroke="var(--color-rule)"
          strokeWidth={1}
        />
        <text x={0} y={8} className="fill-ink-faint" fontSize={8}>
          {max}
        </text>

        {data.map((bucket, i) => {
          const x = PADDING_LEFT + i * slotWidth + (slotWidth - barWidth) / 2
          const consumedHeight = scale(bucket.consumed)
          const discardedHeight = scale(bucket.discarded)
          const hasGap = bucket.consumed > 0 && bucket.discarded > 0
          const total = bucket.consumed + bucket.discarded

          return (
            <g
              key={bucket.label}
              onClick={() => setSelected(i === selected ? null : i)}
              className="cursor-pointer"
            >
              <rect
                x={x - 4}
                y={0}
                width={barWidth + 8}
                height={chartHeight}
                fill="transparent"
              />
              {bucket.consumed > 0 && (
                <rect
                  x={x}
                  y={chartHeight - consumedHeight}
                  width={barWidth}
                  height={Math.max(consumedHeight, 1)}
                  rx={2}
                  fill={CONSUMED_COLOR}
                  opacity={selected == null || selected === i ? 1 : 0.35}
                />
              )}
              {bucket.discarded > 0 && (
                <rect
                  x={x}
                  y={chartHeight - consumedHeight - discardedHeight - (hasGap ? BAR_GAP : 0)}
                  width={barWidth}
                  height={Math.max(discardedHeight, 1)}
                  rx={2}
                  fill={DISCARDED_COLOR}
                  opacity={selected == null || selected === i ? 1 : 0.35}
                />
              )}
              {total > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={chartHeight - consumedHeight - discardedHeight - (hasGap ? BAR_GAP : 0) - 3}
                  textAnchor="middle"
                  fontSize={8}
                  className="fill-ink-muted"
                >
                  {total}
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={HEIGHT - 3}
                textAnchor="middle"
                fontSize={8}
                className={selected === i ? 'fill-ink font-medium' : 'fill-ink-faint'}
              >
                {bucket.label}
              </text>
            </g>
          )
        })}
      </svg>

      <p className="mt-2 text-xs text-ink-muted">
        {active
          ? `Ab ${active.label}: ${active.consumed} aufgebraucht, ${active.discarded} weggeworfen`
          : 'Zeitraum antippen für Details'}
      </p>
    </div>
  )
}
