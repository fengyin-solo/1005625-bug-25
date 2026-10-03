/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 热计量抄表的分页结果：列表、页码、合计都从同一份筛选后的数据里出来。
export type MeterPageResult = {
  ok: boolean
  message: string
  items: EntryRow[]
  filtered: EntryRow[]
  total: number
  totalHeat: number
  page: number
  pageCount: number
  size: number
}

// 按表号定位出来的抄表明细：一块表跨期的所有记录、条数与累计热量。
export type MeterDetail = {
  meterNo: string
  items: EntryRow[]
  count: number
  totalHeat: number
}

// 结算侧待复核清单的一条：抄表核对结果落过来，复核通过后归档。
export type ReviewItem = {
  id: number
  source: string
  meterNo: string
  userName: string
  period: string
  heat: number
  result: string
  status: string
  createdAt: string
}
