import { fmtAmount, fmtPct } from "@/lib/format";
import { liveRule } from "@/lib/live-config";
import { coverageRows, seed } from "@/lib/seed";
import type { Asset, FixedAssetProject } from "@/lib/types";

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
        if (gap < 10) parts.push("未达到底稿中待确认的 10 个百分点触发线，不按该条件记为命中");
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
