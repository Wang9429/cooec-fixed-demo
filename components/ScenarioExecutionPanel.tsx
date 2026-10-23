"use client";

import React, { useMemo, useState } from "react";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  LinkButton,
  Modal,
  Notice,
  SeverityTag,
  SimulatedBadge,
  Tag,
} from "@/components/ui";
import {
  computeFiveCounts,
  configuredScenarios,
  scenarioRuntimeStatus,
  selectRows,
  type FiveCounts,
  type ScopeFilter,
} from "@/lib/monitoring";
import { isScenarioMonitoringActive, liveRule, liveRules, liveSub, hasEffectiveExecutableRule } from "@/lib/live-config";
import {
  objectTypeLabel,
  phaseName,
  scenarioAdoption,
  scenarioName,
  scenarioSourceLabel,
} from "@/lib/seed";
import { orgName } from "@/lib/org";
import { objectName } from "@/lib/objects";
import { isOverdueRectification, rectificationDueDate, riskMatches, snapshotRisksAtAsOf, statusLabel } from "@/lib/risks";
import { daysBetween, fmtDate } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { useDemoStore } from "@/lib/store";
import type { DomainId, MonitoringRow, RiskCase } from "@/lib/types";
import { officialDirectory, scopedDirectory } from "@/lib/fp-directory";
import { scenarioFitsBehavior } from "@/lib/fp-topics";
import { faScenarioFacts, ruleBasisLines } from "@/lib/investment-focus";
import { monitoringNoteLabel, objectTitle, riskTitleOf, ruleDisplayName } from "@/lib/fp-display";

/**
 * 环节/专题选中后的执行情况（完整业需 5.3、5.4）。
 * 五项摘要分别标“观察期/截至日/本期闭环”，对象数与事项数不混用计数单位。
 */

export interface SubtopicOption {
  id: string;
  label: string;
  note: string;
}

type DetailKind = "monitored" | "hit" | "open" | "closed" | "overdue" | "pending" | "rules" | "units";

const DETAIL_TITLE: Record<DetailKind, string> = {
  monitored: "监测对象清单（观察期）",
  hit: "命中对象清单（观察期）",
  open: "未关闭事项清单（截至日）",
  closed: "本期已整改闭环事项",
  overdue: "逾期整改事项（截至日）",
  pending: "待核查事项",
  rules: "命中规则清单",
  units: "涉及单位清单",
};

interface ScenarioRow {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  adoption: string;
  rows: MonitoringRow[];
  counts: FiveCounts;
  statusLabelText: string;
  statusTone: "red" | "amber" | "green" | "neutral";
  monitoringActive: boolean;
  redOpen: number;
  objectTypes: string[];
  hitRuleCount: number;
}

interface RuleLine {
  id: string;
  name: string;
  statusLabel: string;
  statusTone: "red" | "amber" | "green" | "neutral";
  required: number | null;
  evaluated: number | null;
  hitObjects: { objectId: string; objectType: string }[];
  openCases: RiskCase[];
}

function ruleLinesFor(row: ScenarioRow, openCases: RiskCase[]): RuleLine[] {
  const ids = new Set<string>();
  for (const rule of liveRules()) {
    if (rule.primary_subscenario_id === row.id) ids.add(rule.id);
  }
  for (const record of row.rows) {
    for (const id of record.rule_ids) ids.add(id);
  }
  return [...ids].sort().map((id) => {
    const meta = liveRule(id);
    const related = row.rows.filter((record) => record.rule_ids.includes(id));
    const statuses = new Set(related.map((record) => record.status));
    let statusLabel = "未执行";
    let statusTone: RuleLine["statusTone"] = "neutral";
    if (related.length === 0) {
      if (row.statusLabelText.includes("未具备") || row.statusLabelText.includes("不具备")) {
        statusLabel = "不具备运行条件";
      } else if (row.statusLabelText === "未启用" || row.statusLabelText === "未开展监测" || row.statusLabelText.startsWith("未评估")) {
        statusLabel = row.statusLabelText.startsWith("未评估") ? "未执行" : row.statusLabelText;
      }
    } else if (statuses.has("evaluated_hit")) {
      statusLabel = "命中";
      statusTone = "red";
    } else if ([...statuses].every((status) => status === "evaluated_clear")) {
      statusLabel = "未命中";
      statusTone = "green";
    } else if (statuses.has("data_insufficient")) {
      statusLabel = "不具备运行条件";
      statusTone = "amber";
    } else if ([...statuses].every((status) => status === "not_applicable")) {
      statusLabel = "不适用";
    } else if (statuses.has("not_due")) {
      statusLabel = "尚未到核查时点";
    } else if (statuses.has("reference_only")) {
      statusLabel = "待专业核查";
      statusTone = "amber";
    } else if (statuses.has("evaluated_clear")) {
      statusLabel = "未命中";
      statusTone = "green";
    }
    const unique = (records: MonitoringRow[]) => {
      const map = new Map<string, { objectId: string; objectType: string }>();
      for (const record of records) {
        map.set(record.monitoring_object_id, { objectId: record.monitoring_object_id, objectType: record.object_type });
      }
      return [...map.values()];
    };
    const required = related.length
      ? unique(related.filter((record) => record.required && record.status !== "not_applicable" && record.status !== "reference_only")).length
      : null;
    const evaluated = related.length
      ? unique(related.filter((record) => record.status === "evaluated_hit" || record.status === "evaluated_clear")).length
      : null;
    return {
      id,
      name: meta?.name ?? id,
      statusLabel,
      statusTone,
      required,
      evaluated,
      hitObjects: unique(related.filter((record) => record.status === "evaluated_hit")),
      openCases: openCases.filter((item) => item.rule_id === id),
    };
  });
}

export interface TopicChipOption {
  id: string;
  label: string;
  testId?: string;
}

export default function ScenarioExecutionPanel({
  domain,
  phaseId,
  topicId,
  subtopicId,
  orgIds,
  allowedObjectIds,
  scopeTitle,
  subtopicOptions,
  onSubtopicChange,
  onOpenRisk,
  onOpenObject,
  onOpenScenario,
  ledger,
  directoryDomain,
  topicOptions,
  onTopicChange,
  topicNavTestId,
  allTopicTestId,
  allTopicLabel,
  toolbarExtra,
  behaviorId,
  expandRules,
}: {
  domain: DomainId;
  phaseId?: string | null;
  topicId?: string | null;
  subtopicId?: string | null;
  orgIds: Set<string>;
  allowedObjectIds: string[] | null;
  scopeTitle: string;
  subtopicOptions?: SubtopicOption[];
  onSubtopicChange?: (id: string) => void;
  onOpenRisk: (id: string) => void;
  onOpenObject?: (id: string) => void;
  onOpenScenario?: (id: string, source?: boolean) => void;
  ledger?: React.ReactNode;
  /** 资金/产权下半区按官方一级目录展示，不从命中或已启用项反向生成 */
  directoryDomain?: "CASH" | "RIGHTS";
  topicOptions?: TopicChipOption[];
  onTopicChange?: (id: string | null) => void;
  topicNavTestId?: string;
  allTopicTestId?: string;
  allTopicLabel?: string;
  toolbarExtra?: React.ReactNode;
  behaviorId?: string | null;
  /** 投资管理总览展开到规则、命中对象和未关闭事项，不影响其他领域。 */
  expandRules?: boolean;
}) {
  const { filters, risks, actions, canAct, catalog } = useDemoStore();
  const [detail, setDetail] = useState<{ kind: DetailKind; scenarioId: string | null } | null>(null);
  const [search, setSearch] = useState("");
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [objectTypeFilter, setObjectTypeFilter] = useState("all");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [ruleBasisId, setRuleBasisId] = useState<string | null>(null);

  const baseScope: ScopeFilter = useMemo(
    () => ({
      domain,
      orgScope: orgIds,
      periodStart: filters.periodStart,
      periodEnd: filters.periodEnd,
      asOf: filters.asOf,
      phaseId: phaseId ?? null,
      topicId: topicId ?? null,
      subtopicId: subtopicId ?? null,
      behaviorId: behaviorId ?? null,
      allowedObjectIds,
    }),
    [domain, orgIds, filters.periodStart, filters.periodEnd, filters.asOf, phaseId, topicId, subtopicId, behaviorId, allowedObjectIds],
  );

  const asOfRisks = useMemo(
    () => snapshotRisksAtAsOf(risks, filters.asOf, actions),
    [risks, filters.asOf, actions],
  );

  const summary = useMemo(() => computeFiveCounts(baseScope, asOfRisks), [baseScope, asOfRisks]);

  const scenarioRows: ScenarioRow[] = useMemo(() => {
    const catalogMode = directoryDomain === "CASH" || directoryDomain === "RIGHTS";
    const dir = catalogMode
      ? scopedDirectory(directoryDomain, topicId ?? null, phaseId ?? null, phaseId ? phaseName(phaseId) : null)
      : null;
    const ids = catalogMode
      ? dir!.flatMap((g) => g.children.map((c) => c.id)).filter((id) => hasEffectiveExecutableRule(id, filters.asOf) && scenarioFitsBehavior(id, behaviorId))
      : configuredScenarios(domain, phaseId ?? null, topicId ?? null);
    const extra = new Set(ids);
    if (!catalogMode) {
      summary.openRiskIds.forEach((rid) => {
        const r = asOfRisks.find((x) => x.id === rid);
        r?.scenario_ids.forEach((s) => {
          if (topicId) {
            const mapped = liveSub(s)?.topic_id;
            if (mapped !== topicId) return;
          }
          extra.add(s);
        });
      });
    }
    const groupMeta = new Map<string, { id: string; name: string; order: number }>();
    if (dir) {
      dir.forEach((g) => {
        g.children.forEach((c) => groupMeta.set(c.id, { id: g.id, name: g.name, order: g.order }));
      });
    }
    return [...extra]
      .map((id) => {
        const scope = { ...baseScope, scenarioId: id };
        const rows = selectRows(scope);
        const counts = computeFiveCounts(scope, asOfRisks);
        const st = scenarioRuntimeStatus(id, rows, {
          domain,
          orgScope: orgIds,
          allowedObjectIds,
        });
        const redOpen = counts.openRiskIds.filter(
          (rid) => asOfRisks.find((r) => r.id === rid)?.severity === "red",
        ).length;
        const parentId = liveSub(id)?.parent_id;
        const fromDir = groupMeta.get(id);
        const groupName = fromDir?.name || catalog.groups.find((g) => g.id === parentId)?.name || "";
        const groupId = fromDir?.id || parentId || "";
        return {
          id,
          name: scenarioName(id),
          groupId,
          groupName,
          adoption: scenarioAdoption(id),
          rows,
          counts,
          statusLabelText: st.label,
          statusTone: st.tone,
          monitoringActive: isScenarioMonitoringActive(id),
          redOpen,
          objectTypes: [...new Set(rows.map((r) => r.object_type))],
          hitRuleCount: new Set(rows.filter((x) => x.status === "evaluated_hit").flatMap((x) => x.rule_ids)).size,
        };
      })
      .filter((r) => {
        if (domain === "FA" && phaseId) {
          const sub = liveSub(r.id);
          const phases = [sub?.primary_phase_id, ...(sub?.associated_phase_ids ?? [])].filter((id): id is string => Boolean(id));
          if (phases.length > 0 && !phases.includes(phaseId)) return false;
        }
        if (catalogMode) {
          return hasEffectiveExecutableRule(r.id, filters.asOf) && scenarioFitsBehavior(r.id, behaviorId);
        }
        return r.monitoringActive || r.counts.openRiskIds.length > 0;
      })
      .sort((a, b) => {
        if (dir) {
          const oa = groupMeta.get(a.id)?.order ?? 99;
          const ob = groupMeta.get(b.id)?.order ?? 99;
          if (oa !== ob) return oa - ob;
          return a.id.localeCompare(b.id);
        }
        const g = a.groupName.localeCompare(b.groupName, "zh");
        if (g !== 0) return g;
        const rank = (r: ScenarioRow) =>
          r.redOpen > 0
            ? 0
            : r.counts.overdueRiskIds.length > 0
              ? 1
              : r.counts.openRiskIds.length > 0
                ? 2
                : r.statusLabelText.startsWith("未评估")
                  ? 3
                  : 4;
        const d = rank(a) - rank(b);
        return d !== 0 ? d : a.id.localeCompare(b.id);
      });
  }, [domain, phaseId, topicId, behaviorId, baseScope, asOfRisks, summary.openRiskIds, orgIds, allowedObjectIds, catalog.groups, directoryDomain, filters.asOf]);

  const visibleScenarioRows = useMemo(
    () =>
      scenarioRows.filter((r) => {
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          if (
            !r.id.toLowerCase().includes(q) &&
            !r.name.toLowerCase().includes(q) &&
            !r.groupName.toLowerCase().includes(q)
          )
            return false;
        }
        if (onlyAbnormal && r.counts.openRiskIds.length === 0 && r.counts.hitObjects.length === 0) return false;
        if (statusFilter !== "all" && r.statusLabelText !== statusFilter) return false;
        if (objectTypeFilter !== "all" && !r.objectTypes.includes(objectTypeFilter)) return false;
        return true;
      }),
    [scenarioRows, search, onlyAbnormal, statusFilter, objectTypeFilter],
  );

  const statusOptions = useMemo(
    () => [...new Set(scenarioRows.map((r) => r.statusLabelText))].sort(),
    [scenarioRows],
  );
  const objectTypeOptions = useMemo(
    () => [...new Set(scenarioRows.flatMap((r) => r.objectTypes))].sort(),
    [scenarioRows],
  );

  const detailData = useMemo(() => {
    if (!detail) return null;
    const scope = detail.scenarioId ? { ...baseScope, scenarioId: detail.scenarioId } : baseScope;
    const counts = detail.scenarioId ? computeFiveCounts(scope, asOfRisks) : summary;
    const rows = detail.scenarioId ? selectRows(scope) : summary.rows;
    return { counts, rows, scope };
  }, [detail, baseScope, asOfRisks, summary]);

  const riskList = (ids: string[]): RiskCase[] =>
    ids.map((id) => asOfRisks.find((r) => r.id === id)).filter((r): r is RiskCase => Boolean(r));

  const scopeLine = `${orgName(filters.orgId)}${filters.includeChildren ? "（含下级）" : "（仅本级）"}｜${filters.periodStart}~${filters.periodEnd}｜截至 ${filters.asOf}｜${scopeTitle}`;

  const hitRuleIds = useMemo(
    () => [...new Set(summary.rows.filter((r) => r.status === "evaluated_hit").flatMap((r) => r.rule_ids))].sort(),
    [summary.rows],
  );
  const involvedOrgIds = useMemo(
    () => [...new Set(summary.rows.filter((r) => r.status === "evaluated_hit").map((r) => r.owner_org_id))].sort(),
    [summary.rows],
  );
  const pendingIds = useMemo(
    () =>
      asOfRisks
        .filter(
          (r) =>
            (r.status === "pending_review" || r.status === "investigating") &&
            riskMatches(r, {
              domain,
              orgScope: orgIds,
              topicId: topicId ?? undefined,
              phaseId: phaseId ?? undefined,
            }) &&
            r.scenario_ids.some((sid) => scenarioFitsBehavior(sid, behaviorId)),
        )
        .map((r) => r.id),
    [asOfRisks, orgIds, domain, topicId, phaseId, behaviorId],
  );

  const compactStats: { kind: DetailKind; label: string; value: number; unit: string }[] = [
    { kind: "rules", label: "命中规则数", value: hitRuleIds.length, unit: "条" },
    { kind: "units", label: "涉及单位数", value: involvedOrgIds.length, unit: "个" },
    { kind: "pending", label: "待核查事项", value: pendingIds.length, unit: "件" },
    { kind: "open", label: "未关闭整改", value: summary.openRiskIds.length, unit: "件" },
    { kind: "closed", label: "本期完成整改", value: summary.rectifiedClosedRiskIds.length, unit: "件" },
    { kind: "overdue", label: "逾期整改", value: summary.overdueRiskIds.length, unit: "件" },
  ];

  const catalogMode = directoryDomain === "CASH" || directoryDomain === "RIGHTS";
  const allLabel = allTopicLabel ?? (directoryDomain === "RIGHTS" ? "全部场景（10）" : "全部专题");
  const activeScopeTitle = catalogMode && !topicId ? allLabel : scopeTitle;

  const groupedRows = useMemo(() => {
    if (catalogMode && directoryDomain) {
      const source =
        topicId || phaseId
          ? scopedDirectory(directoryDomain, topicId ?? null, phaseId ?? null, phaseId ? phaseName(phaseId) : null)
          : officialDirectory(directoryDomain);
      const filtered = search || onlyAbnormal || statusFilter !== "all" || objectTypeFilter !== "all";
      return source
        .map((g) => ({
          id: g.id,
          name: g.name,
          order: g.order,
          rows: visibleScenarioRows.filter((r) => r.groupId === g.id),
          catalogChildren: g.children.filter(
            (c) => hasEffectiveExecutableRule(c.id, filters.asOf) && scenarioFitsBehavior(c.id, behaviorId),
          ).length,
        }))
        .filter((g) => (filtered || topicId || phaseId ? g.rows.length > 0 : true));
    }
    const map = new Map<string, ScenarioRow[]>();
    for (const r of visibleScenarioRows) {
      const g = r.groupName || r.groupId || "其他监管场景";
      const list = map.get(g) ?? [];
      list.push(r);
      map.set(g, list);
    }
    return [...map.entries()].map(([name, rows], order) => ({
      id: rows[0]?.groupId || name,
      name,
      order,
      rows,
      catalogChildren: rows.length,
    }));
  }, [
    catalogMode,
    directoryDomain,
    topicId,
    phaseId,
    visibleScenarioRows,
    search,
    onlyAbnormal,
    statusFilter,
    objectTypeFilter,
    behaviorId,
    filters.asOf,
  ]);

  const scenarioRef = React.useRef(visibleScenarioRows);
  scenarioRef.current = visibleScenarioRows;
  React.useEffect(() => {
    setDetail(null);
    setRuleBasisId(null);
    if (!expandRules || !phaseId) {
      setOpenRowId(null);
      return;
    }
    const hit = scenarioRef.current.find(
      (row) => row.hitRuleCount > 0 || row.counts.hitObjects.length > 0 || row.counts.openRiskIds.length > 0,
    );
    setOpenRowId(hit?.id ?? null);
  }, [topicId, phaseId, behaviorId, directoryDomain, subtopicId, expandRules]);

  const groupedRef = React.useRef(groupedRows);
  groupedRef.current = groupedRows;
  React.useEffect(() => {
    if (!expandRules) return;
    if (!phaseId) {
      setOpenGroups(new Set());
      return;
    }
    setOpenGroups(new Set(groupedRef.current.map((group) => group.id)));
  }, [expandRules, phaseId]);

  React.useEffect(() => {
    if (topicId || phaseId) setOpenGroups(new Set(groupedRows.map((g) => g.id)));
    else setOpenGroups(new Set());
  }, [topicId, phaseId, behaviorId, groupedRows]);

  React.useEffect(() => {
    setSearch("");
    setOnlyAbnormal(false);
    setStatusFilter("all");
    setObjectTypeFilter("all");
  }, [topicId, phaseId, behaviorId]);

  React.useEffect(() => {
    const q = search.trim();
    if (!q) return;
    const hits = groupedRows.filter(
      (g) =>
        g.name.includes(q) ||
        g.id.toLowerCase().includes(q.toLowerCase()) ||
        g.rows.some((r) => r.name.includes(q) || r.id.toLowerCase().includes(q.toLowerCase())),
    );
    if (hits.length === 1) setOpenGroups(new Set([hits[0].id]));
  }, [search, groupedRows]);

  const expandAll = () => setOpenGroups(new Set(groupedRows.map((g) => g.id)));
  const collapseAll = () => setOpenGroups(new Set());

  return (
    <div className="space-y-4" id="scenario-execution">
      <Card
        title={
          <span className="inline-flex items-center gap-2 flex-wrap">
            {expandRules ? "监管场景执行情况" : "场景执行情况"}
            <Tag tone="brand">{activeScopeTitle}</Tag>
            {catalogMode && (
              <span className="text-[12px] text-textsub font-normal" data-testid="scenario-catalog-count">
                {groupedRows.length} 项一级场景
              </span>
            )}
          </span>
        }
        right={
          <div className="flex items-center gap-2 flex-wrap">
            {subtopicOptions && subtopicOptions.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-textsub">业务子类</span>
                <div className="flex rounded-[6px] border border-line overflow-hidden">
                  {subtopicOptions.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => onSubtopicChange?.(o.id)}
                      className={`h-8 px-3 text-[12px] transition-colors duration-150 ${
                        (subtopicId ?? subtopicOptions[0].id) === o.id
                          ? "bg-brand text-white"
                          : "bg-surface text-textsub hover:bg-tint"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <Button
              disabled={!canAct("business.export")}
              title={canAct("business.export") ? "导出当前筛选范围内的场景执行清单" : "当前身份不能导出业务数据"}
              onClick={() => {
                if (!canAct("business.export")) return;
                downloadCsv(
                  `场景执行清单_${domain}_${phaseId ?? topicId ?? "全部"}.csv`,
                  [
                    "一级场景",
                    "监管子场景",
                    "执行状态",
                    "已评估",
                    "应评估",
                    "命中规则数",
                    "命中对象数",
                    "未关闭整改",
                  ],
                  visibleScenarioRows.map((r) => [
                    r.groupName,
                    r.name,
                    r.statusLabelText,
                    r.counts.monitoredObjects.length,
                    r.counts.requiredObjects.length,
                    r.hitRuleCount,
                    r.counts.hitObjects.length,
                    r.counts.openRiskIds.length,
                  ]),
                  {
                    title: "监管场景执行清单",
                    scopeLines: [scopeLine, "对象数按类型与对象编号去重，规则按规则ID去重，事项按事项去重"],
                  },
                );
              }}
            >
              导出当前筛选
            </Button>
          </div>
        }
      >
        {topicOptions && topicOptions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3" data-testid={topicNavTestId ?? "scenario-topic-nav"}>
            <button
              type="button"
              data-testid={allTopicTestId ?? "scenario-topic-all"}
              onClick={() => onTopicChange?.(null)}
              className={`h-8 px-3 rounded-[6px] border text-[12px] ${
                !topicId ? "border-brand bg-tint text-brand font-medium" : "border-line text-textsub hover:bg-tint"
              }`}
            >
              {allLabel}
            </button>
            {topicOptions.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={t.testId ?? `scenario-topic-${t.id}`}
                onClick={() => onTopicChange?.(t.id)}
                className={`h-8 px-3 rounded-[6px] border text-[12px] ${
                  topicId === t.id ? "border-brand bg-tint text-brand font-medium" : "border-line text-textsub hover:bg-tint"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}

        {toolbarExtra ? <div className="mb-3" data-testid="scenario-toolbar-extra">{toolbarExtra}</div> : null}

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]" data-testid="scenario-compact-stats">
          {compactStats.map((it) => (
            <button
              key={it.kind}
              type="button"
              onClick={() => setDetail({ kind: it.kind, scenarioId: null })}
              className="inline-flex items-baseline gap-1 hover:text-brand"
            >
              <span className="text-textsub">{it.label}</span>
              <span className="num font-semibold">{it.value}</span>
              <span className="text-[12px] text-textsub">{it.unit}</span>
            </button>
          ))}
        </div>

        {summary.monitoredObjects.length === 0 && summary.openRiskIds.length > 0 && (
          <div className="mt-3">
            <Notice tone="amber" title="历史遗留">
              本期已监测 0 个、历史未关闭 {summary.openRiskIds.length} 件，仍可查阅办理。
            </Notice>
          </div>
        )}

        {Object.keys(summary.objectTypeBreakdown).length > 0 && catalogMode === false && (
          <p className="mt-2 text-[12px] text-textsub">
            对象分类型：
            {Object.entries(summary.objectTypeBreakdown)
              .map(([t, n]) => `${objectTypeLabel[t] ?? t} 已评估 ${n.monitored}／命中 ${n.hit}`)
              .join("；")}
            。
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            className="h-9 px-3 rounded-[8px] border border-line bg-surface text-[14px] w-[220px]"
            placeholder="搜索场景名称或ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="h-9 px-3 rounded-[8px] border border-line bg-surface text-[14px] w-[160px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">全部监测状态</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="h-9 px-3 rounded-[8px] border border-line bg-surface text-[14px] w-[170px]"
            value={objectTypeFilter}
            onChange={(e) => setObjectTypeFilter(e.target.value)}
          >
            <option value="all">全部对象类型</option>
            {objectTypeOptions.map((t) => (
              <option key={t} value={t}>
                {objectTypeLabel[t] ?? t}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-textmain">
            <input type="checkbox" checked={onlyAbnormal} onChange={(e) => setOnlyAbnormal(e.target.checked)} />
            只看异常
          </label>
          {(catalogMode || expandRules) && (
            <>
              <Button data-testid="scenario-expand-all" onClick={expandAll}>
                展开全部
              </Button>
              <Button data-testid="scenario-collapse-all" onClick={collapseAll}>
                收起全部
              </Button>
            </>
          )}
          {(search || onlyAbnormal || statusFilter !== "all" || objectTypeFilter !== "all") && (
            <>
              <Tag tone="brand">
                已筛选：{visibleScenarioRows.length}/{scenarioRows.length}
              </Tag>
              <Button
                onClick={() => {
                  setSearch("");
                  setOnlyAbnormal(false);
                  setStatusFilter("all");
                  setObjectTypeFilter("all");
                }}
              >
                清除条件
              </Button>
            </>
          )}
        </div>

        <div className="overflow-x-auto -mx-1 px-1" data-testid="scenario-exec-table">
          <table className={`w-full ${expandRules ? "min-w-[960px]" : "min-w-[1080px]"} border-separate border-spacing-0 text-[14px]`}>
            <thead>
              {expandRules ? (
                <tr className="bg-[#f6f8fc]">
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line w-[220px]">监管子场景</th>
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line">关键监控数据</th>
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line w-[180px]">规则执行</th>
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line w-[160px]">命中对象</th>
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line w-[180px]">关联事项</th>
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line whitespace-nowrap w-[88px]">依据</th>
                </tr>
              ) : (
                <tr className="bg-[#f6f8fc]">
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line">监管子场景</th>
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line whitespace-nowrap w-[132px]">执行状态</th>
                  <th className="px-3 py-2.5 text-right text-[13px] font-semibold text-textsub border-b border-line whitespace-nowrap w-[130px]">已评估/应评估对象</th>
                  <th className="px-3 py-2.5 text-right text-[13px] font-semibold text-textsub border-b border-line whitespace-nowrap w-[110px]">命中规则数</th>
                  <th className="px-3 py-2.5 text-right text-[13px] font-semibold text-textsub border-b border-line whitespace-nowrap w-[110px]">命中对象数</th>
                  <th className="px-3 py-2.5 text-right text-[13px] font-semibold text-textsub border-b border-line whitespace-nowrap w-[110px]">未关闭整改</th>
                  <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-textsub border-b border-line whitespace-nowrap w-[96px]">查看详情</th>
                </tr>
              )}
            </thead>
            <tbody>
              {visibleScenarioRows.length === 0 && groupedRows.length === 0 && (
                <tr>
                  <td colSpan={expandRules ? 6 : 7} className="px-3 py-4 text-center text-[13px] text-textsub border-b border-line">
                    {scenarioRows.length === 0 ? "当前范围没有已启用且可实际执行的监管规则。" : "当前筛选条件下没有匹配场景，请调整搜索或筛选。"}
                  </td>
                </tr>
              )}
              {groupedRows.map((group) => {
                const opened = openGroups.has(group.id);
                const subCount = group.rows.length;
                return (
                  <React.Fragment key={group.id}>
                    <tr className="bg-[#f7f9fd]" data-testid={`scenario-group-${group.id}`}>
                      <td colSpan={expandRules ? 6 : 7} className="px-3 py-2 border-b border-line">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 text-[13px] font-medium text-textmain text-left"
                          onClick={() =>
                            setOpenGroups((prev) => {
                              const n = new Set(prev);
                              if (n.has(group.id)) n.delete(group.id);
                              else n.add(group.id);
                              return n;
                            })
                          }
                        >
                          <span className="text-textsub w-3">{opened ? "▼" : "▶"}</span>
                          <span className="whitespace-normal break-words leading-5">
                            {expandRules ? `一级监管场景 ${group.name}` : group.name}
                          </span>
                          <span className="text-[12px] text-textsub font-normal">{subCount} 个子场景</span>
                          {group.rows.length === 0 && (
                            <span className="text-[12px] text-textsub font-normal">未开展监测</span>
                          )}
                        </button>
                      </td>
                    </tr>
                    {opened &&
                      group.rows.map((r) => {
                        const dormant =
                          r.rows.length === 0 &&
                          (r.statusLabelText === "仅维护定义" ||
                            r.statusLabelText === "暂未开展监测" ||
                            r.statusLabelText === "未启用" ||
                            r.statusLabelText === "未具备运行条件" ||
                            r.statusLabelText === "未开展监测" ||
                            r.statusLabelText === "无业务");
                        const showAdoption =
                          r.adoption === "结构化监测" || r.adoption === "线索核查" || r.adoption === "专业核查";
                        const monitoredIds = [...new Set(r.rows.map((record) => record.monitoring_object_id))];
                        const factText =
                          faScenarioFacts(r.id, monitoredIds, filters.asOf, orgIds, allowedObjectIds) ??
                          "本场景当前没有可汇总的业务监测值。";
                        const scenarioCases = r.counts.openRiskIds
                          .map((id) => asOfRisks.find((item) => item.id === id))
                          .filter((item): item is RiskCase => Boolean(item));
                        const lines = expandRules ? ruleLinesFor(r, scenarioCases) : [];
                        const linkedCaseIds = new Set(lines.flatMap((line) => line.openCases.map((item) => item.id)));
                        const unmatchedCases = scenarioCases.filter((item) => !linkedCaseIds.has(item.id));
                        const hitObjects = [...new Map(lines.flatMap((line) => line.hitObjects).map((item) => [item.objectId, item])).values()];
                        return (
                        <React.Fragment key={r.id}>
                          <tr className="hover:bg-tint border-b border-line" data-testid={`scenario-sub-${r.id}`}>
                            <td className="px-3 py-2 align-top">
                              <button
                                className="text-left hover:text-brand transition-colors duration-150"
                                onClick={() => onOpenScenario?.(r.id)}
                                title={scenarioSourceLabel(r.id)}
                              >
                                <span className="text-[14px] text-textmain block break-words whitespace-normal leading-5">{r.name}</span>
                                {showAdoption && (
                                  <Tag tone={r.adoption === "结构化监测" ? "brand" : "neutral"}>{r.adoption}</Tag>
                                )}
                              </button>
                            </td>
                            {expandRules && (
                              <>
                                <td className="px-3 py-2 align-top text-[12px] text-textmain leading-5 break-words" data-testid={`scenario-facts-${r.id}`}>
                                  {factText}
                                </td>
                                <td className="px-3 py-2 align-top text-[12px] leading-5">
                                  {lines.length === 0 ? (
                                    <span className="text-textsub">未配置规则</span>
                                  ) : (
                                    lines.map((line) => (
                                      <span key={line.id} className="block">
                                        <span className="num">{line.id}</span> <Tag tone={line.statusTone}>{line.statusLabel}</Tag>
                                      </span>
                                    ))
                                  )}
                                </td>
                                <td className="px-3 py-2 align-top text-[12px] leading-5">
                                  {hitObjects.length === 0 ? (
                                    <span className="text-textsub">—</span>
                                  ) : (
                                    hitObjects.map((item) => (
                                      <button key={item.objectId} type="button" className="block text-left text-brand hover:underline" onClick={() => onOpenObject?.(item.objectId)}>
                                        {objectName(item.objectId)}
                                      </button>
                                    ))
                                  )}
                                </td>
                                <td className="px-3 py-2 align-top text-[12px] leading-5">
                                  {lines.flatMap((line) => line.openCases).length === 0 && unmatchedCases.length === 0 ? (
                                    <span className="text-textsub">—</span>
                                  ) : (
                                    <>
                                      {lines.flatMap((line) => line.openCases).map((item) => (
                                        <button key={item.id} type="button" className="block text-left text-brand hover:underline" onClick={() => onOpenRisk(item.id)}>
                                          {item.id} {item.title}
                                        </button>
                                      ))}
                                      {unmatchedCases.length > 0 && (
                                        <span className="block text-textsub" data-testid={`scenario-unmatched-${r.id}`}>
                                          另有 {unmatchedCases.map((item) => item.id).join("、")} 未由上述规则命中
                                        </span>
                                      )}
                                    </>
                                  )}
                                </td>
                              </>
                            )}
                            {!expandRules && (
                            <>
                            <td className="px-3 py-2 align-top">
                              <span className="inline-flex flex-wrap items-center gap-1">
                                <Tag tone={r.statusTone}>{r.statusLabelText}</Tag>
                              </span>
                            </td>
                            <td className="px-3 py-2 align-top text-right num whitespace-nowrap">
                              {r.rows.length === 0 ? (
                                <span className="text-textsub">{r.statusLabelText === "无业务" ? "无业务" : "—"}</span>
                              ) : (
                                <button
                                  className="text-brand hover:underline"
                                  onClick={() => setDetail({ kind: "monitored", scenarioId: r.id })}
                                >
                                  {r.counts.monitoredObjects.length}/{r.counts.requiredObjects.length}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-right num whitespace-nowrap">
                              {dormant ? (
                                <span className="text-textsub">—</span>
                              ) : (
                                <button
                                  className="text-brand hover:underline"
                                  onClick={() => setDetail({ kind: "rules", scenarioId: r.id })}
                                >
                                  {r.hitRuleCount}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-right num whitespace-nowrap">
                              {dormant ? (
                                <span className="text-textsub">—</span>
                              ) : r.adoption === "核查依据" && r.counts.hitObjects.length === 0 ? (
                                <span className="text-textsub" title="专业核查尚无结论">
                                  —（待人工核查）
                                </span>
                              ) : (
                                <button
                                  className="text-brand hover:underline"
                                  onClick={() => setDetail({ kind: "hit", scenarioId: r.id })}
                                >
                                  {r.counts.hitObjects.length}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-right num whitespace-nowrap">
                              {dormant && r.counts.openRiskIds.length === 0 ? (
                                <span className="text-textsub">—</span>
                              ) : (
                                <button
                                  className="hover:underline"
                                  style={{
                                    color:
                                      r.redOpen > 0
                                        ? "var(--risk-red-fg)"
                                        : r.counts.openRiskIds.length > 0
                                          ? "var(--risk-amber-fg)"
                                          : "var(--text-sub)",
                                  }}
                                  onClick={() => setDetail({ kind: "open", scenarioId: r.id })}
                                >
                                  {r.counts.openRiskIds.length}
                                  {r.redOpen > 0 && <span className="ml-1">●</span>}
                                </button>
                              )}
                            </td>
                            </>
                            )}
                            <td className="px-3 py-2 align-top whitespace-nowrap">
                              <LinkButton
                                onClick={() => setOpenRowId((id) => (id === r.id ? null : r.id))}
                              >
                                {openRowId === r.id ? "收起" : expandRules ? "计算依据" : "查看详情"}
                              </LinkButton>
                            </td>
                          </tr>
                          {openRowId === r.id && expandRules && (
                            <tr className="bg-[#fbfcfe]">
                              <td colSpan={expandRules ? 6 : 7} className="px-4 py-3 border-b border-line">
                                {(() => {
                                  const lines = ruleLinesFor(
                                    r,
                                    r.counts.openRiskIds
                                      .map((id) => asOfRisks.find((item) => item.id === id))
                                      .filter((item): item is RiskCase => Boolean(item)),
                                  );
                                  if (lines.length === 0) {
                                    return <p className="text-[13px] text-textsub">当前子场景没有可列出的监测规则。</p>;
                                  }
                                  return (
                                    <div className="overflow-x-auto">
                                      <table className="w-full min-w-[860px] text-[13px]" data-testid={`scenario-rules-${r.id}`}>
                                        <thead>
                                          <tr className="text-textsub">
                                            <th className="px-2 py-1.5 text-left font-medium">规则编号</th>
                                            <th className="px-2 py-1.5 text-left font-medium">规则名称</th>
                                            <th className="px-2 py-1.5 text-left font-medium">执行状态</th>
                                            <th className="px-2 py-1.5 text-right font-medium">应评估</th>
                                            <th className="px-2 py-1.5 text-right font-medium">已评估</th>
                                            <th className="px-2 py-1.5 text-left font-medium">命中对象</th>
                                            <th className="px-2 py-1.5 text-left font-medium">未关闭事项</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lines.map((line) => (
                                            <React.Fragment key={line.id}>
                                            <tr className="border-t border-line align-top">
                                              <td className="px-2 py-2 num whitespace-nowrap">
                                                <button
                                                  type="button"
                                                  className="text-brand hover:underline"
                                                  onClick={() => setRuleBasisId((current) => (current === `${r.id}:${line.id}` ? null : `${r.id}:${line.id}`))}
                                                >
                                                  {line.id}
                                                </button>
                                              </td>
                                              <td className="px-2 py-2">{line.name}</td>
                                              <td className="px-2 py-2"><Tag tone={line.statusTone}>{line.statusLabel}</Tag></td>
                                              <td className="px-2 py-2 text-right num">{line.required === null ? "—" : line.required}</td>
                                              <td className="px-2 py-2 text-right num">{line.evaluated === null ? "—" : line.evaluated}</td>
                                              <td className="px-2 py-2">
                                                {line.hitObjects.length === 0 ? (
                                                  <span className="text-textsub">{line.statusLabel === "未命中" ? "未命中" : "—"}</span>
                                                ) : (
                                                  <span className="flex flex-col items-start gap-1">
                                                    {line.hitObjects.map((obj) => (
                                                      <button
                                                        key={obj.objectId}
                                                        type="button"
                                                        className="text-brand hover:underline text-left"
                                                        onClick={() => onOpenObject?.(obj.objectId)}
                                                      >
                                                        {objectTitle(obj.objectId)}
                                                      </button>
                                                    ))}
                                                  </span>
                                                )}
                                              </td>
                                              <td className="px-2 py-2">
                                                {line.openCases.length === 0 ? (
                                                  <span className="text-textsub">—</span>
                                                ) : (
                                                  <span className="flex flex-col items-start gap-1">
                                                    {line.openCases.map((item) => (
                                                      <button
                                                        key={item.id}
                                                        type="button"
                                                        className="text-brand hover:underline text-left"
                                                        onClick={() => onOpenRisk(item.id)}
                                                      >
                                                        {item.id} {item.title}
                                                      </button>
                                                    ))}
                                                  </span>
                                                )}
                                              </td>
                                            </tr>
                                            {ruleBasisId === `${r.id}:${line.id}` && (
                                              <tr className="bg-white">
                                                <td colSpan={7} className="px-2 py-2 text-[12px] text-textsub leading-5" data-testid={`rule-basis-${line.id}`}>
                                                  {ruleBasisLines(
                                                    line.id,
                                                    [...new Set(r.rows.map((record) => record.monitoring_object_id))],
                                                  ).map((text) => (
                                                    <p key={text}>{text}</p>
                                                  ))}
                                                </td>
                                              </tr>
                                            )}
                                            </React.Fragment>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          )}
                          {openRowId === r.id && !expandRules && (
                            <tr className="bg-[#fbfcfe]">
                              <td colSpan={expandRules ? 6 : 7} className="px-4 py-3 text-[13px] border-b border-line">
                                <div className="flex flex-wrap gap-x-5 gap-y-2">
                                  <button type="button" className="hover:text-brand" onClick={() => setDetail({ kind: "closed", scenarioId: r.id })}>
                                    本期完成整改 <span className="num font-medium">{r.counts.rectifiedClosedRiskIds.length}</span> 件
                                  </button>
                                  <button type="button" className="hover:text-brand" onClick={() => setDetail({ kind: "overdue", scenarioId: r.id })}>
                                    逾期整改 <span className="num font-medium">{r.counts.overdueRiskIds.length}</span> 件
                                  </button>
                                  <button type="button" className="hover:text-brand" onClick={() => setDetail({ kind: "rules", scenarioId: r.id })}>
                                    命中规则 <span className="num font-medium">{r.hitRuleCount}</span> 条
                                  </button>
                                  <LinkButton onClick={() => onOpenScenario?.(r.id, true)}>查看命中依据</LinkButton>
                                  <LinkButton onClick={() => onOpenScenario?.(r.id)}>打开场景定义</LinkButton>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                        );
                      })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {ledger ? <div className="mt-4">{ledger}</div> : null}
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={920}
        title={
          <span className="flex items-center gap-2 flex-wrap">
            {detail ? DETAIL_TITLE[detail.kind] : ""}
            {detail?.scenarioId && <Tag tone="brand">{scenarioName(detail.scenarioId)}<span className="num text-[11px] ml-1">场景编号 {detail.scenarioId}</span></Tag>}
          </span>
        }
      >
        <p className="text-[12px] text-textsub mb-3">{scopeLine}</p>
        {detail && detailData && (detail.kind === "monitored" || detail.kind === "hit") && (
          <>
            {(() => {
              const objects = detail.kind === "monitored" ? detailData.counts.monitoredObjects : detailData.counts.hitObjects;
              if (objects.length === 0) {
                return (
                  <EmptyState
                    title={detail.kind === "monitored" ? "本期尚无已完成监测的对象" : "本期尚无命中对象"}
                  />
                );
              }
              return (
                <DataTable
                  rows={objects}
                  rowKey={(o) => `${o.objectType}-${o.objectId}`}
                  onRowClick={(o) => onOpenObject?.(o.objectId)}
                  columns={[
                    { key: "type", title: "对象类型", width: "150px", render: (o) => objectTypeLabel[o.objectType] ?? o.objectType },
                    { key: "id", title: "对象", render: (o) => (
                      <span>
                        <span className="text-textmain">{objectTitle(o.objectId)}</span>
                        <span className="num text-[12px] text-textsub ml-2">对象编号 {o.objectId}</span>
                      </span>
                    ) },
                    {
                      key: "rules",
                      title: "已评估/应评估规则数",
                      align: "right",
                      width: "170px",
                      render: (o) => {
                        const rs = detailData.rows.filter((r) => r.monitoring_object_id === o.objectId);
                        const evaluated = rs.filter((r) => r.status === "evaluated_hit" || r.status === "evaluated_clear").length;
                        const required = rs.filter((r) => r.required && r.status !== "not_applicable" && r.status !== "reference_only").length;
                        return <span className="num">{evaluated} / {required}</span>;
                      },
                    },
                    {
                      key: "window",
                      title: "归属观察窗口",
                      width: "190px",
                      render: (o) => {
                        const r = detailData.rows.find((x) => x.monitoring_object_id === o.objectId);
                        return <span className="num text-[12px]">{r ? `${r.window_start} ~ ${r.window_end}` : "—"}</span>;
                      },
                    },
                    {
                      key: "note",
                      title: "说明",
                      render: (o) => {
                        const r = detailData.rows.find((x) => x.monitoring_object_id === o.objectId);
                        return <span className="text-[12px] text-textsub">{monitoringNoteLabel(r?.note, r?.status)}</span>;
                      },
                    },
                  ]}
                />
              );
            })()}
          </>
        )}

        {detail && detailData && (detail.kind === "open" || detail.kind === "closed" || detail.kind === "overdue") && (
          (() => {
            const ids =
              detail.kind === "open"
                ? detailData.counts.openRiskIds
                : detail.kind === "closed"
                  ? detailData.counts.rectifiedClosedRiskIds
                  : detailData.counts.overdueRiskIds;
            const list = riskList(ids);
            if (list.length === 0) {
              return (
                <EmptyState
                  title={
                    detail.kind === "open"
                      ? "当前范围没有未关闭事项"
                      : detail.kind === "closed"
                        ? "所选期间没有复核通过关闭的事项"
                        : "当前范围没有逾期整改事项"
                  }
                />
              );
            }
            return (
              <DataTable
                rows={list}
                rowKey={(r) => r.id}
                onRowClick={(r) => {
                  setDetail(null);
                  onOpenRisk(r.id);
                }}
                columns={[
                  { key: "id", title: "事项", width: "220px", render: (r) => (
                    <span>{r.title}<span className="num text-[12px] text-textsub ml-1">事项编号 {r.id}</span></span>
                  ) },
                  { key: "title", title: "名称", render: (r) => r.title },
                  { key: "sev", title: "等级", width: "88px", render: (r) => <SeverityTag severity={r.severity} /> },
                  { key: "status", title: "办理状态", width: "110px", render: (r) => statusLabel[r.status] },
                  { key: "org", title: "责任单位", width: "140px", render: (r) => orgName(r.owner_org_id) },
                  ...(detail.kind === "closed"
                    ? [
                        {
                          key: "closed",
                          title: "复核通过关闭",
                          width: "150px",
                          render: (r: RiskCase) => (
                            <span className="num">{fmtDate(r.verified_closed_at ?? r.closed_at)}</span>
                          ),
                        },
                      ]
                    : []),
                  ...(detail.kind === "overdue"
                    ? [
                        {
                          key: "due",
                          title: "有效整改期限",
                          width: "130px",
                          render: (r: RiskCase) => <span className="num">{fmtDate(rectificationDueDate(r))}</span>,
                        },
                        {
                          key: "days",
                          title: "逾期天数",
                          align: "right" as const,
                          width: "96px",
                          render: (r: RiskCase) => {
                            const d = rectificationDueDate(r);
                            return (
                              <span className="num" style={{ color: "var(--risk-red-fg)" }}>
                                {d ? daysBetween(d, filters.asOf) : "—"}
                              </span>
                            );
                          },
                        },
                      ]
                    : []),
                  ...(detail.kind === "open"
                    ? [
                        {
                          key: "overdue",
                          title: "逾期",
                          width: "96px",
                          render: (r: RiskCase) =>
                            isOverdueRectification(r, filters.asOf) ? <Tag tone="red">整改逾期</Tag> : <span className="text-textsub">—</span>,
                        },
                      ]
                    : []),
                ]}
              />
            );
          })()
        )}

        {detail && detail.kind === "pending" && (
          (() => {
            const ids = detail.scenarioId
              ? pendingIds.filter((id) => asOfRisks.find((r) => r.id === id)?.scenario_ids.includes(detail.scenarioId as string))
              : pendingIds;
            const list = riskList(ids);
            if (list.length === 0) return <EmptyState title="当前范围没有待核查事项" />;
            return (
              <DataTable
                rows={list}
                rowKey={(r) => r.id}
                onRowClick={(r) => {
                  setDetail(null);
                  onOpenRisk(r.id);
                }}
                columns={[
                  { key: "id", title: "事项", width: "220px", render: (r) => (
                    <span>{r.title}<span className="num text-[12px] text-textsub ml-1">事项编号 {r.id}</span></span>
                  ) },
                  { key: "title", title: "名称", render: (r) => r.title },
                  { key: "sev", title: "等级", width: "88px", render: (r) => <SeverityTag severity={r.severity} /> },
                  { key: "status", title: "办理状态", width: "110px", render: (r) => statusLabel[r.status] },
                  { key: "org", title: "责任单位", width: "140px", render: (r) => orgName(r.owner_org_id) },
                ]}
              />
            );
          })()
        )}

        {detail && detail.kind === "rules" && (
          (() => {
            const ids = detail.scenarioId && detailData
              ? [...new Set(detailData.rows.filter((r) => r.status === "evaluated_hit").flatMap((r) => r.rule_ids))].sort()
              : hitRuleIds;
            if (ids.length === 0) return <EmptyState title="当前范围没有命中规则" />;
            const rows = ids.map((id) => ({
              id,
              name: catalog.rules.find((r) => r.id === id)?.name ?? id,
              scenario: catalog.rules.find((r) => r.id === id)?.primary_subscenario_id ?? "",
            }));
            return (
              <DataTable
                rows={rows}
                rowKey={(r) => r.id}
                columns={[
                  { key: "name", title: "规则名称", render: (r) => r.name || ruleDisplayName(r.id) },
                  { key: "id", title: "规则编号", width: "140px", render: (r) => <span className="num">{r.id}</span> },
                  {
                    key: "sc",
                    title: "主场景",
                    render: (r) => (r.scenario ? `${r.scenario} ${scenarioName(r.scenario)}` : "—"),
                  },
                ]}
              />
            );
          })()
        )}

        {detail && detail.kind === "units" && (
          (() => {
            const ids = detail.scenarioId && detailData
              ? [...new Set(detailData.rows.filter((r) => r.status === "evaluated_hit").map((r) => r.owner_org_id))].sort()
              : involvedOrgIds;
            if (ids.length === 0) return <EmptyState title="当前范围没有命中涉及单位" />;
            const rows = ids.map((id) => ({ id, name: orgName(id) }));
            return (
              <DataTable
                rows={rows}
                rowKey={(r) => r.id}
                columns={[
                  { key: "name", title: "单位", render: (r) => r.name },
                  { key: "id", title: "组织编号", width: "120px", render: (r) => <span className="num">{r.id}</span> },
                ]}
              />
            );
          })()
        )}

        <div className="mt-3">
          <SimulatedBadge text="合成样例" />
        </div>
      </Modal>
    </div>
  );
}
