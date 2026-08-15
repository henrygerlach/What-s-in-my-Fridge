import { useEffect, useRef } from 'react'
import { supabase } from './supabase'
import type { RealtimePostgresChangesFilter } from '@supabase/supabase-js'

type ChangeFilter = Omit<RealtimePostgresChangesFilter<'*'>, 'event' | 'schema'>

// Subscribes to Postgres changes on the given tables and calls onChange
// whenever a row is inserted/updated/deleted, so other devices' edits show
// up here without a manual reload. `onChange` is read from a ref so callers
// don't need to memoize it.
export function useRealtimeRefresh(tables: Array<{ table: string; filter?: ChangeFilter['filter'] }>, onChange: () => void) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const tablesKey = tables.map((t) => `${t.table}:${t.filter ?? ''}`).join(',')

  useEffect(() => {
    const channel = supabase.channel(`sync:${tablesKey}:${crypto.randomUUID()}`)
    for (const { table, filter } of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => onChangeRef.current(),
      )
    }
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey])
}
