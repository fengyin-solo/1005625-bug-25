import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 存储带版本号：种子结构升级后，旧占位数据自动重播为新种子，不会把旧格式带进来。
const STORAGE_KEY = 'district-heating:entries'
const STORAGE_VERSION = 2

type StorageEnvelope = {
  version: number
  rows: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const envelope: StorageEnvelope = { version: STORAGE_VERSION, rows }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StorageEnvelope>
    if (parsed.version !== STORAGE_VERSION || !parsed.rows || typeof parsed.rows !== 'object') {
      persist(fallback)
      return fallback
    }
    return { ...fallback, ...parsed.rows }
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
