import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  MeterDetailResult,
  MeterReadingDraft,
  MeterReconLine,
  ModuleMeta,
  OverviewResult,
  PageQuery,
  PageResult,
  StatusSummary,
  SubmitReadingResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '标记']

// 抄表核对转入结算时使用的默认热价，结算那边复核时可以再改。
const DEFAULT_HEAT_PRICE = 0.25

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

/**
 * 分页查询：先在同一份数据上筛选，再从筛选结果里切出当前页。
 * 页码或每页条数缺失、不是正整数时直接挡下，不返回任何数据。
 */
export function listEntriesPage(
  key: string,
  filters: Record<string, string> = {},
  query: PageQuery,
): PageResult {
  if (!query || !Number.isInteger(query.page) || query.page < 1) {
    throw new Error('页码缺失或不合法，已挡下本次查询，请先指定要翻到的页码')
  }
  if (!Number.isInteger(query.size) || query.size < 1) {
    throw new Error('每页条数缺失或不合法，已挡下本次查询')
  }
  const matched = filterRows(listRows(key), filters)
  const start = (query.page - 1) * query.size
  return {
    items: matched.slice(start, start + query.size),
    total: matched.length,
    page: query.page,
    size: query.size,
  }
}

/** 与列表同一份筛选结果上数出来的条数：页脚总数、状态图例、明细面板都以此为准。 */
export function summarizeEntries(key: string, filters: Record<string, string> = {}): StatusSummary {
  const matched = filterRows(listRows(key), filters)
  const byStatus: Record<string, number> = {}
  for (const row of matched) {
    const status = String(row.status)
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  return { total: matched.length, byStatus }
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

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextReadingNo(rows: EntryRow[]): string {
  const maxNo = rows.reduce((max, row) => {
    const match = /^HEAT-(\d+)$/.exec(String(row['抄表编号'] ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `HEAT-${String(maxNo + 1).padStart(4, '0')}`
}

/** 累计热量可能是数字，也可能是既有台账里的占位文本；解析不出来就返回 null，对账时标出来。 */
function toHeat(value: EntryRow[string]): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function byPeriodThenDate(a: EntryRow, b: EntryRow): number {
  const byPeriod = String(a['结算周期'] ?? '').localeCompare(String(b['结算周期'] ?? ''))
  if (byPeriod !== 0) {
    return byPeriod
  }
  const byDate = String(a['抄表日期'] ?? '').localeCompare(String(b['抄表日期'] ?? ''))
  if (byDate !== 0) {
    return byDate
  }
  return Number(a.id) - Number(b.id)
}

/**
 * 登记/重交抄表：同一块表在同一个结算周期只留一条。
 * 重交命中已有记录时合并回原行（更新读数与方式），页面上不会再多出一行。
 */
export function submitMeterReading(draft: MeterReadingDraft): SubmitReadingResult {
  const meterNo = draft.计量表号.trim()
  const period = draft.结算周期.trim()
  const way = draft.抄表方式.trim()
  const readDate = draft.抄表日期.trim()
  const userName = draft.用户名称.trim()
  const heat = toHeat(draft.累计热量)
  if (!meterNo) {
    return { ok: false, created: false, message: '计量表号不能为空' }
  }
  if (!userName) {
    return { ok: false, created: false, message: '用户名称不能为空' }
  }
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return { ok: false, created: false, message: '结算周期要按 2026-10 这样的年月填写' }
  }
  if (!readDate) {
    return { ok: false, created: false, message: '抄表日期不能为空' }
  }
  if (!way) {
    return { ok: false, created: false, message: '抄表方式不能为空' }
  }
  if (heat === null) {
    return { ok: false, created: false, message: '累计热量要填数字，否则后面核不出用量' }
  }
  const rows = listRows('heatmeter')
  const index = rows.findIndex(
    (row) => String(row['计量表号']) === meterNo && String(row['结算周期']) === period,
  )
  if (index >= 0) {
    const current = rows[index]
    const updated: EntryRow = {
      ...current,
      用户名称: userName,
      累计热量: heat,
      抄表方式: way,
      抄表日期: readDate,
      status: current.status === '待抄表' ? '抄表中' : current.status,
      抄表状态: current.status === '待抄表' ? '抄表中' : current.status,
      pending: current.status !== '已核对',
    }
    const next = [...rows]
    next[index] = updated
    saveRows('heatmeter', next)
    return {
      ok: true,
      created: false,
      message: `表号 ${meterNo} 在 ${period} 已有记录（抄表编号 ${current['抄表编号']}），重交已合并到原记录，只记一次`,
    }
  }
  const created: EntryRow = {
    id: nextId(rows),
    status: '抄表中',
    pending: true,
    abnormal: false,
    抄表编号: nextReadingNo(rows),
    计量表号: meterNo,
    用户名称: userName,
    累计热量: heat,
    抄表方式: way,
    抄表日期: readDate,
    结算周期: period,
    抄表状态: '抄表中',
  }
  saveRows('heatmeter', [...rows, created])
  return {
    ok: true,
    created: true,
    message: `已登记抄表记录 ${created['抄表编号']}（表号 ${meterNo}，${period}）`,
  }
}

/**
 * 按表号定位：明细行与列表页脚用同一份筛选结果，条数对得上；
 * 逐期用量按台账全量核算（不受筛选影响），末次累计 - 首次累计 = 各期用量合计。
 */
export function meterReadingDetail(
  meterNo: string,
  filters: Record<string, string> = {},
): MeterDetailResult {
  const matched = filterRows(listRows('heatmeter'), filters)
  const rows = matched.filter((row) => String(row['计量表号']) === meterNo)
  const ledger = listRows('heatmeter')
    .filter((row) => String(row['计量表号']) === meterNo)
    .slice()
    .sort(byPeriodThenDate)
  let previous: number | null = null
  let firstCumulative: number | null = null
  let lastCumulative: number | null = null
  let totalUsage = 0
  let reconOk = ledger.length > 0
  const recon: MeterReconLine[] = ledger.map((row) => {
    const cumulative = toHeat(row['累计热量'])
    let usage: number | null = null
    if (cumulative === null) {
      reconOk = false
    } else {
      if (firstCumulative === null) {
        firstCumulative = cumulative
      }
      if (previous !== null) {
        usage = round2(cumulative - previous)
        totalUsage += usage
      }
      previous = cumulative
      lastCumulative = cumulative
    }
    return {
      抄表编号: String(row['抄表编号'] ?? ''),
      结算周期: String(row['结算周期'] ?? ''),
      抄表日期: String(row['抄表日期'] ?? ''),
      抄表方式: String(row['抄表方式'] ?? ''),
      累计热量: cumulative,
      本期用量: usage,
      status: String(row.status),
    }
  })
  const userName = String((rows[0] ?? ledger[0])?.['用户名称'] ?? '')
  return {
    meterNo,
    userName,
    matchedTotal: matched.length,
    rows,
    recon,
    firstCumulative,
    lastCumulative,
    totalUsage: firstCumulative === null ? null : round2(totalUsage),
    reconOk,
  }
}

/** 该条抄表相对上一期的用量：同一块表、结算周期更早的最近一条来减。 */
function periodUsage(reading: EntryRow): number | null {
  const heat = toHeat(reading['累计热量'])
  if (heat === null) {
    return null
  }
  const meterNo = String(reading['计量表号'])
  const period = String(reading['结算周期'])
  const earlier = listRows('heatmeter')
    .filter(
      (row) =>
        String(row['计量表号']) === meterNo &&
        String(row['结算周期']) < period &&
        toHeat(row['累计热量']) !== null,
    )
    .sort(byPeriodThenDate)
  if (earlier.length === 0) {
    return null
  }
  const base = toHeat(earlier[earlier.length - 1]['累计热量'])
  return base === null ? null : round2(heat - base)
}

/** 核对结果落到热费结算的待复核清单：结算编号由抄表编号派生，重核只更新不新增。 */
function upsertBillingReview(reading: EntryRow): void {
  const rows = listRows('heatbilling')
  const settleNo = `JS-${String(reading['抄表编号'])}`
  const usage = periodUsage(reading)
  const amount = usage === null ? '待核算' : round2(usage * DEFAULT_HEAT_PRICE)
  const index = rows.findIndex((row) => String(row['结算编号']) === settleNo)
  if (index >= 0) {
    // 已有结算单只同步抄表侧信息，不动它的状态，避免把已缴费的单子拉回待复核。
    const next = [...rows]
    next[index] = { ...next[index], 用户名称: reading['用户名称'], 应缴金额: amount }
    saveRows('heatbilling', next)
    return
  }
  const created: EntryRow = {
    id: nextId(rows),
    status: '待核算',
    pending: true,
    abnormal: false,
    结算编号: settleNo,
    用户名称: reading['用户名称'],
    用热面积: '—',
    热价标准: `${DEFAULT_HEAT_PRICE} 元/千瓦时`,
    应缴金额: amount,
    缴费日期: '',
    收费员: '待分派',
    结算状态: '待核算',
  }
  saveRows('heatbilling', [...rows, created])
}

/**
 * 确认核对：先走通用状态流转（已核对），再把核对结果落到热费结算待复核清单。
 * 重复确认会被通用流转挡下（已经是「已核对」），结算侧也不会重复建单。
 */
export function confirmMeterReading(id: number): ActionResult {
  const result = runAction('heatmeter', id, '确认核对')
  if (!result.ok) {
    return result
  }
  const rows = listRows('heatmeter')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return result
  }
  // 已核对是抄表流程的终点，别再挂在待处理里。
  const reading: EntryRow = { ...rows[index], pending: false }
  const next = [...rows]
  next[index] = reading
  saveRows('heatmeter', next)
  upsertBillingReview(reading)
  return { ok: true, message: `${result.message}；核对结果已落到热费结算待复核清单` }
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
