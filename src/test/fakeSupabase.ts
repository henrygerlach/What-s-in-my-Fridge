import { vi } from 'vitest'

// An in-memory stand-in for the Supabase client. It is deliberately a small
// working database rather than a set of return-value stubs: the logic worth
// testing in src/lib is the merging, filtering and ordering *around* the
// query, and stubbing the query away would test nothing.

type Row = Record<string, any>

export const db = new Map<string, Row[]>()

// Forced failures, keyed by `${table}:${op}`, so tests can drive the error
// branches (which is where the undo/rollback logic lives).
const failures = new Map<string, { message: string }>()

let idCounter = 0

export function resetDb() {
  db.clear()
  failures.clear()
  idCounter = 0
  functionsInvoke.mockReset()
  functionsInvoke.mockResolvedValue({ data: null, error: null })
  storageUpload.mockReset()
  storageUpload.mockResolvedValue({ data: { path: 'uploaded/path.jpg' }, error: null })
  storageRemove.mockReset()
  storageRemove.mockResolvedValue({ data: null, error: null })
  channelSubscribe.mockClear()
  channelOn.mockClear()
  removeChannel.mockClear()
}

export function seed(table: string, rows: Row[]): Row[] {
  const stored = rows.map((row) => ({ id: row.id ?? `${table}-${++idCounter}`, created_at: '2026-01-01T00:00:00.000Z', ...row }))
  db.set(table, [...(db.get(table) ?? []), ...stored])
  return stored
}

export function rows(table: string): Row[] {
  return db.get(table) ?? []
}

export function failOn(table: string, op: 'insert' | 'update' | 'delete' | 'select', message = 'boom') {
  failures.set(`${table}:${op}`, { message })
}

function matchesIlike(value: unknown, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i')
  return regex.test(String(value ?? ''))
}

// Mirrors the `on delete cascade` foreign keys in supabase/migrations:
// deleting a recipe takes its ingredients, plan entries and cook log with it.
// Without this the fake would let tests assert a world Postgres never allows.
const CASCADES: Record<string, Array<{ table: string; column: string }>> = {
  recipes: [
    { table: 'recipe_ingredients', column: 'recipe_id' },
    { table: 'meal_plan_items', column: 'recipe_id' },
    { table: 'recipe_cook_log', column: 'recipe_id' },
  ],
}

interface Filter {
  kind: 'eq' | 'gte' | 'lte' | 'ilike' | 'in' | 'contains'
  column: string
  value: any
}

function applyFilters(source: Row[], filters: Filter[]): Row[] {
  return source.filter((row) =>
    filters.every((filter) => {
      const cell = row[filter.column]
      switch (filter.kind) {
        case 'eq':
          return cell === filter.value
        case 'gte':
          return cell >= filter.value
        case 'lte':
          return cell <= filter.value
        case 'ilike':
          return matchesIlike(cell, filter.value)
        case 'in':
          return (filter.value as any[]).includes(cell)
        case 'contains':
          return (filter.value as any[]).every((needle) => Array.isArray(cell) && cell.includes(needle))
      }
    }),
  )
}

class Query implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = []
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: any = null
  private selectColumns = '*'
  private returnsRows = false
  private wantsSingle = false
  private sort: { column: string; ascending: boolean } | null = null

  private table: string

  constructor(table: string) {
    this.table = table
  }

  select(columns = '*') {
    this.selectColumns = columns
    if (this.op === 'select') this.returnsRows = true
    else this.returnsRows = true
    return this
  }
  insert(payload: Row | Row[]) {
    this.op = 'insert'
    this.payload = payload
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.payload = patch
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(column: string, value: any) {
    this.filters.push({ kind: 'eq', column, value })
    return this
  }
  gte(column: string, value: any) {
    this.filters.push({ kind: 'gte', column, value })
    return this
  }
  lte(column: string, value: any) {
    this.filters.push({ kind: 'lte', column, value })
    return this
  }
  ilike(column: string, value: string) {
    this.filters.push({ kind: 'ilike', column, value })
    return this
  }
  in(column: string, value: any[]) {
    this.filters.push({ kind: 'in', column, value })
    return this
  }
  contains(column: string, value: any[]) {
    this.filters.push({ kind: 'contains', column, value })
    return this
  }
  match(criteria: Row) {
    for (const [column, value] of Object.entries(criteria)) this.eq(column, value)
    return this
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.sort = { column, ascending: options?.ascending !== false }
    return this
  }
  single() {
    this.wantsSingle = true
    this.returnsRows = true
    return this
  }

  private run() {
    const failure = failures.get(`${this.table}:${this.op}`)
    if (failure) return { data: null, error: failure }

    const table = db.get(this.table) ?? []
    let result: Row[] = []

    if (this.op === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload]
      result = incoming.map((row) => ({
        id: row.id ?? `${this.table}-${++idCounter}`,
        created_at: new Date().toISOString(),
        ...row,
      }))
      db.set(this.table, [...table, ...result])
    } else if (this.op === 'update') {
      const targets = applyFilters(table, this.filters)
      for (const target of targets) Object.assign(target, this.payload)
      result = targets
    } else if (this.op === 'delete') {
      const targets = applyFilters(table, this.filters)
      db.set(
        this.table,
        table.filter((row) => !targets.includes(row)),
      )
      const deletedIds = new Set(targets.map((row) => row.id))
      for (const cascade of CASCADES[this.table] ?? []) {
        const children = db.get(cascade.table) ?? []
        db.set(
          cascade.table,
          children.filter((child) => !deletedIds.has(child[cascade.column])),
        )
      }
      result = targets
    } else {
      result = applyFilters(table, this.filters)
    }

    if (this.sort) {
      const { column, ascending } = this.sort
      result = [...result].sort((a, b) => {
        if (a[column] === b[column]) return 0
        return (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1)
      })
    }

    // Emulate the one embedded-resource select the app uses:
    // `recipe_cook_log.select('recipe_id, cooked_at, recipes(title)')`.
    const embedded = this.selectColumns.match(/(\w+)\(title\)/)
    if (embedded) {
      const related = db.get(embedded[1]) ?? []
      result = result.map((row) => {
        const parent = related.find((candidate) => candidate.id === row.recipe_id)
        return { ...row, [embedded[1]]: parent ? { title: parent.title } : null }
      })
    }

    if (this.wantsSingle) {
      if (result.length === 0) return { data: null, error: { message: 'No rows found' } }
      return { data: { ...result[0] }, error: null }
    }
    return { data: this.returnsRows || this.op === 'select' ? result.map((row) => ({ ...row })) : null, error: null }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}

export const functionsInvoke = vi.fn(async (_name: string, _options?: any) => ({ data: null as any, error: null as any }))
export const storageUpload = vi.fn(async (_path: string, _file: any, _options?: any) => ({
  data: { path: 'uploaded/path.jpg' } as { path: string } | null,
  error: null as any,
}))
export const storageRemove = vi.fn(async (_paths: string[]) => ({ data: null as any, error: null as any }))
export const channelOn = vi.fn()
export const channelSubscribe = vi.fn()
export const removeChannel = vi.fn()

// Handlers registered by useRealtimeRefresh, so tests can fire a change.
export const realtimeHandlers: Array<() => void> = []

export const supabase = {
  from: (table: string) => new Query(table),
  functions: { invoke: (...args: any[]) => (functionsInvoke as any)(...args) },
  storage: {
    from: (_bucket: string) => ({
      upload: (...args: any[]) => (storageUpload as any)(...args),
      remove: (...args: any[]) => (storageRemove as any)(...args),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
    }),
  },
  channel: (name: string) => {
    const channel = {
      on: (_event: string, _filter: any, handler: () => void) => {
        channelOn(name, _filter)
        realtimeHandlers.push(handler)
        return channel
      },
      subscribe: () => {
        channelSubscribe(name)
        return channel
      },
    }
    return channel
  },
  removeChannel: (channel: any) => {
    removeChannel(channel)
    realtimeHandlers.length = 0
    return Promise.resolve('ok')
  },
}

// Fires every registered realtime handler, as a remote change would.
export function emitRealtimeChange() {
  for (const handler of [...realtimeHandlers]) handler()
}
