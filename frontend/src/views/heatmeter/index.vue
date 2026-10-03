<template>
  <section class="page" data-module="heatmeter">
    <header class="page-head">
      <div>
        <h2>热计量抄表管理</h2>
        <p class="page-desc">
          维护热计量抄表记录：筛选与翻页落在同一份数据上，按表号可核出累计热量；同一块表同一周期重交只记一次。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记/重交抄表记录</button>
        <button class="btn" type="button" @click="exportRows">导出热计量抄表清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ cellText(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">明细</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            当前筛选与页码下没有热计量抄表数据，可调整条件或页码
          </td>
        </tr>
      </tbody>
    </table>

    <div class="pager">
      <button class="btn" type="button" :disabled="page <= 1" @click="gotoPage(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ maxPage }} 页</span>
      <button class="btn" type="button" :disabled="page >= maxPage" @click="gotoPage(page + 1)">下一页</button>
      <label class="pager-jump">
        跳至
        <input v-model="pageInput" inputmode="numeric" @keyup.enter="jumpToInput" />
        页
      </label>
      <button class="btn" type="button" @click="jumpToInput">跳转</button>
      <label class="pager-size">
        每页
        <select v-model.number="size" @change="changeSize">
          <option v-for="option in pageSizes" :key="option" :value="option">{{ option }}</option>
        </select>
        条
      </label>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条热计量抄表记录（当前筛选口径）</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="editing" class="panel">
      <h3>登记/重交抄表记录</h3>
      <p class="panel-desc">
        同一块表在同一个结算周期只记一次：重交会合并到原记录，页面上不会再多出一行。
      </p>
      <form class="form-grid" @submit.prevent="submitForm">
        <label>
          <span>计量表号</span>
          <input v-model="draft.计量表号" placeholder="如 HM-1001" />
        </label>
        <label>
          <span>用户名称</span>
          <input v-model="draft.用户名称" placeholder="用热户姓名" />
        </label>
        <label>
          <span>累计热量</span>
          <input v-model="draft.累计热量" inputmode="decimal" placeholder="单位：千瓦时" />
        </label>
        <label>
          <span>抄表方式</span>
          <select v-model="draft.抄表方式">
            <option value="" disabled>请选择抄表方式</option>
            <option v-for="way in readingWays" :key="way" :value="way">{{ way }}</option>
          </select>
        </label>
        <label>
          <span>抄表日期</span>
          <input v-model="draft.抄表日期" type="date" />
        </label>
        <label>
          <span>结算周期</span>
          <input v-model="draft.结算周期" type="month" />
        </label>
        <div class="form-actions">
          <button class="btn primary" type="submit">提交抄表记录</button>
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
        </div>
      </form>
    </div>

    <div v-if="detail" class="panel">
      <h3>表号 {{ detail.meterNo }} 的抄表明细（{{ detail.userName }}）</h3>
      <p class="panel-desc">
        当前筛选共命中 {{ detail.matchedTotal }} 条（与列表页脚同口径），本表在筛选结果中
        {{ detail.rows.length }} 条；逐期用量按台账全量 {{ detail.recon.length }} 期核算。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>抄表编号</th>
            <th>结算周期</th>
            <th>抄表日期</th>
            <th>抄表方式</th>
            <th>累计热量</th>
            <th>本期用量</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in detail.recon" :key="line.抄表编号">
            <td>{{ line.抄表编号 }}</td>
            <td>{{ line.结算周期 }}</td>
            <td>{{ line.抄表日期 || '—' }}</td>
            <td>{{ line.抄表方式 }}</td>
            <td>{{ line.累计热量 ?? '—' }}</td>
            <td>{{ line.本期用量 ?? '—' }}</td>
            <td>{{ line.status }}</td>
          </tr>
        </tbody>
      </table>
      <p class="panel-desc">
        <template v-if="detail.reconOk">
          累计核对：首次累计 {{ detail.firstCumulative }} → 末次累计 {{ detail.lastCumulative }}，
          各期用量合计 {{ detail.totalUsage }}，与首末差值一致。
        </template>
        <template v-else>
          台账里存在未填或非数值的累计热量，相关期次用量暂无法核算，请先补录再核对。
        </template>
      </p>
      <button class="btn" type="button" @click="closeDetail">关闭明细</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  confirmMeterReading,
  downloadEntries,
  listEntriesPage,
  meterReadingDetail,
  moduleMeta,
  runAction as applyAction,
  submitMeterReading,
  summarizeEntries,
} from '@/api/local-service'
import type { EntryRow, MeterDetailResult, MeterReadingDraft, StatusSummary } from '@/data/types'

const meta = moduleMeta('heatmeter')
const columns = ["抄表编号", "计量表号", "用户名称", "累计热量", "抄表方式", "抄表日期", "结算周期", "抄表状态"]
const actions = ["提交抄表", "确认核对", "标记异常"]
const statuses = ["待抄表", "抄表中", "已核对", "抄表异常"]
const readingWays = ["人工抄表", "远程集抄", "移动终端"]
const pageSizes = [5, 10, 20]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(5)
const pageInput = ref('1')
const summary = ref<StatusSummary>({ total: 0, byStatus: {} })
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["抄表编号", "计量表号", "用户名称", "结算周期"]
const editing = ref(false)
const detail = ref<MeterDetailResult | null>(null)
const blankDraft: MeterReadingDraft = {
  计量表号: '',
  用户名称: '',
  累计热量: '',
  抄表方式: '',
  抄表日期: '',
  结算周期: '',
}
const draft = ref<MeterReadingDraft>({ ...blankDraft })

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const stats = computed(() => [
  { label: '待抄表用户', value: summary.value.byStatus['待抄表'] ?? 0 },
  { label: '已核对用户', value: summary.value.byStatus['已核对'] ?? 0 },
  { label: '异常表数', value: summary.value.byStatus['抄表异常'] ?? 0 },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: summary.value.byStatus[status] ?? 0,
  })),
)

function cellText(row: EntryRow, column: string) {
  const value = row[column]
  return value === '' || value === undefined || value === null ? '—' : value
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntriesPage(meta.key, filters.value, { page: page.value, size: size.value })
    if (payload.total > 0 && payload.items.length === 0 && page.value > 1) {
      // 数据变动后当前页可能空了，回到还有数据的最后一页
      page.value = Math.ceil(payload.total / size.value)
      reload()
      return
    }
    rows.value = payload.items
    total.value = payload.total
    summary.value = summarizeEntries(meta.key, filters.value)
    pageInput.value = String(page.value)
    if (detail.value) {
      detail.value = meterReadingDetail(detail.value.meterNo, filters.value)
    }
  } catch (error) {
    rows.value = []
    total.value = 0
    summary.value = { total: 0, byStatus: {} }
    errorMessage.value = error instanceof Error ? error.message : '热计量抄表列表读取失败'
  }
}

function applyFilters() {
  page.value = 1
  reload()
}

function resetFilters() {
  filters.value = {}
  page.value = 1
  reload()
}

function gotoPage(target: number) {
  page.value = target
  reload()
}

function jumpToInput() {
  const raw = pageInput.value.trim()
  const target = Number(raw)
  if (raw === '' || !Number.isInteger(target) || target < 1) {
    errorMessage.value = '页码缺失或不合法，已挡下本次跳转'
    return
  }
  page.value = Math.min(target, maxPage.value)
  reload()
}

function changeSize() {
  page.value = 1
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  draft.value = { ...blankDraft }
  editing.value = true
}

function closeForm() {
  editing.value = false
}

function submitForm() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = submitMeterReading(draft.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  editing.value = false
  reload()
}

function openDetail(row: EntryRow) {
  errorMessage.value = ''
  detail.value = meterReadingDetail(String(row['计量表号']), filters.value)
}

function closeDetail() {
  detail.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result =
    action === '确认核对'
      ? confirmMeterReading(Number(row.id))
      : applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

onMounted(reload)
</script>
