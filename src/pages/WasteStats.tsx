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
import BackLink from '../components/BackLink'
import ConsumptionTrendChart from '../components/ConsumptionTrendChart'

const WINDOW_DAYS = 30
const TREND_BUCKET_DAYS = 5

function BarRow({ label, value, maxValue, suffix = '' }: { label: string; value: number; maxValue: number; suffix?: string }) {
  const width = maxValue > 0 ? Math.max((value / maxValue) * 100, 4) : 0
  return (
    <li>
      <div className="flex items-center justify-between text-sm">
        <span className="min-w-0 truncate text-gray-900">{label}</span>
        <span className="shrink-0 text-xs text-gray-500">
          {value}
          {suffix}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-gray-100">
        <div className="h-1.5 rounded-full bg-gray-900" style={{ width: `${width}%` }} />
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
    <section className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
      </div>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  )
}

function SubsectionCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>}
      <div className={title ? 'mt-2' : ''}>{children}</div>
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
    <div className="p-4">
      <div className="flex items-center gap-2">
        <BackLink to="/" />
        <h1 className="text-xl font-semibold">Statistik</h1>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Lädt...</p>
      ) : noData ? (
        <p className="mt-6 text-sm text-gray-500">
          Noch keine Daten. Wird erfasst, sobald Artikel verbraucht, weggeworfen oder Rezepte gekocht werden.
        </p>
      ) : (
        <Section title="Verbrauch" subtitle={`Letzte ${WINDOW_DAYS} Tage`}>
          {total > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                <p className="text-xl font-semibold text-gray-900">{consumedCount}</p>
                <p className="text-xs text-gray-500">Aufgebraucht</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                <p className="text-xl font-semibold text-gray-900">{discardedCount}</p>
                <p className="text-xs text-gray-500">Weggeworfen</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                <p className="text-xl font-semibold text-gray-900">{wasteRate}%</p>
                <p className="text-xs text-gray-500">Verschwendung</p>
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
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xl font-semibold text-gray-900">{avgDays.toFixed(1)}</p>
                  <p className="text-xs text-gray-500">Ø Tage bis zur Verwendung</p>
                </div>
              )}
              {topWastedCategories.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-sm font-semibold text-gray-900 truncate">{topWastedCategories[0].category}</p>
                  <p className="text-xs text-gray-500">meistverschwendete Kategorie</p>
                </div>
              )}
            </div>
          )}

          {discardedEntries.length > 0 && (
            <SubsectionCard title="Zuletzt weggeworfen">
              <ul className="divide-y divide-gray-100">
                {discardedEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between py-2">
                    <span className="min-w-0 truncate text-sm text-gray-900">
                      {entry.name}
                      {entry.quantity ? ` (${entry.quantity}${entry.unit ? ` ${entry.unit}` : ''})` : ''}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">{formatRelativeTime(entry.logged_at)}</span>
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
