import { Link } from 'react-router-dom'

export default function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      aria-label="Zurück"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
    >
      ←
    </Link>
  )
}
