import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { loadRecentConsumptionLog } from '../lib/consumptionLog'
import type { ConsumptionLogEntry } from '../lib/consumptionLog'
import { loadRecentCookLog } from '../lib/cookLog'
import type { CookLogEntry } from '../lib/cookLog'
import {
  rankGoodsByUsage,
  rankCookedRecipes,
  averageDaysInStorage,
  rankWasteByCategory,
  bucketConsumptionTrend,
} from '../lib/foodStats'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { formatRelativeTime } from '../lib/relativeTime'
import PageHeader from '../components/PageHeader'
import ConsumptionTrendChart from '../components/ConsumptionTrendChart'

const WINDOW_DAYS = 30
const TREND_BUCKET_DAYS = 5

function BarRow({ label, value, maxValue, suffix = '' }: { label: string; value: number; maxValue: number; suffix?: string }) {
  const width = maxValue > 0 ? Math.max((value / maxValue) * 100, 4) : 0
  return (
    <li>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-ink">{label}</span>
        <span className="measure shrink-0">
          {value}
          {suffix}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-shelf">
        <div className="h-1.5 rounded-full bg-ink" style={{ width: `${width}%` }} />
      </div>
    </li>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="shelf-label flex-1">{title}</h2>
        {subtitle && <span className="measure shrink-0">{subtitle}</span>}
      </div>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  )
}

function SubsectionCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="card p-3">
      {title && <h3 className="shelf-label">{title}</h3>}
      <div className={title ? 'mt-3' : ''}>{children}</div>
    </div>
  )
}

export default function WasteStats() {
  const [entries, setEntries] = useState<ConsumptionLogEntry[]>([])
  const [cookEntries, setCookEntries] = useState<CookLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const since = new Date()
    since.setDate(since.getDate() - WINDOW_DAYS)
    const sinceIso = since.toISOString()
    const [consumption, cooked] = await Promise.all([
      loadRecentConsumptionLog(sinceIso),
      loadRecentCookLog(sinceIso),
    ])
    setEntries(consumption)
    setCookEntries(cooked)
  }, [])

  useEffect(() => {
    setLoading(true)
    load().then(() => setLoading(false))
  }, [load])

  useRealtimeRefresh([{ table: 'consumption_log' }, { table: 'recipe_cook_log' }], load)

  const consumedCount = entries.filter((e) => e.reason === 'consumed').length
  const discardedCount = entries.filter((e) => e.reason === 'discarded').length
  const total = consumedCount + discardedCount
  const wasteRate = total > 0 ? Math.round((discardedCount / total) * 100) : 0
  const discardedEntries = entries.filter((e) => e.reason === 'discarded')

  const trend = bucketConsumptionTrend(entries, WINDOW_DAYS, TREND_BUCKET_DAYS)
  const topUsedGoods = rankGoodsByUsage(entries).slice(0, 5)
  const topRecipes = rankCookedRecipes(cookEntries).slice(0, 5)
  const avgDays = averageDaysInStorage(entries)
  const topWastedCategories = rankWasteByCategory(entries).slice(0, 3)
  const maxGoodUsage = topUsedGoods[0]?.count ?? 0
  const maxRecipeCount = topRecipes[0]?.count ?? 0

  const noData = total === 0 && cookEntries.length === 0

  return (
    <div className="page">
      <PageHeader title="Statistik" back="/" />

      {loading ? (
        <p className="mt-8 text-center text-sm text-ink-faint">Lädt...</p>
      ) : noData ? (
        <p className="mt-8 text-center text-sm text-ink-muted">
          Noch keine Daten. Sie entstehen, sobald du Artikel verbrauchst, wegwirfst oder ein Rezept kochst.
        </p>
      ) : (
        <Section title="Verbrauch" subtitle={`Letzte ${WINDOW_DAYS} Tage`}>
          {total > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <div className="card p-3 text-center">
                <p className="stat text-full">{consumedCount}</p>
                <p className="mt-0.5 text-xs text-ink-muted">Aufgebraucht</p>
              </div>
              <div className="card p-3 text-center">
                <p className="stat text-none">{discardedCount}</p>
                <p className="mt-0.5 text-xs text-ink-muted">Weggeworfen</p>
              </div>
              <div className="card p-3 text-center">
                <p className="stat">{wasteRate}%</p>
                <p className="mt-0.5 text-xs text-ink-muted">Verschwendung</p>
              </div>
            </div>
          )}

          {total > 0 && (
            <SubsectionCard title="Verlauf">
              <ConsumptionTrendChart data={trend} />
            </SubsectionCard>
          )}

          {topRecipes.length > 0 && (
            <SubsectionCard title="Lieblingsgerichte">
              <ul className="flex flex-col gap-2">
                {topRecipes.map((recipe) => (
                  <BarRow
                    key={recipe.recipeId}
                    label={recipe.title}
                    value={recipe.count}
                    maxValue={maxRecipeCount}
                    suffix="×"
                  />
                ))}
              </ul>
            </SubsectionCard>
          )}

          {topUsedGoods.length > 0 && (
            <SubsectionCard title="Meistgenutzte Lebensmittel">
              <ul className="flex flex-col gap-2">
                {topUsedGoods.map((good) => (
                  <BarRow key={good.name} label={good.name} value={good.count} maxValue={maxGoodUsage} suffix="×" />
                ))}
              </ul>
            </SubsectionCard>
          )}

          {(avgDays != null || topWastedCategories.length > 0) && (
            <div className="grid grid-cols-2 gap-2">
              {avgDays != null && (
                <div className="card p-3">
                  <p className="stat">{avgDays.toFixed(1)}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">Ø Tage bis zur Verwendung</p>
                </div>
              )}
              {topWastedCategories.length > 0 && (
                <div className="card p-3">
                  <p className="truncate text-base font-bold text-ink">{topWastedCategories[0].category}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">meistverschwendete Kategorie</p>
                </div>
              )}
            </div>
          )}

          {discardedEntries.length > 0 && (
            <SubsectionCard title="Zuletzt weggeworfen">
              <ul className="divide-y divide-rule">
                {discardedEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0 truncate text-sm text-ink">
                      {entry.name}
                      {entry.quantity ? ` (${entry.quantity}${entry.unit ? ` ${entry.unit}` : ''})` : ''}
                    </span>
                    <span className="measure shrink-0">{formatRelativeTime(entry.logged_at)}</span>
                  </li>
                ))}
              </ul>
            </SubsectionCard>
          )}
        </Section>
      )}
    </div>
  )
}
