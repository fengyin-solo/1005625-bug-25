import type { EntryRow, MeterDetail, MeterPageResult } from './types'

// 热计量抄表的领域逻辑：去重口径、排序、分页、合计、按表号定位。
// 页面不直接算这些，统一走这里，保证列表、分页、明细看到的是同一份数据。

// 抄表方式的可选值，沿用既有抄表做法里的三类。
export const READING_METHODS = ['人工抄表', '远程集抄', '红外抄表']

export const PAGE_SIZE_OPTIONS = [5, 10, 20]

export type ReadingDraft = {
  计量表号: string
  用户名称: string
  累计热量: number
  抄表方式: string
  抄表日期: string
  结算周期: string
}

// 重交去重的口径：同一块表在同一个结算周期只算一条；跨期（上月/本月）的各算各的。
export function readingDedupKey(meterNo: string, period: string): string {
  return `${meterNo.trim()}::${period.trim()}`
}

export function parseHeat(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export function sumHeat(rows: EntryRow[]): number {
  const total = rows.reduce((sum, row) => sum + parseHeat(row['累计热量']), 0)
  return Math.round(total * 100) / 100
}

// 台账固定排序：先结算周期、再表号、再编号。跨期的两条按周期归位，翻页边界稳定。
export function sortReadings(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort((a, b) => {
    const byPeriod = String(a['结算周期'] ?? '').localeCompare(String(b['结算周期'] ?? ''))
    if (byPeriod !== 0) return byPeriod
    const byMeter = String(a['计量表号'] ?? '').localeCompare(String(b['计量表号'] ?? ''))
    if (byMeter !== 0) return byMeter
    return Number(a.id) - Number(b.id)
  })
}

// 分页：页码缺失、不是正整数、超出范围的都先挡下，返回 ok:false，调用方保持当前页不动。
export function paginateReadings(rows: EntryRow[], pageInput: string, size: number): MeterPageResult {
  const total = rows.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const blocked = (message: string): MeterPageResult => ({
    ok: false,
    message,
    items: [],
    filtered: rows,
    total,
    totalHeat: sumHeat(rows),
    page: 1,
    pageCount,
    size,
  })
  const trimmed = pageInput.trim()
  if (trimmed === '') {
    return blocked('页码缺失：请先填写要翻到的页码，本次翻页已挡下')
  }
  if (!/^\d+$/.test(trimmed)) {
    return blocked(`页码「${trimmed}」不是正整数，本次翻页已挡下`)
  }
  const page = Number(trimmed)
  if (page < 1 || page > pageCount) {
    return blocked(`页码 ${page} 超出范围（共 ${pageCount} 页），本次翻页已挡下`)
  }
  return {
    ok: true,
    message: '',
    items: rows.slice((page - 1) * size, page * size),
    filtered: rows,
    total,
    totalHeat: sumHeat(rows),
    page,
    pageCount,
    size,
  }
}

export function validateReadingDraft(raw: Record<string, string>): {
  ok: boolean
  message: string
  draft: ReadingDraft
} {
  const draft: ReadingDraft = {
    计量表号: (raw['计量表号'] ?? '').trim(),
    用户名称: (raw['用户名称'] ?? '').trim(),
    累计热量: Number(raw['累计热量']),
    抄表方式: (raw['抄表方式'] ?? '').trim(),
    抄表日期: (raw['抄表日期'] ?? '').trim(),
    结算周期: (raw['结算周期'] ?? '').trim(),
  }
  if (!draft.计量表号) return { ok: false, message: '计量表号不能为空', draft }
  if (!draft.用户名称) return { ok: false, message: '用户名称不能为空', draft }
  if (!Number.isFinite(draft.累计热量) || draft.累计热量 < 0) {
    return { ok: false, message: '累计热量需为不小于 0 的数字', draft }
  }
  if (!draft.抄表方式) return { ok: false, message: '请选择抄表方式', draft }
  if (!draft.抄表日期) return { ok: false, message: '抄表日期不能为空', draft }
  if (!/^\d{4}-\d{2}$/.test(draft.结算周期)) {
    return { ok: false, message: '结算周期需为 YYYY-MM 格式', draft }
  }
  return { ok: true, message: '', draft }
}

// 登记/重交：同表同周期原位更新（重交只记一次，状态回到待抄表重新核对），否则新增一条。
export function upsertReading(
  rows: EntryRow[],
  draft: ReadingDraft,
): { rows: EntryRow[]; row: EntryRow; created: boolean } {
  const key = readingDedupKey(draft.计量表号, draft.结算周期)
  const index = rows.findIndex(
    (row) => readingDedupKey(String(row['计量表号'] ?? ''), String(row['结算周期'] ?? '')) === key,
  )
  if (index >= 0) {
    const merged: EntryRow = {
      ...rows[index],
      ...draft,
      status: '待抄表',
      pending: true,
      abnormal: false,
      抄表状态: '待抄表',
    }
    const next = [...rows]
    next[index] = merged
    return { rows: next, row: merged, created: false }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id,
    status: '待抄表',
    pending: true,
    abnormal: false,
    抄表编号: `HEAT-${String(id).padStart(4, '0')}`,
    ...draft,
    抄表状态: '待抄表',
  }
  return { rows: [...rows, row], row, created: true }
}

// 按表号定位：拉出这块表所有周期的记录，条数与累计热量一起对出来。
export function meterDetail(rows: EntryRow[], meterNo: string): MeterDetail {
  const items = sortReadings(
    rows.filter((row) => String(row['计量表号'] ?? '').trim() === meterNo.trim()),
  )
  return { meterNo, items, count: items.length, totalHeat: sumHeat(items) }
}
