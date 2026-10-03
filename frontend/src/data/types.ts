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

/** 分页查询参数：页码与每页条数都必须显式给出，缺失在服务层直接挡下。 */
export type PageQuery = {
  page: number
  size: number
}

/** 同一筛选口径下的条数汇总：列表页脚、状态图例、明细面板都从这里取数，保证对得上。 */
export type StatusSummary = {
  total: number
  byStatus: Record<string, number>
}

/** 登记/重交抄表的表单草稿。重交按「计量表号 + 结算周期」合并，只记一次。 */
export type MeterReadingDraft = {
  计量表号: string
  用户名称: string
  累计热量: string
  抄表方式: string
  抄表日期: string
  结算周期: string
}

export type SubmitReadingResult = ActionResult & {
  created: boolean
}

/** 按表号定位后逐期对账的一行：本期用量 = 本期累计 - 上一期累计。 */
export type MeterReconLine = {
  抄表编号: string
  结算周期: string
  抄表日期: string
  抄表方式: string
  累计热量: number | null
  本期用量: number | null
  status: string
}

export type MeterDetailResult = {
  meterNo: string
  userName: string
  /** 当前筛选条件命中的总条数，与列表页脚同一个数。 */
  matchedTotal: number
  /** 该表号在当前筛选结果里的明细行，条数与列表同口径。 */
  rows: EntryRow[]
  /** 台账全量逐期对账（不受筛选影响），用于核出累计热量。 */
  recon: MeterReconLine[]
  firstCumulative: number | null
  lastCumulative: number | null
  totalUsage: number | null
  reconOk: boolean
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
