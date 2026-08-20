/*
 * The app's signature element. Every screen answers the same question —
 * "how close am I to being able to cook this?" — and this is the one place
 * that answer is drawn rather than written.
 *
 * One segment per ingredient, filled when it's in stock. The count of filled
 * segments carries the information, so the reading survives without colour
 * (and the mono ratio beside it survives without either).
 */
interface AvailabilityMeterProps {
  available: number
  total: number
  className?: string
}

export function availabilityTone(available: number, total: number): 'full' | 'partial' | 'none' {
  if (total === 0 || available === total) return 'full'
  return available > 0 ? 'partial' : 'none'
}

const FILL_CLASS = { full: 'bg-full', partial: 'bg-partial', none: 'bg-none' } as const
const TEXT_CLASS = { full: 'text-full', partial: 'text-partial', none: 'text-none' } as const

export default function AvailabilityMeter({ available, total, className = '' }: AvailabilityMeterProps) {
  if (total === 0) return null
  const tone = availabilityTone(available, total)

  return (
    <div className={`flex shrink-0 flex-col items-end gap-1 ${className}`}>
      <span className={`measure font-medium ${TEXT_CLASS[tone]}`}>
        {available}/{total}
      </span>
      <div
        className="flex w-20 gap-px"
        role="img"
        aria-label={`${available} von ${total} Zutaten vorhanden`}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 min-w-0 flex-1 rounded-xs ${index < available ? FILL_CLASS[tone] : 'bg-rule'}`}
          />
        ))}
      </div>
    </div>
  )
}
