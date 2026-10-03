<template>
  <section class="page" data-module="heatmeter">
    <header class="page-head">
      <div>
        <h2>热计量抄表管理</h2>
        <p class="page-desc">维护热计量抄表记录，围绕抄表编号、计量表号、用户名称、累计热量做登记、筛选与状态流转；筛选与翻页落在同一份数据上，同表同周期重交只记一次。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleForm">
          {{ showForm ? '收起登记表单' : '登记/重交抄表记录' }}
        </button>
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

    <form v-if="showForm" class="entry-form" @submit.prevent="submitForm">
      <label v-for="field in formFields" :key="field.key" class="filter-item">
        <span>{{ field.label }}</span>
        <select v-if="field.key === '抄表方式'" v-model="form[field.key]">
          <option value="">请选择</option>
          <option v-for="method in readingMethods" :key="method" :value="method">{{ method }}</option>
        </select>
        <input v-else :type="field.type" v-model="form[field.key]" :placeholder="field.label" />
      </label>
      <button class="btn primary" type="submit">提交（重交只记一次）</button>
      <button class="btn ghost" type="button" @click="toggleForm">取消</button>
    </form>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无热计量抄表数据，可先登记热计量抄表记录</td>
        </tr>
      </tbody>
    </table>

    <div class="pager-bar">
      <span>共 {{ total }} 条 · 当前口径累计热量合计 {{ totalHeat }} MWh</span>
      <span class="pager-controls">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第</span>
        <input class="pager-input" v-model="pageInput" @keyup.enter="jumpPage" />
        <span>/ 共 {{ pageCount }} 页</span>
        <button class="btn" type="button" @click="jumpPage">跳转</button>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
        <select v-model="pageSize" @change="changeSize">
          <option v-for="size in pageSizeOptions" :key="size" :value="size">每页 {{ size }} 条</option>
        </select>
      </span>
    </div>

    <aside v-if="detail" class="detail-panel">
      <header class="detail-head">
        <strong>抄表明细：{{ detail.meterNo }}</strong>
        <button class="link" type="button" @click="closeDetail">关闭</button>
      </header>
      <p class="detail-summary">
        明细 {{ detail.count }} 条 · 累计热量合计 {{ detail.totalHeat }} MWh；
        列表同口径 {{ detailEcho.count }} 条 / {{ detailEcho.totalHeat }} MWh
        <span :class="detailConsistent ? 'ok-text' : 'error-text'">
          {{ detailConsistent ? '· 核对一致' : '· 有出入，请重查' }}
        </span>
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in detail.items" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
          </tr>
        </tbody>
      </table>
    </aside>

    <footer class="page-foot">
      <span>共 {{ total }} 条热计量抄表记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  allMeterReadings,
  downloadEntries,
  filterRows,
  listMeterReadings,
  moduleMeta,
  runMeterAction,
  submitMeterReading,
} from '@/api/local-service'
import { PAGE_SIZE_OPTIONS, READING_METHODS, meterDetail, sumHeat } from '@/data/meter-readings'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('heatmeter')
const columns = ["抄表编号", "计量表号", "用户名称", "累计热量", "抄表方式", "抄表日期", "结算周期", "抄表状态"]
const actions = ["提交抄表", "确认核对", "标记异常"]
const statuses = ["待抄表", "抄表中", "已核对", "抄表异常"]
const filterFields = ["抄表编号", "计量表号", "用户名称", "结算周期"]
const readingMethods = READING_METHODS
const pageSizeOptions = PAGE_SIZE_OPTIONS

const formFields = [
  { key: '计量表号', label: '计量表号', type: 'text' },
  { key: '用户名称', label: '用户名称', type: 'text' },
  { key: '累计热量', label: '累计热量', type: 'number' },
  { key: '抄表方式', label: '抄表方式', type: 'text' },
  { key: '抄表日期', label: '抄表日期', type: 'date' },
  { key: '结算周期', label: '结算周期（YYYY-MM）', type: 'month' },
]

function blankForm(): Record<string, string> {
  return { 计量表号: '', 用户名称: '', 累计热量: '', 抄表方式: '', 抄表日期: '', 结算周期: '' }
}

const allRows = ref<EntryRow[]>([])
const rows = ref<EntryRow[]>([])
const filteredRows = ref<EntryRow[]>([])
const total = ref(0)
const totalHeat = ref(0)
const page = ref(1)
const pageCount = ref(1)
const pageInput = ref('1')
const pageSize = ref(5)
const filters = ref<Record<string, string>>({})
const errorMessage = ref('')
const noticeMessage = ref('')
const showForm = ref(false)
const form = ref<Record<string, string>>(blankForm())
const detailMeter = ref('')

// 统计卡与状态图例都从全量/筛选后的同一份数据算，不与翻页挂钩。
const stats = computed(() => [
  { label: '待抄表用户', value: allRows.value.filter((row) => row.status === '待抄表').length },
  { label: '已核对用户', value: allRows.value.filter((row) => row.status === '已核对').length },
  { label: '异常表数', value: allRows.value.filter((row) => row.abnormal).length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: filteredRows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 明细与列表同口径：都从 allRows 这一份数据里出，条数与累计热量才能对得上。
const detail = computed(() => (detailMeter.value ? meterDetail(allRows.value, detailMeter.value) : null))
const detailEcho = computed(() => {
  if (!detailMeter.value) {
    return { count: 0, totalHeat: 0 }
  }
  const matched = filterRows(allRows.value, { 计量表号: detailMeter.value })
  return { count: matched.length, totalHeat: sumHeat(matched) }
})
const detailConsistent = computed(
  () =>
    !!detail.value &&
    detail.value.count === detailEcho.value.count &&
    detail.value.totalHeat === detailEcho.value.totalHeat,
)

function toggleForm() {
  showForm.value = !showForm.value
}

function exportRows() {
  downloadEntries(meta.key)
}

function applyFilters() {
  pageInput.value = '1'
  reload()
}

function resetFilters() {
  filters.value = {}
  pageInput.value = '1'
  reload()
}

function goPage(target: number) {
  pageInput.value = String(target)
  reload()
}

function jumpPage() {
  reload()
}

function changeSize() {
  pageInput.value = '1'
  reload()
}

function submitForm() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = submitMeterReading(form.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  form.value = blankForm()
  showForm.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = runMeterAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value =
    action === '确认核对' || action === '标记异常'
      ? `${result.message}，核对结果已落到结算待复核清单`
      : result.message
  reload()
}

function openDetail(row: EntryRow) {
  detailMeter.value = String(row['计量表号'] ?? '')
}

function closeDetail() {
  detailMeter.value = ''
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listMeterReadings(filters.value, pageInput.value, pageSize.value)
    if (!payload.ok) {
      // 页码缺失或越界：挡下这次翻页，页面保持当前数据不动。
      errorMessage.value = payload.message
      return
    }
    allRows.value = allMeterReadings()
    rows.value = payload.items
    filteredRows.value = payload.filtered
    total.value = payload.total
    totalHeat.value = payload.totalHeat
    page.value = payload.page
    pageCount.value = payload.pageCount
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '热计量抄表列表读取失败'
  }
}

onMounted(reload)
</script>
