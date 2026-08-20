import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

/* Line icons rather than emoji: at 22px on a phone, emoji at three different
   optical weights read as three unrelated stickers. */
const icons: Record<string, ReactNode> = {
  inventory: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M3 15h18M8 9v6M16 9v6" />
    </>
  ),
  recipes: (
    <>
      <path d="M5 10h14v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-6Z" />
      <path d="M19 11h1.5a1.5 1.5 0 0 1 0 3H19M8 6.5c0-1 1-1.5 1-2.5M12 6.5c0-1 1-1.5 1-2.5M16 6.5c0-1 1-1.5 1-2.5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m4 5.5 1.2 1.2L7.5 4.2M4 17.5l1.2 1.2 2.3-2.5" />
      <circle cx="5.2" cy="12" r="0.6" />
    </>
  ),
}

const links = [
  { to: '/', label: 'Inventar', icon: 'inventory', end: true },
  { to: '/recipes', label: 'Rezepte', icon: 'recipes', end: false },
  { to: '/shopping-list', label: 'Einkauf', icon: 'list', end: false },
]

export default function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-rule bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {links.map(({ to, label, icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `relative flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-ink-faint transition-colors ${
              isActive ? 'text-ink' : 'hover:text-ink-muted'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {/* A shelf rail over the active tab, echoing the rule that runs
                  off every shelf label in the lists below. */}
              <span
                aria-hidden
                className={`absolute inset-x-5 top-0 h-0.5 rounded-full ${isActive ? 'bg-ink' : 'bg-transparent'}`}
              />
              <svg
                viewBox="0 0 24 24"
                className="h-[22px] w-[22px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={isActive ? 2 : 1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {icons[icon]}
              </svg>
              <span
                className="text-[11px] font-semibold uppercase"
                style={{ fontFamily: 'var(--font-display)', fontVariationSettings: "'wdth' 84", letterSpacing: '0.06em' }}
              >
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
