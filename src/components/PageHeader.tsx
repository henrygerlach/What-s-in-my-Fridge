import type { ReactNode } from 'react'
import BackLink from './BackLink'

/*
 * Sticky across every page: an inventory can run to a hundred rows, and the
 * actions that act on the whole list ("Alle ins Inventar", "+") have to stay
 * within thumb reach the whole way down.
 */
export default function PageHeader({
  title,
  back,
  children,
}: {
  title: string
  back?: string
  children?: ReactNode
}) {
  return (
    <header className="page-bar">
      {back && <BackLink to={back} />}
      <h1 className="page-title">{title}</h1>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  )
}
