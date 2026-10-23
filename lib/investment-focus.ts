import { fmtAmount, fmtPct } from "@/lib/format";
import { liveRule } from "@/lib/live-config";
import { coverageRows, seed } from "@/lib/seed";
import type { Asset, FixedAssetProject } from "@/lib/types";

/**
 * 重大投资项目只认已有属性：项目类型为基地设施、码头设施或大型装备，
 * 或已经形成重大资产。不用金额门槛，也不把全部在管项目标成重大。
 */
const MAJOR_PROJECT_TYPES = new Set(["基地设施", "码头设施", "大型装备"]);

export const MAJOR_PROJECT_CALIBER =
  "重大投资项目按已有属性认定：项目类型为基地设施、码头设施或大型装备，或已形成重大资产。其余项目不标记为重大，可切换查看。指标汇总值仍按全部适用对象的分子、分母计算，不把总部指标分摊到项目，也不对项目比例直接相加。";

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
  return genericObjectFacts(objectIds);
}

function overBudgetFacts(objectIds: string[]): string {
  const projects = objectIds.map(projectOf).filter((item): item is FixedAssetProject => Boolean(item));
  if (projects.length === 0) return "当前场景没有可关联的投资项目，不估算超概金额。";
  return projects
    .map((project) => {
      if (project.eac === undefined || project.eac === null) {
        return `${project.name}：有效概算 ${money(project.effective_approved_budget)}，预计完工投资未记录`;
      }
      const gap = project.eac - project.effective_approved_budget;
      const rate = project.effective_approved_budget ? (gap / project.effective_approved_budget) * 100 : null;
      return `${project.name}：有效概算 ${money(project.effective_approved_budget)}，预计完工投资 ${money(project.eac)}，预计超概 ${gap > 0 ? money(gap) : "未超概"}，偏差率 ${rate === null ? "—" : fmtPct(rate)}`;
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
        parts.push(`计划进度 ${fmtPct(project.planned_progress_pct, 0)}，实际进度 ${fmtPct(project.actual_progress_pct, 0)}，偏差 ${gap} 个百分点`);
      } else {
        parts.push("计划或实际进度未记录");
      }
      if (project.approved_completion && project.forecast_completion) {
        const days = Math.round((Date.parse(project.forecast_completion) - Date.parse(project.approved_completion)) / 86400000);
        parts.push(`批准完工 ${project.approved_completion}，预测完工 ${project.forecast_completion}，偏差 ${days} 天`);
      } else {
        parts.push("里程碑计划日或预测日未记录");
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

function genericObjectFacts(objectIds: string[]): string | null {
  const projects = objectIds.map(projectOf).filter((item): item is FixedAssetProject => Boolean(item));
  if (projects.length === 0) return null;
  const withPlan = projects.filter((project) => project.ytd_plan !== undefined || project.eac !== undefined);
  if (withPlan.length === 0) return null;
  return withPlan
    .slice(0, 3)
    .map((project) => {
      const bits = [project.name, project.phase];
      if (project.ytd_plan !== undefined) bits.push(`同期计划 ${money(project.ytd_plan)}，完成 ${money(project.ytd_completed_investment)}`);
      if (project.eac !== undefined) bits.push(`预计完工 ${money(project.eac)}`);
      return bits.join("，");
    })
    .join("；");
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
};

function fieldLabel(key: string): string | null {
  return FIELD_LABELS[key] ?? null;
}

function formatFieldValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
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
