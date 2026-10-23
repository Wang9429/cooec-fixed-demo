import { daysBetween, fmtAmount, fmtPct, fmtSignedPct } from "@/lib/format";
import { liveRule, liveRules, liveSub } from "@/lib/live-config";
import { isCoverageCandidate } from "@/lib/monitoring";
import { orgName } from "@/lib/org";
import { coverageRows, objectTypeLabel, phaseName, scenarioAdoption, seed } from "@/lib/seed";
import type { Asset, FixedAssetProject, RuleEvaluation } from "@/lib/types";

/**
 * 重大投资项目只认已有属性：项目类型为基地设施、码头设施或大型装备，
 * 或已经形成重大资产。不用金额门槛，也不把全部在管项目标成重大。
 */
const MAJOR_PROJECT_TYPES = new Set(["基地设施", "码头设施", "大型装备"]);

export const FOCUS_PROJECT_LABEL = "重点投资项目（演示分类）";

export const MAJOR_PROJECT_CALIBER =
  "项目台账没有正式重大项目标识。当前筛选用演示分类：项目类型为基地设施、码头设施或大型装备，或已形成重大资产。这不是正式重大项目认定，其余项目仍可查看。指标汇总值按全部适用对象的分子、分母计算。";

export function isMajorInvestmentProject(project: FixedAssetProject): boolean {
  if (MAJOR_PROJECT_TYPES.has(project.project_type)) return true;
  return seed.assets.some(
    (asset) => asset.is_major && (asset.source_project_id === project.id || project.asset_ids?.includes(asset.id)),
  );
}

export function majorProjectIds(): Set<string> {
  return new Set(seed.fixed_asset_projects.filter(isMajorInvestmentProject).map((project) => project.id));
}

function projectOf(id: string): FixedAssetProject | undefined {
  return seed.fixed_asset_projects.find((project) => project.id === id);
}

function assetOf(id: string): Asset | undefined {
  return seed.assets.find((asset) => asset.id === id);
}

function money(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : `${fmtAmount(value)} 万元`;
}

/** 覆盖候选只用于展示台账字段，不进入应评估分母或命中对象。 */
export function ledgerObjectIdsForScenario(scenarioId: string, orgIds: Set<string>, allowed?: string[] | null): string[] {
  const ids: string[] = [];
  for (const row of coverageRows) {
    if (row.scenario_id !== scenarioId || !orgIds.has(row.owner_org_id)) continue;
    if (allowed && !allowed.includes(row.monitoring_object_id)) continue;
    if (!ids.includes(row.monitoring_object_id)) ids.push(row.monitoring_object_id);
  }
  return ids;
}

/** 按子场景稳定 ID 取关键业务数据。没有对应字段时说明缺口，不补示例数。 */
export function faScenarioFacts(
  scenarioId: string,
  objectIds: string[],
  asOf: string,
  orgIds?: Set<string>,
  allowed?: string[] | null,
): string | null {
  if (scenarioId === "FA-S21" && objectIds.length === 0 && orgIds) {
    return progressFacts(ledgerObjectIdsForScenario(scenarioId, orgIds, allowed), true);
  }
  if (scenarioId === "FA-S20") return overBudgetFacts(objectIds);
  if (scenarioId === "FA-S21") return progressFacts(objectIds, false);
  if (scenarioId === "FA-S29") return utilizationFacts(objectIds);
  if (scenarioId === "FA-S26" || scenarioId === "FA-S27" || scenarioId === "FA-S28") return postEvaluationFacts(objectIds, asOf);
  if (scenarioId === "FA-S19") return changeFacts(objectIds, orgIds);
  if (scenarioId === "FA-S34") return fundsLinkFacts(objectIds, orgIds);
  if (scenarioId === "FA-S30") return idleAssetFacts(orgIds);
  if (scenarioId === "FA-S35") return impairmentFacts(orgIds);
  if (scenarioId === "FA-S32" || scenarioId === "FA-S33") return titleFacts(orgIds);
  if (scenarioId === "FA-X01") return transferFacts(orgIds);
  return SCENARIO_GAPS[scenarioId] ?? "本场景没有可汇总的业务监测值，规则未执行。";
}

function transferFacts(orgIds?: Set<string>): string {
  const projects = scopedProjects([], orgIds).filter(
    (project) => project.acceptance_date || project.ready_for_use_date || project.capitalization_date,
  );
  if (projects.length === 0) return "当前范围没有验收、达到可使用状态或转固日期，规则未执行。";
  return projects
    .map(
      (project) =>
        `${project.name}：验收 ${project.acceptance_date ?? "未记录"}，达到可使用状态 ${project.ready_for_use_date ?? "未记录"}，转固 ${project.capitalization_date ?? "未记录"}`,
    )
    .join("；");
}

function scopedProjects(objectIds: string[], orgIds?: Set<string>): FixedAssetProject[] {
  const listed = objectIds.map(projectOf).filter((item): item is FixedAssetProject => Boolean(item));
  if (listed.length > 0) return listed;
  if (!orgIds) return [];
  return seed.fixed_asset_projects.filter((project) => orgIds.has(project.owner_org_id));
}

function scopedAssets(orgIds?: Set<string>): Asset[] {
  if (!orgIds) return [];
  return seed.assets.filter((asset) => orgIds.has(asset.owner_org_id));
}

function changeFacts(objectIds: string[], orgIds?: Set<string>): string {
  const lines = scopedProjects(objectIds, orgIds).flatMap((project) => {
    const changes = seed.cost_items.filter((item) => item.project_id === project.id && item.category.includes("变更"));
    if (changes.length === 0) return [];
    const text = changes.map((item) => `${item.category} ${money(item.amount)}`).join("、");
    return [`${project.name}：${text}。没有变更审批结论，不把该金额计为未批变更。`];
  });
  return lines.length > 0 ? lines.join("；") : "当前范围没有已记录的设计变更金额，也没有变更审批记录，规则未执行。";
}

function fundsLinkFacts(objectIds: string[], orgIds?: Set<string>): string {
  const projects = scopedProjects(objectIds, orgIds).filter(
    (project) => project.ytd_plan !== undefined || project.funds_plan_ytd !== undefined || project.cash_paid_ytd !== undefined,
  );
  if (projects.length === 0) return "当前范围没有投资计划、完成投资和资金支付的对照记录，规则未执行。";
  return projects
    .slice(0, 4)
    .map(
      (project) =>
        `${project.name}：同期计划 ${money(project.ytd_plan)}，完成投资 ${money(project.ytd_completed_investment)}，资金计划 ${money(project.funds_plan_ytd)}，资金支付 ${money(project.cash_paid_ytd)}。完成投资与资金支付分开统计。`,
    )
    .join("；");
}

function idleAssetFacts(orgIds?: Set<string>): string {
  const idle = scopedAssets(orgIds).filter((asset) => asset.formally_idle);
  if (idle.length === 0) return "当前范围没有已标记为闲置的资产。低利用率不直接写成闲置或未盘活。";
  return idle.map((asset) => `${asset.name}：已标记闲置，净值 ${money(asset.net_book_value)}`).join("；");
}

function impairmentFacts(orgIds?: Set<string>): string {
  const impaired = scopedAssets(orgIds).filter((asset) => asset.impairment_allowance > 0);
  if (impaired.length === 0) return "当前范围没有已记录的资产减值准备，也没有减值测试结论，不写成已发生减值。";
  return impaired.map((asset) => `${asset.name}：减值准备 ${money(asset.impairment_allowance)}`).join("；");
}

function titleFacts(orgIds?: Set<string>): string {
  const pending = scopedAssets(orgIds).filter((asset) => asset.registration_required);
  if (pending.length === 0) return "当前范围没有权属或境外登记待办记录，规则未执行。";
  return pending.map((asset) => `${asset.name}：登记待办，净值 ${money(asset.net_book_value)}`).join("；");
}

const SCENARIO_GAPS: Record<string, string> = {
  "FA-S02": "台账没有可研或需求分析报告的审批记录，规则未执行。",
  "FA-S03": "台账没有收益测算与业务需求的对照结果，规则未执行。",
  "FA-S04": "没有投资需求与存量资产利用的对照记录。资产利用率不直接写成需求不匹配。",
  "FA-S05": "台账没有概算审查意见，规则未执行。",
  "FA-S06": "台账没有概算编制依据的完整性记录，规则未执行。",
  "FA-S07": "台账没有中介独立性或利益冲突核查记录，规则未执行。",
  "FA-S08": "台账没有论证基础数据的核验记录，规则未执行。",
  "FA-S09": "台账没有重大投资风险清单及动态跟踪记录，规则未执行。",
  "FA-S10": "台账没有 1000 万元以下项目的报备记录，规则未执行。",
  "FA-S11": "台账没有“未批先建”的程序记录，规则未执行。",
  "FA-S12": "台账没有授权额度与审批权限的对照记录，规则未执行。",
  "FA-S13": "台账没有同一事项拆分审批的识别记录，规则未执行。",
  "FA-S14": "台账没有长线合同提前采购的识别记录，规则未执行。",
  "FA-S15": "台账没有招标方式与应招范围的对照记录，规则未执行。",
  "FA-S16": "台账没有围标、串标或关联供应商的核查记录，规则未执行。",
  "FA-S17": "台账没有内部人员与投标人关联或接触的申报记录，规则未执行。",
  "FA-S18": "台账没有供应商资质有效期记录，规则未执行。",
  "FA-S22": "台账没有同类项目成本对照，规则未执行。",
  "FA-S23": "台账没有投资环境变化与项目价值的对照，规则未执行。",
  "FA-S24": "台账没有应备案项目的备案状态，规则未执行。",
  "FA-S25": "台账没有投资准入规则的版本和更新日期，规则未执行。",
};

function budgetVersion(project: FixedAssetProject): string {
  if (project.original_approved_budget === undefined) return `当前有效概算 ${money(project.effective_approved_budget)}`;
  if (project.original_approved_budget === project.effective_approved_budget) {
    return `当前有效概算 ${money(project.effective_approved_budget)}，与原始批准概算一致`;
  }
  return `原始批准概算 ${money(project.original_approved_budget)}，当前有效概算 ${money(project.effective_approved_budget)}`;
}

function compositionNote(project: FixedAssetProject): string {
  const items = seed.cost_items.filter((item) => item.project_id === project.id);
  if (items.length === 0 || project.eac === undefined || project.eac === null) return "";
  const sum = items.reduce((total, item) => total + item.amount, 0);
  const parts = items.map((item) => `${item.category} ${money(item.amount)}`).join("、");
  const match = sum === project.eac ? "合计与预计完工投资一致" : `合计 ${money(sum)}，与预计完工投资相差 ${money(project.eac - sum)}`;
  return `构成 ${parts}，${match}，各项不重复加总。`;
}

function overBudgetFacts(objectIds: string[]): string {
  const projects = objectIds.map(projectOf).filter((item): item is FixedAssetProject => Boolean(item));
  if (projects.length === 0) return "当前场景没有可关联的投资项目，不估算超概金额。";
  return projects
    .map((project) => {
      if (project.eac === undefined || project.eac === null) {
        return `${project.name}：${budgetVersion(project)}，预计完工投资未记录，不能计算超概金额。`;
      }
      const gap = project.eac - project.effective_approved_budget;
      const rate = project.effective_approved_budget ? (gap / project.effective_approved_budget) * 100 : null;
      const head = `${project.name}：${budgetVersion(project)}，预计完工投资 ${money(project.eac)}，预计超概 ${gap > 0 ? money(gap) : "未超概"}，偏差率 ${rate === null ? "—" : fmtPct(rate)}。`;
      return `${head}${compositionNote(project)}`;
    })
    .join("；");
}

function progressFacts(objectIds: string[], fromLedger: boolean): string {
  const projects = objectIds.map(projectOf).filter((item): item is FixedAssetProject => Boolean(item));
  if (projects.length === 0) return "当前场景没有可关联的投资项目，不计算进度偏差。";
  const body = projects
    .map((project) => {
      const parts = [project.name];
      if (project.planned_progress_pct !== undefined && project.actual_progress_pct !== undefined) {
        const gap = project.planned_progress_pct - project.actual_progress_pct;
        parts.push(`基准计划进度 ${fmtPct(project.planned_progress_pct, 0)}，实际进度 ${fmtPct(project.actual_progress_pct, 0)}，落后 ${gap} 个百分点`);
      } else {
        parts.push("基准计划进度或实际进度未记录");
      }
      if (project.approved_completion && project.forecast_completion) {
        const days = Math.round((Date.parse(project.forecast_completion) - Date.parse(project.approved_completion)) / 86400000);
        parts.push(
          `批准完工 ${project.approved_completion}，预测完工 ${project.forecast_completion}，偏差 ${days} 天。台账没有其他关键里程碑延期记录`,
        );
      } else {
        parts.push("关键里程碑的计划日或预测日未记录");
      }
      return parts.join("，");
    })
    .join("；");
  return fromLedger ? `本期没有已确认的进度规则执行记录。以下取自项目台账，未计为规则命中。${body}` : body;
}

function utilizationFacts(objectIds: string[]): string {
  const assets = objectIds.map(assetOf).filter((item): item is Asset => Boolean(item));
  if (assets.length === 0) return "当前场景没有可关联的资产，不计算利用率。";
  const majors = assets.filter((asset) => asset.is_major);
  const base = majors.length ? majors : assets;
  const net = base.reduce((sum, asset) => sum + asset.net_book_value, 0);
  const low = base.filter((asset) => asset.low_utilization_confirmed).reduce((sum, asset) => sum + asset.net_book_value, 0);
  const ratio = net > 0 ? fmtPct((low / net) * 100) : "—";
  const lines = assets.map((asset) => {
    const latest = asset.quarterly_utilization_history.at(-1);
    const project = projectOf(asset.source_project_id);
    const rate = latest ? `${latest.period} ${fmtPct(latest.actual_pct, 0)}` : "季度利用率未记录";
    return `${asset.name}：利用率 ${rate}（阈值 ${asset.utilization_threshold_pct}%），净值 ${money(asset.net_book_value)}，来源项目 ${project?.name ?? asset.source_project_id}`;
  });
  return `本场景已关联资产的已确认低利用率净值占比 ${ratio}（${money(low)} / ${money(net)}），按这些资产的净值重新计算。${lines.join("；")}`;
}

function postEvaluationFacts(objectIds: string[], asOf: string): string {
  const fromRows = objectIds.map(projectOf).filter((item): item is FixedAssetProject => Boolean(item));
  const projects = fromRows.length ? fromRows : [];
  if (projects.length === 0) {
    return "当前场景没有后评价监测对象。台账未记录后评价完成日期，已完成数留空，仅有计划的项目不计入规则命中。";
  }
  const planned = projects.filter((project) => project.post_evaluation_due);
  const due = planned.filter((project) => project.post_evaluation_due && project.post_evaluation_due <= asOf);
  return `监测对象 ${projects.length} 项，已登记后评价计划 ${planned.length} 项，计划日不晚于截至日 ${due.length} 项。台账未记录完成日期，已完成数留空。`;
}


const FIELD_LABELS: Record<string, string> = {
  attention_eac_ratio_gte: "关注阈值（预计完工投资/有效概算）",
  red_eac_ratio_gt: "高风险阈值（预计完工投资/有效概算）",
  source: "参数来源",
  eac: "预计完工投资",
  effective_approved_budget: "有效批准概算",
  forecast_complete: "预测数据完整",
  deviation_gt_pct: "偏差超过",
  last_two_completed_quarters: "最近两个完整季度利用率",
  threshold_pct: "适用阈值",
  confirmed: "已人工确认",
  period_type: "观察周期",
  consecutive_completed_periods_gte: "连续完整期数不低于",
  demo_asset_threshold_pct: "样例配置阈值",
  manual_confirmation_required: "需人工确认",
  note: "说明",
  actual_pct: "实际利用率",
  utilization_threshold_pct: "利用率阈值",
  low_utilization_confirmed: "低利用率已确认",
  eac_ratio: "偏差比",
  ratio: "偏差比",
  ytd_plan: "同期计划投资",
  ytd_completed_investment: "同期完成投资",
};

function fieldLabel(key: string): string | null {
  return FIELD_LABELS[key] ?? null;
}

function formatFieldValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (key === "last_two_completed_quarters" && Array.isArray(value)) {
    return value.map((item) => `${item}%`).join("、");
  }
  if (Array.isArray(value)) return value.map((item) => String(item)).join("、");
  if (key === "period_type" && value === "quarter") return "季度";
  if ((key === "attention_eac_ratio_gte" || key === "red_eac_ratio_gt") && typeof value === "number") {
    return fmtPct(value * 100, 0);
  }
  if ((key === "threshold_pct" || key === "demo_asset_threshold_pct" || key === "deviation_gt_pct") && typeof value === "number") {
    return `${value}%`;
  }
  return String(value);
}

const CALIBER_TOKENS: Record<string, string> = {
  effective_approved_budget: "有效批准概算",
  last_two_completed_quarters: "最近两个完整季度利用率",
  consecutive_completed_periods_gte: "连续完整期数",
  utilization_threshold_pct: "利用率阈值",
  forecast_complete: "预测是否完整",
  threshold_pct: "阈值",
  actual_pct: "实际利用率",
  eac_ratio: "偏差比",
  eac: "预计完工投资",
  ratio: "偏差比",
};

function humanizeCaliber(text: string): string {
  const tokens = Object.keys(CALIBER_TOKENS).sort((a, b) => b.length - a.length);
  return tokens.reduce((current, token) => current.split(token).join(CALIBER_TOKENS[token]), text);
}

export function ruleBasisLines(ruleId: string, objectIds: string[]): string[] {
  const rule = liveRule(ruleId);
  const lines: string[] = [];
  if (rule?.condition_description) lines.push(`监控口径：${humanizeCaliber(rule.condition_description)}`);
  const published = rule?.published?.parameters;
  const draft = rule?.draft_parameters;
  const params = published && Object.keys(published).length ? published : null;
  if (params) {
    const shown = Object.entries(params)
      .map(([key, value]) => {
        const label = fieldLabel(key);
        return label ? `${label} ${formatFieldValue(key, value)}` : null;
      })
      .filter((item): item is string => Boolean(item));
    lines.push(shown.length ? `有效参数：${shown.join("，")}` : "已发布参数当前没有可展示的业务名称。");
    if (ruleId === "FA-R20-01") {
      lines.push("已发布参数中的 95% 关注线保持原值。底稿里的这一边界尚待业务确认，本次不修改已发布规则，也不据此新增命中。");
    }
  } else if (draft && Object.keys(draft).length) {
    lines.push("当前没有已发布参数。草稿参数不作为本期执行依据。");
  } else {
    lines.push("当前规则没有可展示的已发布参数。");
  }
  const allowed = new Set(objectIds);
  const evals = seed.rule_evaluations.filter(
    (item) => item.rule_id === ruleId && (allowed.size === 0 || allowed.has(item.subject_object_id)),
  );
  if (evals.length === 0) {
    lines.push("本期没有落在本场景监测对象上的执行记录。");
    return lines;
  }
  for (const item of evals) {
    const project = seed.fixed_asset_projects.find((row) => row.id === item.subject_object_id);
    const asset = seed.assets.find((row) => row.id === item.subject_object_id);
    const name = project?.name ?? asset?.name ?? item.subject_object_id;
    if (ruleId === "FA-R20-01" && (item.inputs.eac === undefined || item.inputs.effective_approved_budget === undefined)) {
      lines.push(`${name}｜执行时间 ${item.evaluated_at}｜缺少预计完工投资或有效概算，不作为本规则命中。`);
      continue;
    }
    const inputs = Object.entries(item.inputs)
      .map(([key, value]) => {
        const label = fieldLabel(key);
        return label ? `${label} ${formatFieldValue(key, value)}` : null;
      })
      .filter((part): part is string => Boolean(part))
      .join("，");
    const result = item.effective_result === "hit" ? "命中" : item.effective_result === "clear" ? "未命中" : item.effective_result;
    lines.push(`${name}｜执行时间 ${item.evaluated_at}｜${result}｜${item.formula}｜触发数据 ${inputs}`);
  }
  return lines;
}

export interface ScenarioCaseRef {
  id: string;
  title: string;
  ruleId: string;
  objectId: string;
}

export interface MonitorMetric {
  label: string;
  value: string;
}

export interface MonitorCell {
  label: string;
  value: string;
  missing?: boolean;
}

export interface MonitorObject {
  id: string;
  name: string;
  orgName: string;
  cells: MonitorCell[];
  note: string | null;
  excluded: boolean;
  hit: boolean;
  riskIds: string[];
}

export interface MonitorExecution {
  objectId: string;
  objectName: string;
  evaluatedAt: string;
  conclusive: boolean;
  resultLabel: string;
  formula: string;
  inputs: MonitorCell[];
  riskIds: string[];
}

export interface MonitorRule {
  id: string;
  name: string;
  published: boolean;
  statusLabel: string;
  parameters: MonitorCell[];
  parameterNote: string | null;
  condition: string;
  evaluatedAt: string | null;
  requiredCount: number | null;
  evaluatedCount: number | null;
  executions: MonitorExecution[];
}

export interface MonitorSource {
  label: string;
  value: string;
}

export interface FaScenarioMonitor {
  scenarioId: string;
  phaseLabel: string;
  objectTypeLabel: string;
  applicableCount: number;
  coverageLabel: string;
  ruleStatusLabel: string;
  capabilityLabel: string;
  capabilityNote: string;
  latestDataDate: string | null;
  metrics: MonitorMetric[];
  gapPhrase: string | null;
  pendingConfig: boolean;
  hasCalculation: boolean;
  objects: MonitorObject[];
  rules: MonitorRule[];
  hitObjectIds: string[];
  directCaseIds: string[];
  otherCaseIds: string[];
  cases: ScenarioCaseRef[];
  sources: MonitorSource[];
  caliber: string;
  emptyRuleNote: string;
}

export interface FaMonitorQuery {
  scenarioId: string;
  phaseId?: string | null;
  asOf: string;
  periodStart: string;
  periodEnd: string;
  orgIds: Set<string>;
  allowed?: string[] | null;
  cases: ScenarioCaseRef[];
}

const SHORT_GAPS: Record<string, string> = {
  "FA-S22": "缺少同类成本对照数据",
  "FA-S31": "当前对象不适用",
  "FA-S33": "当前对象不适用",
};

export function monitorSummaryText(monitor: FaScenarioMonitor): string {
  if (monitor.metrics.length === 0) return monitor.gapPhrase ?? "尚不具备评估条件";
  return monitor.metrics
    .slice(0, 3)
    .map((item) => `${item.label} ${item.value}`)
    .join(" · ");
}

interface LinkedObject {
  id: string;
  coverageStatus: string | null;
  missingData: string[];
}

function objectOrg(id: string): string | undefined {
  return projectOf(id)?.owner_org_id ?? assetOf(id)?.owner_org_id;
}

function objectDisplayName(id: string): string {
  return projectOf(id)?.name ?? assetOf(id)?.name ?? id;
}

function linkedObjects(query: FaMonitorQuery, extraIds: string[]): LinkedObject[] {
  const map = new Map<string, LinkedObject>();
  for (const row of coverageRows) {
    if (row.scenario_id !== query.scenarioId) continue;
    if (query.phaseId && row.phase_id !== query.phaseId) continue;
    if (!query.orgIds.has(row.owner_org_id)) continue;
    if (query.allowed && !query.allowed.includes(row.monitoring_object_id)) continue;
    const candidate = isCoverageCandidate(row);
    const current = map.get(row.monitoring_object_id);
    if (!current) {
      map.set(row.monitoring_object_id, {
        id: row.monitoring_object_id,
        coverageStatus: row.status,
        missingData: row.missing_data ?? [],
      });
      continue;
    }
    if (candidate) continue;
    current.coverageStatus = row.status;
    current.missingData = row.missing_data ?? [];
  }
  for (const id of extraIds) {
    if (map.has(id)) continue;
    const orgId = objectOrg(id);
    if (!orgId || !query.orgIds.has(orgId)) continue;
    if (query.allowed && !query.allowed.includes(id)) continue;
    map.set(id, { id, coverageStatus: null, missingData: [] });
  }
  return [...map.values()];
}

function cell(label: string, value: string, missing = false): MonitorCell {
  return { label, value, missing };
}

function baseObject(id: string, cells: MonitorCell[], note: string | null, excluded: boolean): MonitorObject {
  return {
    id,
    name: objectDisplayName(id),
    orgName: orgName(objectOrg(id)),
    cells,
    note,
    excluded,
    hit: false,
    riskIds: [],
  };
}

function dayGap(from?: string, to?: string): string {
  if (!from || !to) return "未记录";
  return `${daysBetween(from, to)} 天`;
}

function remainingToComplete(project: FixedAssetProject): { text: string; missing: boolean; composition: string | null } {
  const items = seed.cost_items.filter((item) => item.project_id === project.id);
  const rest = items.filter((item) => item.category !== "实际已入账");
  if (rest.length > 0) {
    const sum = rest.reduce((total, item) => total + item.amount, 0);
    const parts = rest.map((item) => `${item.category} ${money(item.amount)}`).join("、");
    const aligned =
      project.eac === undefined || project.eac === null
        ? ""
        : sum + (items.find((item) => item.category === "实际已入账")?.amount ?? project.cumulative_completed_investment ?? 0) === project.eac
          ? "构成合计与预计完工投资一致。"
          : "";
    return { text: money(sum), missing: false, composition: `${parts}。${aligned}`.trim() };
  }
  if (project.eac !== undefined && project.eac !== null && project.cumulative_completed_investment !== undefined) {
    return { text: money(project.eac - project.cumulative_completed_investment), missing: false, composition: null };
  }
  return { text: "未记录", missing: true, composition: null };
}

function rateOf(project: FixedAssetProject): number | null {
  if (project.eac === undefined || project.eac === null || !project.effective_approved_budget) return null;
  return ((project.eac - project.effective_approved_budget) / project.effective_approved_budget) * 100;
}

function projectSources(projectId: string): { name: string; date: string; system: string }[] {
  const refs = new Set(seed.cost_items.filter((item) => item.project_id === projectId).map((item) => item.source_record_id));
  return seed.source_records
    .filter((record) => refs.has(record.id) || record.name.includes(projectId))
    .map((record) => ({ name: record.name, date: record.business_date, system: record.source_system_label }));
}

function maxIsoDate(values: (string | null | undefined)[]): string | null {
  const dates = values.filter((value): value is string => Boolean(value) && /^\d{4}-\d{2}-\d{2}/.test(value ?? ""));
  if (dates.length === 0) return null;
  return dates.map((value) => value.slice(0, 10)).sort().at(-1) ?? null;
}

function readableCondition(text: string): string {
  return humanizeCaliber(text).replaceAll("ratio", "偏差比").replaceAll(">=", "达到或超过").replaceAll(">", "超过");
}

function inputsOf(record: RuleEvaluation): MonitorCell[] {
  return Object.entries(record.inputs)
    .map(([key, value]) => {
      const label = fieldLabel(key);
      return label ? cell(label, formatFieldValue(key, value)) : null;
    })
    .filter((item): item is MonitorCell => Boolean(item));
}

function conclusiveEvaluation(ruleId: string, record: RuleEvaluation): boolean {
  if (ruleId === "FA-R20-01") {
    return typeof record.inputs.eac === "number" && typeof record.inputs.effective_approved_budget === "number";
  }
  if (ruleId === "FA-R29-01") {
    return Array.isArray(record.inputs.last_two_completed_quarters) && record.inputs.threshold_pct !== undefined;
  }
  return record.effective_result === "hit" || record.effective_result === "clear";
}

interface Presentation {
  metrics: MonitorMetric[];
  objects: MonitorObject[];
  caliber: string;
  gapPhrase: string | null;
  emptyRuleNote: string;
}

function excluded(link: LinkedObject): boolean {
  return link.coverageStatus === "not_applicable";
}

function presentOverBudget(links: LinkedObject[]): Presentation {
  const objects = links.flatMap((link) => {
    const project = projectOf(link.id);
    if (!project) return [];
    const out = excluded(link);
    const remaining = remainingToComplete(project);
    const rate = rateOf(project);
    const gap = project.eac === undefined || project.eac === null ? null : project.eac - project.effective_approved_budget;
    const note = out
      ? "已投用项目不纳入本期在建预计完工投资监测。"
      : project.eac === undefined || project.eac === null
        ? "缺少预计完工投资，不能计算偏差金额和偏差率。"
        : remaining.composition;
    return [
      baseObject(
        project.id,
        [
          cell("有效概算", money(project.effective_approved_budget)),
          cell("累计完成投资", project.cumulative_completed_investment === undefined ? "未记录" : money(project.cumulative_completed_investment), project.cumulative_completed_investment === undefined),
          cell("尚需投资", remaining.text, remaining.missing),
          cell("预计完工投资", project.eac === undefined || project.eac === null ? "未记录" : money(project.eac), project.eac === undefined || project.eac === null),
          cell("偏差金额", gap === null ? "不可计算" : money(gap), gap === null),
          cell("偏差率", rate === null ? "不可计算" : fmtSignedPct(rate), rate === null),
        ],
        note,
        out,
      ),
    ];
  });
  const rates = links
    .map((link) => projectOf(link.id))
    .filter((project): project is FixedAssetProject => Boolean(project))
    .filter((project) => !links.find((link) => link.id === project.id && excluded(link)))
    .map((project) => ({ project, rate: rateOf(project), gap: project.eac !== undefined && project.eac !== null ? project.eac - project.effective_approved_budget : null }))
    .filter((item) => item.rate !== null && item.gap !== null);
  const max = rates.reduce<{ rate: number; gap: number } | null>((best, item) => {
    if (item.rate === null || item.gap === null) return best;
    if (!best || item.rate > best.rate) return { rate: item.rate, gap: item.gap };
    return best;
  }, null);
  const over = rates.filter((item) => (item.gap ?? 0) > 0);
  const overAmount = over.reduce((sum, item) => sum + (item.gap ?? 0), 0);
  return {
    metrics:
      rates.length === 0
        ? []
        : [
            { label: "最大偏差率", value: max ? fmtSignedPct(max.rate) : "—" },
            { label: "预计超概", value: `${over.length} 项` },
            { label: "超概金额", value: money(overAmount) },
          ],
    objects,
    caliber: "偏差率＝（预计完工投资－当前有效概算）÷当前有效概算。预计完工投资＝累计完成投资＋完工尚需投资。尚需投资取成本构成中除实际已入账以外的部分，各项不重复加总。",
    gapPhrase: rates.length === 0 ? "尚不具备评估条件" : null,
    emptyRuleNote: "当前没有已发布规则，不能把未执行写成未发现异常。",
  };
}

function presentProgress(links: LinkedObject[]): Presentation {
  if (links.length === 0) return presentGap(links, "尚不具备评估条件");
  const objects = links.flatMap((link) => {
    const project = projectOf(link.id);
    if (!project) return [];
    const hasProgress = project.planned_progress_pct !== undefined && project.actual_progress_pct !== undefined;
    const gap = hasProgress ? project.planned_progress_pct! - project.actual_progress_pct! : null;
    const hasDates = Boolean(project.approved_completion && project.forecast_completion);
    const missing: string[] = [];
    if (project.planned_progress_pct === undefined) missing.push("计划进度");
    if (project.actual_progress_pct === undefined) missing.push("实际进度");
    if (!project.approved_completion || !project.forecast_completion) missing.push("完工计划或预计日期");
    const note = [
      missing.length ? `缺少${missing.join("、")}，对应指标不可计算。` : null,
      hasDates ? "台账只有批准完工与预测完工，没有分项关键里程碑。" : null,
    ]
      .filter(Boolean)
      .join("");
    return [
      baseObject(
        project.id,
        [
          cell("计划进度", project.planned_progress_pct === undefined ? "未记录" : fmtPct(project.planned_progress_pct, 0), project.planned_progress_pct === undefined),
          cell("实际进度", project.actual_progress_pct === undefined ? "未记录" : fmtPct(project.actual_progress_pct, 0), project.actual_progress_pct === undefined),
          cell("偏差", gap === null ? "不可计算" : `${gap} 个百分点`, gap === null),
          cell("批准完工", project.approved_completion ?? "未记录", !project.approved_completion),
          cell("预测完工", project.forecast_completion ?? "未记录", !project.forecast_completion),
          cell("日期偏差", hasDates ? dayGap(project.approved_completion, project.forecast_completion) : "不可计算", !hasDates),
        ],
        note || null,
        false,
      ),
    ];
  });
  const comparable = objects.filter((item) => item.cells.some((entry) => entry.label === "偏差" && !entry.missing));
  const lags = links
    .map((link) => projectOf(link.id))
    .filter((project): project is FixedAssetProject => Boolean(project && project.planned_progress_pct !== undefined && project.actual_progress_pct !== undefined))
    .map((project) => project.planned_progress_pct! - project.actual_progress_pct!);
  const missingCount = objects.length - comparable.length;
  return {
    metrics: [
      { label: "可比项目", value: String(comparable.length) },
      { label: "最大进度落后", value: lags.length ? `${Math.max(...lags)} 个百分点` : "—" },
      { label: "待补充数据", value: String(missingCount) },
    ],
    objects,
    caliber: "进度落后幅度＝基准计划进度－实际进度，以百分点计。日期偏差＝预测完工－批准完工。台账没有分项里程碑时，只比较批准完工与预测完工。",
    gapPhrase: null,
    emptyRuleNote: "当前没有已发布的进度规则和生效参数。底稿中的 10 个百分点阈值尚未发布，台账进度只展示业务事实，不形成命中或未命中结论。",
  };
}

function presentUtilization(links: LinkedObject[]): Presentation {
  const assets = links.flatMap((link) => {
    const asset = assetOf(link.id);
    return asset ? [asset] : [];
  });
  const majors = assets.filter((asset) => asset.is_major);
  if (assets.length === 0) return presentGap(links, "尚不具备评估条件");
  const low = majors.filter((asset) => asset.low_utilization_confirmed);
  const objects = assets.map((asset) => {
    const latest = asset.quarterly_utilization_history.at(-1);
    const project = projectOf(asset.source_project_id);
    return baseObject(
      asset.id,
      [
        cell("重大资产", asset.is_major ? "是" : "否"),
        cell("账面净值", money(asset.net_book_value)),
        cell("最近季度利用率", latest ? `${latest.period} ${fmtPct(latest.actual_pct, 0)}` : "未记录", !latest),
        cell("阈值", `${asset.utilization_threshold_pct}%`),
        cell("低利用率已确认", asset.low_utilization_confirmed ? "是" : "否"),
        cell("来源项目", project?.name ?? "未关联"),
      ],
      asset.low_utilization_confirmed ? null : "未确认低利用率，不计入低利用率净值。",
      false,
    );
  });
  return {
    metrics: [
      { label: "低利用率重大资产", value: `${low.length} 项` },
      { label: "账面净值", value: money(low.reduce((sum, asset) => sum + asset.net_book_value, 0)) },
      { label: "监测重大资产", value: `${majors.length} 项` },
    ],
    objects,
    caliber: "低利用率数量和净值只统计已人工确认的重大资产。未确认资产保留在明细中，不计入分子。这里的范围是本场景已关联资产，与首页指标的取数范围可能不同。",
    gapPhrase: assets.length === 0 ? "尚不具备评估条件" : null,
    emptyRuleNote: "当前没有已发布规则，不能把未执行写成未发现异常。",
  };
}

function postEvalDue(project: FixedAssetProject): boolean {
  return Boolean(project.post_evaluation_due || project.acceptance_date || project.ready_for_use_date);
}

function presentPostEvaluation(links: LinkedObject[], asOf: string): Presentation {
  const projects = links.flatMap((link) => {
    const project = projectOf(link.id);
    return project ? [project] : [];
  });
  if (projects.length === 0) return presentGap(links, "尚不具备评估条件");
  const due = projects.filter(postEvalDue);
  const overdue = projects.filter((project) => project.post_evaluation_due && project.post_evaluation_due <= asOf);
  const objects = projects.map((project) => {
    const started = postEvalDue(project);
    const late = Boolean(project.post_evaluation_due && project.post_evaluation_due <= asOf);
    return baseObject(
      project.id,
      [
        cell("应开展", started ? "是" : "否"),
        cell("后评价计划", project.post_evaluation_due ?? "未记录", !project.post_evaluation_due),
        cell("验收", project.acceptance_date ?? "未记录", !project.acceptance_date),
        cell("达到可使用状态", project.ready_for_use_date ?? "未记录", !project.ready_for_use_date),
        cell("转固", project.capitalization_date ?? "未记录", !project.capitalization_date),
        cell("完成日期", "未记录", true),
        cell("逾期", started ? (late ? "是" : "否") : "未到时点"),
      ],
      "台账没有后评价完成日期，已完成数不按 0 填列。",
      false,
    );
  });
  return {
    metrics: [
      { label: "应开展", value: `${due.length} 项` },
      { label: "已完成", value: "未记录" },
      { label: "逾期", value: `${overdue.length} 项` },
    ],
    objects,
    caliber: "应开展按已登记后评价计划，或已记录验收、达到可使用状态的项目计算。逾期只比较已登记计划日和截至日。台账没有完成日期，已完成保持为未记录。",
    gapPhrase: null,
    emptyRuleNote: "当前没有已发布的后评价规则。计划和日期只说明业务事实，不形成命中或未命中结论。",
  };
}

function presentChange(links: LinkedObject[]): Presentation {
  const rows = links.flatMap((link) => {
    const project = projectOf(link.id);
    if (!project) return [];
    const changes = seed.cost_items.filter((item) => item.project_id === project.id && item.category.includes("变更"));
    const amount = changes.reduce((sum, item) => sum + item.amount, 0);
    return [{ project, changes, amount }];
  });
  const recorded = rows.filter((item) => item.changes.length > 0);
  return {
    metrics: [
      { label: "已记录变更", value: `${recorded.length} 项` },
      { label: "变更金额", value: money(recorded.reduce((sum, item) => sum + item.amount, 0)) },
      { label: "审批结论", value: "未记录" },
    ],
    objects: rows.map((item) =>
      baseObject(
        item.project.id,
        [
          cell("变更金额", item.changes.length ? money(item.amount) : "未记录", item.changes.length === 0),
          cell("变更构成", item.changes.length ? item.changes.map((change) => change.category).join("、") : "未记录", item.changes.length === 0),
          cell("审批结论", "未记录", true),
        ],
        item.changes.length ? "已记录变更金额。没有审批结论，不把该金额计为未批变更。" : "没有已记录的设计变更金额。",
        false,
      ),
    ),
    caliber: "变更金额只汇总成本构成中类别含“变更”的记录。没有审批结论时不判断程序是否履行。",
    gapPhrase: null,
    emptyRuleNote: "当前没有已发布规则，不能把未执行写成未发现异常。",
  };
}

function presentFunds(links: LinkedObject[]): Presentation {
  const projects = links.flatMap((link) => {
    const project = projectOf(link.id);
    return project ? [project] : [];
  });
  const comparable = projects.filter((project) => project.ytd_completed_investment !== undefined || project.cash_paid_ytd !== undefined);
  const completed = comparable.reduce((sum, project) => sum + (project.ytd_completed_investment ?? 0), 0);
  const paid = comparable.reduce((sum, project) => sum + (project.cash_paid_ytd ?? 0), 0);
  return {
    metrics:
      comparable.length === 0
        ? []
        : [
            { label: "有对照项目", value: `${comparable.length} 项` },
            { label: "完成投资", value: money(completed) },
            { label: "资金支付", value: money(paid) },
          ],
    objects: projects.map((project) =>
      baseObject(
        project.id,
        [
          cell("同期计划", project.ytd_plan === undefined ? "未记录" : money(project.ytd_plan), project.ytd_plan === undefined),
          cell("完成投资", project.ytd_completed_investment === undefined ? "未记录" : money(project.ytd_completed_investment), project.ytd_completed_investment === undefined),
          cell("资金计划", project.funds_plan_ytd === undefined ? "未记录" : money(project.funds_plan_ytd), project.funds_plan_ytd === undefined),
          cell("资金支付", project.cash_paid_ytd === undefined ? "未记录" : money(project.cash_paid_ytd), project.cash_paid_ytd === undefined),
        ],
        "完成投资与资金支付分开统计，不换算成投资计划执行率。",
        false,
      ),
    ),
    caliber: "本场景汇总已关联项目的同期完成投资和资金支付。缺任一字段的项目仍保留，并标明未记录。这不是首页投资计划执行率。",
    gapPhrase: comparable.length === 0 ? "尚不具备评估条件" : null,
    emptyRuleNote: "当前没有已发布规则，不能把未执行写成未发现异常。",
  };
}

function presentAssets(links: LinkedObject[], kind: "idle" | "impairment" | "title"): Presentation {
  const assets = links.flatMap((link) => {
    const asset = assetOf(link.id);
    return asset ? [asset] : [];
  });
  if (assets.length === 0) {
    return presentGap(links, "本环节没有可核对的资产台账");
  }
  if (kind === "idle") {
    const idle = assets.filter((asset) => asset.formally_idle);
    return {
      metrics: [
        { label: "已标记闲置", value: `${idle.length} 项` },
        { label: "监测资产", value: `${assets.length} 项` },
      ],
      objects: assets.map((asset) =>
        baseObject(asset.id, [cell("已标记闲置", asset.formally_idle ? "是" : "否"), cell("账面净值", money(asset.net_book_value))], asset.formally_idle ? null : "未标记闲置。低利用率不直接写成闲置。", false),
      ),
      caliber: "只认资产台账中的闲置标记。没有该标记时不计为闲置，也不据此给出规则结论。",
      gapPhrase: null,
      emptyRuleNote: "当前没有已发布规则。闲置标记只说明台账事实，不形成命中或未命中结论。",
    };
  }
  if (kind === "impairment") {
    const impaired = assets.filter((asset) => asset.impairment_allowance > 0);
    return {
      metrics: [
        { label: "已记录减值准备", value: `${impaired.length} 项` },
        { label: "减值准备合计", value: money(assets.reduce((sum, asset) => sum + asset.impairment_allowance, 0)) },
        { label: "监测资产", value: `${assets.length} 项` },
      ],
      objects: assets.map((asset) =>
        baseObject(asset.id, [cell("减值准备", money(asset.impairment_allowance)), cell("账面净值", money(asset.net_book_value))], asset.impairment_allowance > 0 ? null : "台账减值准备为 0，没有减值测试结论。", false),
      ),
      caliber: "减值准备取资产台账已记录金额。金额为 0 只表示台账没有减值准备，不表示已经完成减值测试。",
      gapPhrase: null,
      emptyRuleNote: "当前没有已发布规则，不能把未执行写成未发现异常。",
    };
  }
  const pending = assets.filter((asset) => asset.registration_required);
  return {
    metrics: [
      { label: "登记待办", value: `${pending.length} 项` },
      { label: "监测资产", value: `${assets.length} 项` },
    ],
    objects: assets.map((asset) =>
      baseObject(asset.id, [cell("登记待办", asset.registration_required ? "是" : "否"), cell("账面净值", money(asset.net_book_value))], asset.registration_required ? null : "台账未标记登记待办。", false),
    ),
    caliber: "登记待办只统计资产台账中的待办标记，不推断权属已经清晰。",
    gapPhrase: null,
    emptyRuleNote: "当前没有已发布规则，不能把未执行写成未发现异常。",
  };
}

function presentTransfer(links: LinkedObject[]): Presentation {
  const projects = links.flatMap((link) => {
    const project = projectOf(link.id);
    return project ? [project] : [];
  });
  const recorded = projects.filter((project) => project.acceptance_date || project.ready_for_use_date || project.capitalization_date);
  return {
    metrics:
      projects.length === 0
        ? []
        : [
            { label: "已记录衔接日期", value: `${recorded.length} 项` },
            { label: "日期未记录", value: `${projects.length - recorded.length} 项` },
          ],
    objects: projects.map((project) =>
      baseObject(
        project.id,
        [
          cell("验收", project.acceptance_date ?? "未记录", !project.acceptance_date),
          cell("达到可使用状态", project.ready_for_use_date ?? "未记录", !project.ready_for_use_date),
          cell("转固", project.capitalization_date ?? "未记录", !project.capitalization_date),
        ],
        project.acceptance_date || project.ready_for_use_date || project.capitalization_date ? null : "验收、达到可使用状态和转固日期都未记录。",
        false,
      ),
    ),
    caliber: "验收、达到可使用状态和转固日期分开显示。转固记账日不替代验收日。",
    gapPhrase: projects.length === 0 ? "尚不具备评估条件" : null,
    emptyRuleNote: "当前没有已发布规则，不能把未执行写成未发现异常。",
  };
}

function presentGap(links: LinkedObject[], phrase: string): Presentation {
  const objects = links.flatMap((link) => {
    const project = projectOf(link.id);
    if (project) {
      const out = excluded(link);
      return [
        baseObject(
          project.id,
          [
            cell("项目类型", project.project_type),
            cell("有效概算", money(project.effective_approved_budget)),
            cell("待补充", out ? "不适用" : phrase, !out),
          ],
          out ? "当前对象不适用本场景。" : phrase,
          out,
        ),
      ];
    }
    const asset = assetOf(link.id);
    if (!asset) return [];
    const out = excluded(link);
    return [
      baseObject(
        asset.id,
        [cell("账面净值", money(asset.net_book_value)), cell("待补充", out ? "不适用" : phrase, !out)],
        out ? "当前对象不适用本场景。" : phrase,
        out,
      ),
    ];
  });
  const allExcluded = links.length > 0 && links.every(excluded);
  return {
    metrics: [],
    objects,
    caliber: allExcluded ? "关联对象均标记为不适用，没有可计算的监控值。" : "缺少形成判断所需的业务记录。已有台账事实仍列出，缺失字段不补 0。",
    gapPhrase: allExcluded ? "当前对象不适用" : phrase,
    emptyRuleNote: "当前没有已发布规则，不能把未执行写成命中 0 或未发现异常。",
  };
}

function present(scenarioId: string, links: LinkedObject[], asOf: string): Presentation {
  const allExcluded = links.length > 0 && links.every(excluded);
  if (allExcluded && scenarioId !== "FA-S20") return presentGap(links, SHORT_GAPS[scenarioId] ?? "当前对象不适用");
  if (scenarioId === "FA-S20") return presentOverBudget(links);
  if (scenarioId === "FA-S21") return presentProgress(links);
  if (scenarioId === "FA-S29") return presentUtilization(links);
  if (scenarioId === "FA-S26") return presentPostEvaluation(links, asOf);
  if (scenarioId === "FA-S19") return presentChange(links);
  if (scenarioId === "FA-S34") return presentFunds(links);
  if (scenarioId === "FA-S30") return presentAssets(links, "idle");
  if (scenarioId === "FA-S35") return presentAssets(links, "impairment");
  if (scenarioId === "FA-S32") return presentAssets(links, "title");
  if (scenarioId === "FA-X01") return presentTransfer(links);
  return presentGap(links, SHORT_GAPS[scenarioId] ?? "尚不具备评估条件");
}

function publishedParameters(ruleId: string): { cells: MonitorCell[]; note: string | null } {
  const rule = liveRule(ruleId);
  const params = rule?.published?.parameters;
  if (!params || Object.keys(params).length === 0) return { cells: [], note: null };
  const cells = Object.entries(params)
    .map(([key, value]) => {
      const label = fieldLabel(key);
      return label ? cell(label, formatFieldValue(key, value)) : null;
    })
    .filter((item): item is MonitorCell => Boolean(item));
  const note =
    ruleId === "FA-R20-01"
      ? "已发布参数中的 95% 关注线保持原值。该边界尚待业务确认，本次不修改已发布规则，也不据此新增命中。"
      : null;
  return { cells, note };
}

function buildRules(scenarioId: string, links: LinkedObject[], orgIds: Set<string>, allowed?: string[] | null): MonitorRule[] {
  const rules = liveRules()
    .filter((rule) => rule.primary_subscenario_id === scenarioId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const applicable = links.filter((link) => !excluded(link));
  return rules.map((rule) => {
    const published = Boolean(rule.published) && rule.status === "published" && rule.enabled !== false;
    const evaluations = seed.rule_evaluations.filter((item) => {
      if (item.rule_id !== rule.id) return false;
      const orgId = objectOrg(item.subject_object_id);
      if (!orgId || !orgIds.has(orgId)) return false;
      if (allowed && !allowed.includes(item.subject_object_id)) return false;
      return true;
    });
    const executions: MonitorExecution[] = evaluations.map((item) => {
      const ok = published && conclusiveEvaluation(rule.id, item);
      const hit = ok && item.effective_result === "hit";
      return {
        objectId: item.subject_object_id,
        objectName: objectDisplayName(item.subject_object_id),
        evaluatedAt: item.evaluated_at,
        conclusive: ok,
        resultLabel: !published ? "未发布，未执行" : ok ? (hit ? "命中" : "未命中") : "缺少计算输入，未形成结论",
        formula: ok ? item.formula : "缺少规则所需输入，本次不形成命中或未命中结论。",
        inputs: inputsOf(item),
        riskIds: hit ? item.risk_ids : [],
      };
    });
    const conclusive = executions.filter((item) => item.conclusive);
    const hits = conclusive.filter((item) => item.resultLabel === "命中");
    let statusLabel = "未配置正式规则";
    if (!published) statusLabel = rule.published ? "未启用" : "草稿未发布，未执行";
    else if (hits.length > 0) statusLabel = "已执行并命中";
    else if (conclusive.length > 0) statusLabel = "已执行，未命中";
    else if (executions.length > 0) statusLabel = "已记录执行，未形成结论";
    else statusLabel = "已配置，本期未执行";
    const params = published ? publishedParameters(rule.id) : { cells: [], note: "没有已发布参数。草稿参数不作为本期执行依据。" };
    return {
      id: rule.id,
      name: rule.name,
      published,
      statusLabel,
      parameters: params.cells,
      parameterNote: params.note,
      condition: rule.condition_description ? readableCondition(rule.condition_description) : "当前规则没有可展示的监控口径。",
      evaluatedAt: executions.map((item) => item.evaluatedAt).sort().at(-1) ?? null,
      requiredCount: published ? applicable.length : null,
      evaluatedCount: published ? new Set(conclusive.map((item) => item.objectId)).size : null,
      executions,
    };
  });
}

function capabilityOf(scenarioId: string): { label: string; note: string } {
  const adoption = scenarioAdoption(scenarioId);
  const mode = liveSub(scenarioId)?.execution_mode;
  const modeText =
    mode === "structured_automatic"
      ? "目录执行方式为结构化识别"
      : mode === "rule_ai_human"
        ? "目录执行方式为线索识别后人工复核"
        : mode === "professional_review_support"
          ? "目录执行方式为专业核查支撑"
          : "目录未标明已发布的执行方式";
  return {
    label: adoption,
    note: `${modeText}。目录能力不代表本期已经配置并执行规则。`,
  };
}

export function faScenarioMonitor(query: FaMonitorQuery): FaScenarioMonitor {
  const ruleIds = new Set(
    liveRules()
      .filter((rule) => rule.primary_subscenario_id === query.scenarioId && rule.published && rule.status === "published" && rule.enabled !== false)
      .map((rule) => rule.id),
  );
  const extraIds = [
    ...seed.rule_evaluations.filter((item) => ruleIds.has(item.rule_id)).map((item) => item.subject_object_id),
    ...query.cases.map((item) => item.objectId),
  ];
  const links = linkedObjects(query, extraIds);
  const view = present(query.scenarioId, links, query.asOf);
  const rules = buildRules(query.scenarioId, links, query.orgIds, query.allowed);
  const hitObjectIds = [...new Set(rules.flatMap((rule) => rule.executions.filter((item) => item.resultLabel === "命中").map((item) => item.objectId)))];
  const directCaseIds = query.cases.filter((item) => ruleIds.has(item.ruleId)).map((item) => item.id);
  const otherCaseIds = query.cases.filter((item) => !ruleIds.has(item.ruleId)).map((item) => item.id);
  const caseByObject = new Map<string, string[]>();
  for (const item of query.cases) {
    const list = caseByObject.get(item.objectId) ?? [];
    list.push(item.id);
    caseByObject.set(item.objectId, list);
  }
  for (const object of view.objects) {
    object.hit = hitObjectIds.includes(object.id);
    object.riskIds = caseByObject.get(object.id) ?? [];
  }
  view.objects.sort((a, b) => Number(b.hit) - Number(a.hit) || a.id.localeCompare(b.id));
  const published = rules.filter((rule) => rule.published);
  let ruleStatusLabel = "未配置正式规则";
  if (published.some((rule) => rule.statusLabel === "已执行并命中")) ruleStatusLabel = "已执行并命中";
  else if (published.some((rule) => rule.statusLabel === "已执行，未命中")) ruleStatusLabel = "已执行，未命中";
  else if (published.some((rule) => rule.statusLabel === "已记录执行，未形成结论")) ruleStatusLabel = "已记录执行，未形成结论";
  else if (published.length > 0) ruleStatusLabel = "已配置，本期未执行";
  const hasCalculation = rules.some((rule) => rule.executions.some((item) => item.conclusive));
  const executed = published.some((rule) => rule.executions.length > 0);
  const pendingConfig = view.metrics.length === 0 && !executed && directCaseIds.length === 0 && otherCaseIds.length === 0;
  const sourceScenarios = new Set(["FA-S20", "FA-S19", "FA-S34"]);
  const sourceRows = sourceScenarios.has(query.scenarioId) ? links.flatMap((link) => projectSources(link.id)) : [];
  const ledgerDates = ["FA-S26", "FA-X01"].includes(query.scenarioId)
    ? links.flatMap((link) => {
        const project = projectOf(link.id);
        if (!project) return [];
        return [project.acceptance_date, project.ready_for_use_date, project.capitalization_date].filter(
          (value): value is string => Boolean(value) && value <= query.asOf,
        );
      })
    : [];
  const latestDataDate = maxIsoDate([
    ...sourceRows.map((item) => item.date),
    ...rules.flatMap((rule) => rule.executions.map((item) => item.evaluatedAt)),
    ...links.map((link) => assetOf(link.id)?.confirmation_date),
    ...ledgerDates,
  ]);
  const types = liveSub(query.scenarioId)?.object_types ?? [];
  const applicableCount = view.objects.filter((item) => !item.excluded).length;
  const coverageLabel = executed
    ? `已形成结论 ${rules.reduce((sum, rule) => sum + (rule.evaluatedCount ?? 0), 0)} / 适用 ${applicableCount}`
    : applicableCount > 0
      ? `已关联对象 ${applicableCount}，正式规则未执行`
      : "当前范围没有关联对象";
  const capability = capabilityOf(query.scenarioId);
  const sources: MonitorSource[] = [
    { label: "统计期间", value: `${query.periodStart} 至 ${query.periodEnd}` },
    { label: "截至日", value: query.asOf },
    {
      label: "数据记录",
      value: sourceRows.length
        ? sourceRows.map((item) => `${item.name}（${item.system}，${item.date}）`).join("；")
        : "当前没有单独的来源单据，字段来自项目或资产台账。",
    },
    { label: "计算口径", value: view.caliber },
  ];
  return {
    scenarioId: query.scenarioId,
    phaseLabel: phaseName(query.phaseId || liveSub(query.scenarioId)?.primary_phase_id),
    objectTypeLabel: types.map((type) => objectTypeLabel[type] ?? type).join("、") || "—",
    applicableCount,
    coverageLabel,
    ruleStatusLabel,
    capabilityLabel: capability.label,
    capabilityNote: capability.note,
    latestDataDate,
    metrics: view.metrics.slice(0, 3),
    gapPhrase: view.gapPhrase,
    pendingConfig,
    hasCalculation,
    objects: view.objects,
    rules,
    hitObjectIds,
    directCaseIds,
    otherCaseIds,
    cases: query.cases,
    sources,
    caliber: view.caliber,
    emptyRuleNote: view.emptyRuleNote,
  };
}
