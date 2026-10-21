import { coverageById } from "./config";
import { coverageRows, phaseName, seed } from "./seed";
import { getLiveConfig, isScenarioMonitoringActive, liveSub } from "./live-config";
import {
  isOpen,
  isOverdueRectification,
  isRectifiedClosedInPeriod,
  riskMatches,
} from "./risks";
import type { DomainId, MonitoringRow, RiskCase } from "./types";
import { canonicalRightsStage, isOfficialFpSub, scenarioFitsBehavior } from "./fp-topics";
import { isEquityInvestmentOnlyCase, isRetiredScenarioId, isRetiredSupervisionDomain } from "./supervision-scope";

export interface ScopeFilter {
  domain: DomainId;
  orgScope: Set<string>;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  phaseId?: string | null;
  topicId?: string | null;
  subtopicId?: string | null;
  scenarioId?: string | null;
  /** 产权交易选定的经济行为；全部或不适用时为空 */
  behaviorId?: string | null;
  /** null/缺省=组织范围内全部对象；空数组=无对象权限 */
  allowedObjectIds?: string[] | null;
}

/**
 * 观察归属：按业务窗口结束日 window_end 落入所选期间（含端点），
 * 且评估取得时间不晚于截至日；季度/滚动窗口不按重叠月份分摊（完整业需 5.3）。
 */
export function isCoverageCandidate(row: MonitoringRow): boolean {
  const proj = coverageById.get(row.id);
  if (!proj) return false;
  return proj.record_kind === "coverage_candidate" || proj.include_in_default_monitoring_table === false;
}

export function scenarioHasPendingApplicability(scenarioId: string): boolean {
  return [...coverageById.values()].some(
    (p) => p.scenario_id === scenarioId && p.record_kind === "coverage_candidate",
  );
}

export function rowInScope(row: MonitoringRow, f: ScopeFilter): boolean {
  // 未确认适用性的覆盖规划候选不进入业务清单与应评估分母；传入 scenarioId 也不能重新纳入。
  if (isCoverageCandidate(row)) return false;
  if (row.domain !== f.domain) return false;
  if (isRetiredScenarioId(row.scenario_id) && !isRetiredSupervisionDomain(f.domain)) return false;
  if (!f.orgScope.has(row.owner_org_id)) return false;
  if (row.window_end < f.periodStart || row.window_end > f.periodEnd) return false;
  if (row.snapshot_date > f.asOf) return false;
  if (f.phaseId && row.phase_id !== f.phaseId) return false;
  if (f.topicId && row.topic_id !== f.topicId) return false;
  if (f.subtopicId !== undefined && f.subtopicId !== null && row.subtopic_id !== f.subtopicId)
    return false;
  if (f.scenarioId && row.scenario_id !== f.scenarioId) return false;
  if (!scenarioFitsBehavior(row.scenario_id, f.behaviorId)) return false;
  if (f.allowedObjectIds !== undefined && f.allowedObjectIds !== null) {
    if (!f.allowedObjectIds.includes(row.monitoring_object_id)) return false;
  }
  if (!isScenarioMonitoringActive(row.scenario_id)) return false;
  return true;
}

export function selectRows(f: ScopeFilter): MonitoringRow[] {
  return coverageRows.filter((r) => rowInScope(r, f));
}

const objKey = (r: MonitoringRow) => `${r.object_type}::${r.monitoring_object_id}`;

export interface ObjectRef {
  objectType: string;
  objectId: string;
}

export interface FiveCounts {
  /** 已实际评估至少一条适用规则或已完成人工核查的唯一对象 */
  monitoredObjects: ObjectRef[];
  /** 应评估（required 且非不适用/仅参考）的唯一对象 */
  requiredObjects: ObjectRef[];
  /** 当前观察期有效命中或人工明确线索的唯一对象 */
  hitObjects: ObjectRef[];
  /** 截至日仍未关闭且未排除的唯一 risk_id */
  openRiskIds: string[];
  /** 所选期间复核通过关闭、截至日仍 closed 且 close_reason=rectified */
  rectifiedClosedRiskIds: string[];
  /** 已进入整改责任范围、截至日仍未关闭且超过有效整改期限 */
  overdueRiskIds: string[];
  /** 数据不足/未到时点/不适用/参考的行数，用于覆盖说明 */
  gapCounts: Record<string, number>;
  /** 部分覆盖：已监测 < 应监测 */
  partialCoverage: boolean;
  rows: MonitoringRow[];
  objectTypeBreakdown: Record<string, { monitored: number; required: number; hit: number }>;
}

function dedupe(rows: MonitoringRow[]): ObjectRef[] {
  const map = new Map<string, ObjectRef>();
  for (const r of rows) {
    map.set(objKey(r), { objectType: r.object_type, objectId: r.monitoring_object_id });
  }
  return [...map.values()];
}

/**
 * 五数计算。对象数按 object_type+object_id 去重，事项数按 risk_id 去重，
 * 两者不混用（完整业需 5.3 / AGENTS.md）。
 */
export function computeFiveCounts(f: ScopeFilter, risks: RiskCase[]): FiveCounts {
  const rows = selectRows(f);

  const monitoredRows = rows.filter(
    (r) => r.status === "evaluated_hit" || r.status === "evaluated_clear",
  );
  const requiredRows = rows.filter((r) => {
    const proj = coverageById.get(r.id);
    if (proj && proj.include_in_required_denominator === false) return false;
    return r.required && r.status !== "not_applicable" && r.status !== "reference_only";
  });
  const hitRows = rows.filter((r) => r.status === "evaluated_hit");

  const monitoredObjects = dedupe(monitoredRows);
  const requiredObjects = dedupe(requiredRows);
  const hitObjects = dedupe(hitRows);

  const gapCounts: Record<string, number> = {};
  for (const r of rows) gapCounts[r.status] = (gapCounts[r.status] ?? 0) + 1;

  // 事项：既取所选监测行上的 risk_ids，也取 risk_context_links 的实际关联，
  // 保证历史遗留事项（本期无评估）仍然可见（完整业需 5.3 “历史遗留”）。
  const riskIdsFromRows = new Set<string>();
  for (const r of rows) r.risk_ids.forEach((id) => riskIdsFromRows.add(id));

  const linkFilter = {
    domain: f.domain,
    orgScope: f.orgScope,
    phaseId: f.phaseId ?? null,
    topicId: f.topicId ?? null,
    subtopicId: f.subtopicId ?? null,
  };

  const candidates = new Set<string>(riskIdsFromRows);
  for (const r of risks) {
    if (f.scenarioId && !r.scenario_ids.includes(f.scenarioId)) continue;
    if (f.behaviorId && !r.scenario_ids.some((sid) => scenarioFitsBehavior(sid, f.behaviorId))) continue;
    if (!isRetiredSupervisionDomain(f.domain) && isEquityInvestmentOnlyCase(r)) continue;
    if (riskMatches(r, linkFilter)) candidates.add(r.id);
  }

  const byId = new Map(risks.map((r) => [r.id, r]));
  const openRiskIds: string[] = [];
  const rectifiedClosedRiskIds: string[] = [];
  const overdueRiskIds: string[] = [];

  for (const id of candidates) {
    const r = byId.get(id);
    if (!r) continue;
    if (!f.orgScope.has(r.owner_org_id)) continue;
    if (!isRetiredSupervisionDomain(f.domain) && isEquityInvestmentOnlyCase(r)) continue;
    if (f.allowedObjectIds !== undefined && f.allowedObjectIds !== null && !f.allowedObjectIds.includes(r.primary_object_id)) continue;
    if (f.scenarioId && !r.scenario_ids.includes(f.scenarioId)) continue;
    if (isOpen(r)) {
      openRiskIds.push(id);
      if (isOverdueRectification(r, f.asOf)) overdueRiskIds.push(id);
    }
    if (isRectifiedClosedInPeriod(r, f.periodStart, f.periodEnd, f.asOf)) {
      rectifiedClosedRiskIds.push(id);
    }
  }

  const objectTypeBreakdown: Record<string, { monitored: number; required: number; hit: number }> = {};
  const bump = (t: string, key: "monitored" | "required" | "hit") => {
    objectTypeBreakdown[t] ??= { monitored: 0, required: 0, hit: 0 };
    objectTypeBreakdown[t][key] += 1;
  };
  monitoredObjects.forEach((o) => bump(o.objectType, "monitored"));
  requiredObjects.forEach((o) => bump(o.objectType, "required"));
  hitObjects.forEach((o) => bump(o.objectType, "hit"));

  return {
    monitoredObjects,
    requiredObjects,
    hitObjects,
    openRiskIds: openRiskIds.sort(),
    rectifiedClosedRiskIds: rectifiedClosedRiskIds.sort(),
    overdueRiskIds: overdueRiskIds.sort(),
    gapCounts,
    partialCoverage: monitoredObjects.length < requiredObjects.length,
    rows,
    objectTypeBreakdown,
  };
}

/** 阶段箭头上的未关闭事项数：按该阶段实际关联的 risk_id 去重。 */
export function openCountForPhase(
  domain: DomainId,
  phaseId: string,
  orgScope: Set<string>,
  risks: RiskCase[],
  asOf: string,
): { open: number; maxSeverity: "red" | "yellow" | null; riskIds: string[] } {
  void asOf;
  const ids: string[] = [];
  let maxSeverity: "red" | "yellow" | null = null;
  for (const r of risks) {
    if (!isOpen(r)) continue;
    if (!isRetiredSupervisionDomain(domain) && isEquityInvestmentOnlyCase(r)) continue;
    if (!riskMatches(r, { domain, orgScope, phaseId })) continue;
    ids.push(r.id);
    if (r.severity === "red") maxSeverity = "red";
    else if (maxSeverity !== "red") maxSeverity = "yellow";
  }
  return { open: ids.length, maxSeverity, riskIds: ids.sort() };
}

export function openCountForTopic(
  domain: DomainId,
  topicId: string,
  orgScope: Set<string>,
  risks: RiskCase[],
): { open: number; maxSeverity: "red" | "yellow" | null; riskIds: string[] } {
  const ids: string[] = [];
  let maxSeverity: "red" | "yellow" | null = null;
  for (const r of risks) {
    if (!isOpen(r)) continue;
    if (!isRetiredSupervisionDomain(domain) && isEquityInvestmentOnlyCase(r)) continue;
    if (!riskMatches(r, { domain, orgScope, topicId })) continue;
    ids.push(r.id);
    if (r.severity === "red") maxSeverity = "red";
    else if (maxSeverity !== "red") maxSeverity = "yellow";
  }
  return { open: ids.length, maxSeverity, riskIds: ids.sort() };
}

/** 领域未关闭事项数（不按阶段/专题细分）。 */
export function openCountForDomain(
  domain: DomainId,
  orgScope: Set<string>,
  risks: RiskCase[],
): { open: number; red: number; yellow: number; riskIds: string[] } {
  const ids: string[] = [];
  let red = 0;
  let yellow = 0;
  for (const r of risks) {
    if (!isOpen(r)) continue;
    if (!isRetiredSupervisionDomain(domain) && isEquityInvestmentOnlyCase(r)) continue;
    if (!riskMatches(r, { domain, orgScope })) continue;
    ids.push(r.id);
    if (r.severity === "red") red += 1;
    else yellow += 1;
  }
  return { open: ids.length, red, yellow, riskIds: ids.sort() };
}

/** 领域内本期出现过监测行的场景清单（含仅有覆盖候选的场景）。 */
export function scenariosInScope(f: ScopeFilter): string[] {
  const rows = selectRows({ ...f, scenarioId: null });
  const set = new Set<string>();
  rows.forEach((r) => set.add(r.scenario_id));
  return [...set].sort();
}

function scenarioBelongsToTopic(
  scenarioId: string,
  topicId: string | null | undefined,
  rowTopic: string | null | undefined,
): boolean {
  if (!topicId) return true;
  const live = getLiveConfig().subs.get(scenarioId);
  const routes = live?.conditional_routes ?? [];
  if (rowTopic === topicId || live?.topic_id === topicId || routes.includes(topicId)) return true;
  if (rowTopic && rowTopic !== topicId) return false;
  if (!rowTopic) {
    const mapped = live?.topic_id;
    if (mapped && mapped !== topicId) return false;
    if (!mapped && !routes.includes(topicId)) return false;
  }
  return true;
}

/** 业务执行表默认只收录已启用且适用当前环节/专题的场景。停用项由历史未关闭事项另行挂入。 */
export function configuredScenarios(domain: DomainId, phaseId?: string | null, topicId?: string | null): string[] {
  const live = getLiveConfig();
  const set = new Set<string>();
  for (const row of coverageRows) {
    if (row.domain !== domain) continue;
    if (isRetiredScenarioId(row.scenario_id)) continue;
    if (phaseId && row.phase_id !== phaseId) continue;
    if (!scenarioBelongsToTopic(row.scenario_id, topicId, row.topic_id)) continue;
    if (!isScenarioMonitoringActive(row.scenario_id)) continue;
    set.add(row.scenario_id);
  }
  if (!phaseId && !topicId) {
    for (const s of seed.supplemental_scenarios) {
      if (s.domain === domain && isScenarioMonitoringActive(s.id)) set.add(s.id);
    }
  }
  for (const extra of live.extraScenarios) {
    if (extra.domain !== domain) continue;
    if (phaseId && extra.primary_phase_id && extra.primary_phase_id !== phaseId) continue;
    if (topicId) {
      const sub = live.subs.get(extra.id);
      const routes = sub?.conditional_routes ?? [];
      if (sub?.topic_id && sub.topic_id !== topicId && !routes.includes(topicId)) continue;
      if (extra.enabled === false && !set.has(extra.id)) continue;
    }
    if (extra.enabled || set.has(extra.id)) set.add(extra.id);
  }
  for (const s of live.subs.values()) {
    if (s.domain !== domain) continue;
    if (topicId && s.topic_id !== topicId && !(s.conditional_routes ?? []).includes(topicId)) continue;
    if (phaseId) {
      const subStage = canonicalRightsStage(s.primary_phase_id) ?? s.primary_phase_id;
      const selectedStage = canonicalRightsStage(phaseName(phaseId)) ?? canonicalRightsStage(phaseId) ?? phaseId;
      if (s.primary_phase_id && subStage !== selectedStage && s.primary_phase_id !== phaseId) continue;
    }
    if (!isScenarioMonitoringActive(s.id)) continue;
    if (s.runtime_capability === "definition_only" && s.status === "draft") continue;
    set.add(s.id);
  }
  return [...set].sort();
}

export function scopedObjectCount(
  domain: DomainId,
  orgScope: Set<string>,
  allowedObjectIds: string[] | null | undefined,
  objectTypes?: string[],
): number {
  const allow = (id: string, orgId: string) => {
    if (!orgScope.has(orgId)) return false;
    if (allowedObjectIds !== undefined && allowedObjectIds !== null && !allowedObjectIds.includes(id)) return false;
    return true;
  };
  const want = objectTypes && objectTypes.length ? new Set(objectTypes) : null;
  const match = (type: string) => !want || want.has(type);
  let n = 0;
  if (match("fixed_asset_project") && (domain === "FA" || !want)) {
    n += seed.fixed_asset_projects.filter((p) => allow(p.id, p.owner_org_id)).length;
  }
  if (match("asset") && domain === "FA") n += seed.assets.filter((a) => allow(a.id, a.owner_org_id)).length;
  if (match("equity_project") && domain === "EQ") n += seed.equity_projects.filter((p) => allow(p.id, p.owner_org_id)).length;
  if (match("engineering_project") && (domain === "ENG" || domain === "INTL")) {
    n += seed.engineering_projects.filter((p) => allow(p.id, p.owner_org_id)).length;
  }
  if (match("account") && domain === "CASH") n += seed.accounts.filter((a) => allow(a.id, a.owner_org_id)).length;
  if (match("property_matter") && domain === "RIGHTS") n += seed.property_matters.filter((m) => allow(m.id, m.owner_org_id)).length;
  return n;
}

export interface ScenarioRuntimeStatus {
  code:
    | "pending_applicability"
    | "pending_eval"
    | "unevaluated_missing"
    | "no_business"
    | "hit_zero"
    | "hit"
    | "partial_hit"
    | "partial"
    | "manual"
    | "not_due"
    | "not_applicable"
    | "definition_only"
    | "not_yet_monitoring"
    | "no_runtime";
  label: string;
  tone: "red" | "amber" | "green" | "neutral";
  missingFields: string[];
}

/**
 * 摘要、清单、详情共用的监测状态。
 * 无覆盖实例时按适用性、对象、必要字段区分，不统一写成无业务。
 */
export function scenarioRuntimeStatus(
  scenarioId: string,
  rows: MonitoringRow[],
  ctx: {
    domain: DomainId;
    orgScope: Set<string>;
    allowedObjectIds?: string[] | null;
  },
): ScenarioRuntimeStatus {
  const sub = liveSub(scenarioId);
  const pendingByCatalog = sub?.applicability === "pending";
  const pendingByCoverage = scenarioHasPendingApplicability(scenarioId);
  const inactive = !isScenarioMonitoringActive(scenarioId);

  if (inactive && rows.length === 0) {
    const cap = sub?.runtime_capability;
    const executable = cap === "structured_executable" || cap === "assisted_review" || cap === "professional_review";
    const enabled = sub?.enabled === true && sub.status !== "disabled" && sub.status !== "retired";
    if (!enabled) {
      return { code: "definition_only", label: "未启用", tone: "neutral", missingFields: [] };
    }
    if (!executable) {
      return { code: "no_runtime", label: "未具备运行条件", tone: "neutral", missingFields: [] };
    }
    if (isOfficialFpSub(scenarioId)) {
      return { code: "not_yet_monitoring", label: "未开展监测", tone: "neutral", missingFields: [] };
    }
  }

  if (pendingByCatalog) {
    return { code: "pending_applicability", label: "待确认适用性", tone: "neutral", missingFields: [] };
  }

  if (rows.length === 0) {
    if (pendingByCoverage) {
      return { code: "pending_applicability", label: "待确认适用性", tone: "neutral", missingFields: [] };
    }
    const missing = (sub?.required_fields ?? []).map((s) => s.trim()).filter(Boolean);
    if (missing.length) {
      return {
        code: "unevaluated_missing",
        label: `未评估（缺 ${missing.join("、")}）`,
        tone: "amber",
        missingFields: missing,
      };
    }
    const n = scopedObjectCount(ctx.domain, ctx.orgScope, ctx.allowedObjectIds, sub?.object_types);
    if (n === 0) return { code: "no_business", label: "无业务", tone: "neutral", missingFields: [] };
    if (sub?.execution_mode === "professional_review_support") {
      return { code: "manual", label: "待评估", tone: "neutral", missingFields: [] };
    }
    return { code: "pending_eval", label: "待评估", tone: "neutral", missingFields: [] };
  }

  const evaluated = rows.filter((r) => r.status === "evaluated_hit" || r.status === "evaluated_clear");
  const hit = rows.filter((r) => r.status === "evaluated_hit");
  const insufficient = rows.filter((r) => r.status === "data_insufficient");
  const notDue = rows.filter((r) => r.status === "not_due");
  const reference = rows.filter((r) => r.status === "reference_only");
  const applicable = rows.filter((r) => r.status !== "not_applicable");
  const missing = [...new Set(rows.flatMap((r) => r.missing_data ?? []))].filter(Boolean);

  if (applicable.length === 0) return { code: "not_applicable", label: "不适用", tone: "neutral", missingFields: [] };
  if (insufficient.length > 0 && evaluated.length === 0) {
    return {
      code: "unevaluated_missing",
      label: missing.length ? `未评估（缺 ${missing.join("、")}）` : "未评估",
      tone: "amber",
      missingFields: missing,
    };
  }
  if (hit.length > 0 && evaluated.length < applicable.length) {
    return { code: "partial_hit", label: "部分完成·已有命中", tone: "red", missingFields: missing };
  }
  if (hit.length > 0) return { code: "hit", label: "已完成监测·有命中", tone: "red", missingFields: missing };
  if (reference.length === applicable.length) return { code: "manual", label: "核查中", tone: "neutral", missingFields: [] };
  if (notDue.length === applicable.length) return { code: "not_due", label: "待评估", tone: "neutral", missingFields: [] };
  if (evaluated.length === 0) return { code: "pending_eval", label: "待评估", tone: "neutral", missingFields: missing };
  if (evaluated.length < applicable.length) return { code: "partial", label: "部分完成", tone: "amber", missingFields: missing };
  return { code: "hit_zero", label: "命中数为0", tone: "green", missingFields: [] };
}
