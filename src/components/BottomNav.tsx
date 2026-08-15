import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Inventar', end: true },
  { to: '/recipes', label: 'Rezepte', end: false },
  { to: '/shopping-list', label: 'Einkaufsliste', end: false },
]

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 flex border-t border-gray-200 bg-white">
      {links.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex-1 py-3 text-center text-sm ${
              isActive ? 'font-semibold text-black' : 'text-gray-500'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
