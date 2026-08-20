import { Link } from 'react-router-dom'

export default function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      aria-label="Zurück"
      className="btn-icon -ml-2 text-ink-muted hover:bg-shelf hover:text-ink"
    >
      ←
    </Link>
  )
}
