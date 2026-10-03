import type { ReviewItem } from './types'

// 结算侧待复核清单：抄表核对的结果落到这里，持久化在浏览器里，结算页面复核后归档。
const STORAGE_KEY = 'district-heating:review-queue'

let cache: ReviewItem[] | null = null

function read(): ReviewItem[] {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = []
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = []
    return cache
  }
  try {
    cache = JSON.parse(raw) as ReviewItem[]
  } catch {
    cache = []
  }
  return cache
}

function write(items: ReviewItem[]): void {
  cache = items
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }
}

export function listReviewItems(): ReviewItem[] {
  return read()
}

// 同一来源、同一块表、同一个周期的待复核只留一条：重复提交只记一次，内容以最新为准。
export function enqueueReviewItem(input: Omit<ReviewItem, 'id' | 'status' | 'createdAt'>): ReviewItem[] {
  const items = read()
  const existing = items.find(
    (item) =>
      item.status === '待复核' &&
      item.source === input.source &&
      item.meterNo === input.meterNo &&
      item.period === input.period,
  )
  if (existing) {
    const merged = items.map((item) =>
      item.id === existing.id ? { ...item, ...input, createdAt: new Date().toISOString() } : item,
    )
    write(merged)
    return merged
  }
  const id = items.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const next = [...items, { ...input, id, status: '待复核', createdAt: new Date().toISOString() }]
  write(next)
  return next
}

export function resolveReviewItem(id: number): ReviewItem[] {
  const next = read().map((item) => (item.id === id ? { ...item, status: '已复核' } : item))
  write(next)
  return next
}
