import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  paginateReadings,
  sortReadings,
  sumHeat,
  upsertReading,
  validateReadingDraft,
} from '@/data/meter-readings'
import { enqueueReviewItem, listReviewItems, resolveReviewItem } from '@/data/review-queue'
import type {
  ActionResult,
  EntryRow,
  MeterPageResult,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReviewItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 热计量抄表专用：筛选、排序、翻页、合计都落在同一份数据上 ——

const HEATMETER_KEY = 'heatmeter'

export function allMeterReadings(): EntryRow[] {
  return listRows(HEATMETER_KEY)
}

// 先筛、再按周期与表号排、后翻页；页码缺失或越界会被 paginateReadings 挡下。
export function listMeterReadings(
  filters: Record<string, string>,
  pageInput: string,
  size: number,
): MeterPageResult {
  const filtered = sortReadings(filterRows(listRows(HEATMETER_KEY), filters))
  return paginateReadings(filtered, pageInput, size)
}

// 登记/重交：先校验，同表同周期合并只记一次，新表新周期才新增。
export function submitMeterReading(raw: Record<string, string>): ActionResult {
  const check = validateReadingDraft(raw)
  if (!check.ok) {
    return { ok: false, message: check.message }
  }
  const { rows: next, row, created } = upsertReading(listRows(HEATMETER_KEY), check.draft)
  saveRows(HEATMETER_KEY, next)
  const message = created
    ? `已登记抄表记录 ${row['抄表编号']}`
    : `表 ${row['计量表号']} 在 ${row['结算周期']} 已有记录，重交已合并更新，只记一次`
  return { ok: true, message }
}

// 既有动作流转不变；确认核对、标记异常成功后，核对结果落到结算侧的待复核清单。
export function runMeterAction(id: number, action: string): ActionResult {
  const result = runAction(HEATMETER_KEY, id, action)
  if (result.ok && (action === '确认核对' || action === '标记异常')) {
    const row = listRows(HEATMETER_KEY).find((item) => Number(item.id) === id)
    if (row) {
      enqueueReviewItem({
        source: '热计量抄表',
        meterNo: String(row['计量表号'] ?? ''),
        userName: String(row['用户名称'] ?? ''),
        period: String(row['结算周期'] ?? ''),
        heat: sumHeat([row]),
        result: String(row.status),
      })
    }
  }
  return result
}

// 结算侧待复核清单的读写。
export function listSettlementReview(): ReviewItem[] {
  return listReviewItems()
}

export function settleReviewItem(id: number): ReviewItem[] {
  return resolveReviewItem(id)
}
