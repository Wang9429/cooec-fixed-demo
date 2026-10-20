"use client";

import React, { useEffect, useMemo, useState } from "react";
import ChevronFlow, { type ChevronItem } from "@/components/ChevronFlow";
import IndicatorDrawer, { formatKpiCaption, formatMetricParts } from "@/components/IndicatorDrawer";
import RiskCaseDrawer from "@/components/RiskCaseDrawer";
import ScenarioDrawer from "@/components/ScenarioDrawer";
import ScenarioExecutionPanel, { type SubtopicOption } from "@/components/ScenarioExecutionPanel";
import ObjectDrawer from "@/components/ObjectDrawer";
import { Button, Card, DataTable, KpiCard, SeverityTag, Tabs, Tag } from "@/components/ui";
import FilterBar from "@/components/FilterBar";
import InvestmentKindTabs from "@/components/InvestmentKindTabs";
import PageHeader from "@/components/PageHeader";
import { DOMAIN_META, phaseName, seed, templatesByDomain, topicName } from "@/lib/seed";
import { computeIndicator, indicatorById, type IndicatorDef, type NodeMetric } from "@/lib/metrics";
import { isRunnableDrawerIndicator, runnableDrawerIndicators } from "@/lib/indicator-scope";
import { openCountForPhase, openCountForTopic } from "@/lib/monitoring";
import { orgName } from "@/lib/org";
import { authorizedObjectIds, canDomain, intersectOrgScope, riskVisible } from "@/lib/config";
import { isOpen, isOverdueRectification, rectificationDueDate, statusLabel } from "@/lib/risks";
import { riskMatches } from "@/lib/risks";
import { fmtDate } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { useDemoStore } from "@/lib/store";
import type { DomainId, LifecycleTemplate, RiskCase } from "@/lib/types";

/**
 * 领域首页固定结构（完整业需 3.1 / 3.5）：
 * 标题筛选 → 4~6 张指标卡 → 本期重点关注 → 横向流程或专题看板 → 场景执行 → 对象与事项。
 * 流程主视图位于任何趋势图之前，首屏即可见。
 */

export interface DomainTab {
  id: string;
  label: string;
  render: (helpers: DomainHelpers) => React.ReactNode;
}

export interface DomainHelpers {
  openRisk: (id: string) => void;
  openObject: (id: string) => void;
  openIndicator: (id: string) => void;
  orgIds: Set<string>;
  allowedObjectIds: string[] | null;
}

export interface KpiSpec {
  indicatorId?: string;
  name?: string;
  value?: React.ReactNode;
  unit?: string;
  compare?: React.ReactNode;
  compareTone?: "red" | "amber" | "green" | "neutral" | "brand";
  dataState?: React.ReactNode;
  onOpen?: () => void;
}

function metricTone(m: NodeMetric): "red" | "amber" | "green" | "neutral" {
  switch (m.status) {
    case "risk":
      return "red";
    case "attention":
      return "amber";
    case "normal":
      return "green";
    default:
      return "neutral";
  }
}

export default function DomainPage({
  domain,
  kpiIndicatorIds,
  extraKpis,
  flowMode = "phases",
  subtopicByPhase,
  tabs = [],
  ledger,
}: {
  domain: DomainId;
  kpiIndicatorIds: string[];
  extraKpis?: (helpers: DomainHelpers) => KpiSpec[];
  flowMode?: "phases" | "topics";
  subtopicByPhase?: Record<string, SubtopicOption[]>;
  tabs?: DomainTab[];
  ledger?: (helpers: DomainHelpers) => React.ReactNode;
}) {
  const meta = DOMAIN_META[domain];
  const { filters, risks, user, canAct, catalog } = useDemoStore();
  const [tab, setTab] = useState("overview");
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [subtopicId, setSubtopicId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>(() => templatesByDomain(domain)[0]?.id ?? "");
  const [indicatorId, setIndicatorId] = useState<string | null>(null);
  const [riskId, setRiskId] = useState<string | null>(null);
  const [objectId, setObjectId] = useState<string | null>(null);
  const [objectTab, setObjectTab] = useState("profile");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioSourceOpen, setScenarioSourceOpen] = useState(false);
  const [riskFilter, setRiskFilter] = useState<"all" | "open" | "red" | "overdue">("all");

  const orgIds = useMemo(
    () => intersectOrgScope(filters.orgId, filters.includeChildren, user),
    [filters.orgId, filters.includeChildren, user],
  );
  const allowedObjectIds = useMemo(() => authorizedObjectIds(user), [user]);

  const ctx = useMemo(
    () => ({
      periodStart: filters.periodStart,
      periodEnd: filters.periodEnd,
      asOf: filters.asOf,
      risks,
      allowedObjectIds,
    }),
    [filters.periodStart, filters.periodEnd, filters.asOf, risks, allowedObjectIds],
  );

  const helpers: DomainHelpers = useMemo(
    () => ({
      openRisk: setRiskId,
      openObject: setObjectId,
      openIndicator: setIndicatorId,
      orgIds,
      allowedObjectIds,
    }),
    [orgIds, allowedObjectIds],
  );

  const templates = useMemo(() => templatesByDomain(domain), [domain]);
  const template: LifecycleTemplate | undefined = useMemo(
    () => templates.find((t) => t.id === templateId) ?? templates[0],
    [templates, templateId],
  );

  const domainRisks = useMemo(
    () => risks.filter((r) => riskVisible(user, r) && riskMatches(r, { domain, orgScope: orgIds })),
    [risks, domain, orgIds, user],
  );

  const chevronItems: ChevronItem[] = useMemo(() => {
    if (flowMode !== "phases" || !template) return [];
    return template.phase_nodes
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((n) => {
        const c = openCountForPhase(domain, n.id, orgIds, domainRisks, filters.asOf);
        return { id: n.id, name: n.name, openCount: c.open, severity: c.maxSeverity };
      });
  }, [flowMode, template, domain, orgIds, domainRisks, filters.asOf]);

  const topics = useMemo(
    () => seed.domain_topics.find((d) => d.domain === domain)?.topics ?? [],
    [domain],
  );

  const highlights = useMemo(() => {
    return domainRisks
      .filter((r) => isOpen(r))
      .slice()
      .sort((a, b) => {
        const rank = (r: RiskCase) =>
          (r.severity === "red" ? 0 : 2) + (isOverdueRectification(r, filters.asOf) ? -1 : 0);
        return rank(a) - rank(b) || a.id.localeCompare(b.id);
      })
      .slice(0, 3);
  }, [domainRisks, filters.asOf]);

  const kpiDefs = useMemo(() => {
    if (!canDomain(user, domain)) return [];
    const seen = new Set<string>();
    const out: IndicatorDef[] = [];
    const push = (def: IndicatorDef | undefined) => {
      if (!def || def.domain !== domain || !isRunnableDrawerIndicator(def) || seen.has(def.id)) return;
      seen.add(def.id);
      out.push(def);
    };
    for (const id of kpiIndicatorIds) push(indicatorById(id));
    for (const def of runnableDrawerIndicators(domain)) push(def);
    return out;
  }, [kpiIndicatorIds, domain, catalog, user]);

  const scopeTitle =
    flowMode === "phases"
      ? phaseId
        ? phaseName(phaseId)
        : "全部环节"
      : topicId
        ? topicName(topicId)
        : "全部专题";

  const scopeLabel = `${orgName(filters.orgId)}${filters.includeChildren ? "（含下级）" : "（仅本级）"}｜${filters.periodStart}~${filters.periodEnd}`;

  useEffect(() => {
    setIndicatorId(null);
    setRiskId(null);
    setObjectId(null);
    setScenarioId(null);
  }, [filters.orgId, filters.includeChildren, filters.periodStart, filters.periodEnd, filters.asOf, user?.id]);

  const currentSubtopics = phaseId ? subtopicByPhase?.[phaseId] : undefined;
  const effectiveSubtopic = currentSubtopics ? (subtopicId ?? currentSubtopics[0].id) : null;

  const visibleRisks = useMemo(() => {
    return domainRisks.filter((r) => {
      if (riskFilter === "open") return isOpen(r);
      if (riskFilter === "red") return isOpen(r) && r.severity === "red";
      if (riskFilter === "overdue") return isOpen(r) && isOverdueRectification(r, filters.asOf);
      return true;
    });
  }, [domainRisks, riskFilter, filters.asOf]);

  const allTabs = [
    { id: "overview", label: "监管总览" },
    ...tabs.map((t) => ({ id: t.id, label: t.label })),
    { id: "cases", label: `监管事项（${domainRisks.filter(isOpen).length}）` },
  ];

  return (
    <div className="space-y-4">
      {(domain === "FA" || domain === "EQ") && <InvestmentKindTabs current={domain} />}
      <PageHeader title={meta.label}>
        <FilterBar />
      </PageHeader>

      <Tabs tabs={allTabs} value={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="reg-kpis-domain">
            {kpiDefs.map((def) => {
              const m = computeIndicator(def, orgIds, ctx);
              const parts = formatMetricParts(def, m);
              const caption = formatKpiCaption(m, def);
              return (
                <KpiCard
                  key={def.id}
                  name={def.name}
                  value={parts.value}
                  unit={parts.unit}
                  compare={caption.compare}
                  compareTone={metricTone(m) === "red" ? "red" : "neutral"}
                  dataState={caption.dataState}
                  scopeLabel={scopeLabel}
                  onOpen={() => setIndicatorId(def.id)}
                  returnKey={def.id}
                />
              );
            })}
            {extraKpis?.(helpers).map((k, i) => {
              const raw = k.value;
              const text = typeof raw === "string" ? raw.replace(/%%+$/, "%") : raw;
              const unit =
                k.unit &&
                typeof text === "string" &&
                (k.unit === "%" ? text.includes("%") : text.includes(k.unit))
                  ? undefined
                  : k.unit;
              return (
                <KpiCard
                  key={`extra-${i}`}
                  name={k.name ?? ""}
                  value={text}
                  unit={unit}
                  compare={k.compare}
                  compareTone={k.compareTone === "red" ? "red" : "neutral"}
                  dataState={k.dataState}
                  onOpen={k.onOpen}
                  returnKey={k.name ?? `extra-${i}`}
                />
              );
            })}
          </div>

          {flowMode === "phases" && template && (
            <Card
              id="business-flow"
              title="业务流程监管"
              right={
                templates.length > 1 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] text-textsub whitespace-nowrap">事项类型</span>
                    <select
                      className="h-8 px-2 rounded-[6px] border border-line bg-surface text-[13px]"
                      value={template.id}
                      onChange={(e) => {
                        setTemplateId(e.target.value);
                        setPhaseId(null);
                      }}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.matter_type_name ?? t.id}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : undefined
              }
            >
              <ChevronFlow
                items={chevronItems}
                value={phaseId}
                onChange={(id) => {
                  setPhaseId(id);
                  setSubtopicId(null);
                }}
                ariaLabel={`${meta.label}业务阶段`}
              />
            </Card>
          )}

          {flowMode === "topics" && (
            <Card title="专题监管">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTopicId(null)}
                  className={`shrink-0 h-[62px] px-4 rounded-[6px] border text-[13px] transition-colors duration-150 ${
                    topicId === null ? "border-brand bg-tint text-brand font-medium" : "border-line bg-surface text-textsub hover:bg-tint"
                  }`}
                >
                  全部专题
                </button>
                {topics.map((t) => {
                  const c = openCountForTopic(domain, t.id, orgIds, domainRisks);
                  const selected = topicId === t.id;
                  const tone =
                    c.open === 0
                      ? "var(--risk-neutral-fg)"
                      : c.maxSeverity === "red"
                        ? "var(--risk-red-fg)"
                        : "var(--risk-amber-fg)";
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setTopicId(t.id);
                      }}
                      title={`${t.name}｜未关闭事项 ${c.open} 件`}
                      className={`h-[62px] min-w-[168px] px-4 rounded-[6px] border text-left transition-colors duration-150 ${
                        selected ? "border-brand bg-tint" : "border-line bg-surface hover:bg-tint"
                      }`}
                    >
                      <div className={`text-[13px] whitespace-nowrap ${selected ? "text-brand font-medium" : "text-textmain"}`}>{t.name}</div>
                      <div className="text-[12px] mt-0.5">
                        <span className="text-textsub">未关闭 </span>
                        <span className="num font-semibold" style={{ color: tone }}>
                          {c.open}
                        </span>
                        <span className="text-textsub"> 件</span>
                        {c.open > 0 && (
                          <span style={{ color: tone }} aria-hidden>
                            {" "}
                            {c.maxSeverity === "red" ? "●" : "▲"}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          <Card
            title="本期重点关注"
            right={
              <button
                className="text-[13px] text-brand hover:underline"
                onClick={() => {
                  setTab("cases");
                  setRiskFilter("open");
                }}
              >
                查看事项清单 ›
              </button>
            }
          >
            {highlights.length === 0 ? (
              <p className="text-[13px] text-textsub">当前组织范围内没有未关闭事项。</p>
            ) : (
              <ul className="space-y-2">
                {highlights.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setRiskId(r.id)}
                      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-[6px] border border-line bg-surface hover:bg-tint transition-colors duration-150 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <span className="num text-[12px] text-textsub shrink-0 mt-0.5">{r.primary_object_id}</span>
                          <span className="text-[13px] text-textmain leading-5 break-words">{r.title}</span>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end max-w-[46%]">
                        <SeverityTag severity={r.severity} />
                        {isOverdueRectification(r, filters.asOf) && <Tag tone="red">整改逾期</Tag>}
                        <span className="text-[12px] text-textsub whitespace-nowrap">{statusLabel[r.status]}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ScenarioExecutionPanel
            domain={domain}
            phaseId={flowMode === "phases" ? phaseId : null}
            topicId={flowMode === "topics" ? topicId : null}
            subtopicId={effectiveSubtopic}
            orgIds={orgIds}
            allowedObjectIds={allowedObjectIds}
            scopeTitle={scopeTitle}
            subtopicOptions={currentSubtopics}
            onSubtopicChange={setSubtopicId}
            onOpenRisk={setRiskId}
            onOpenObject={setObjectId}
            onOpenScenario={(id, source) => {
              setScenarioSourceOpen(Boolean(source));
              setScenarioId(id);
            }}
          />

          {ledger?.(helpers)}
        </div>
      )}

      {tabs.map((t) => (tab === t.id ? <div key={t.id}>{t.render(helpers)}</div> : null))}

      {tab === "cases" && (
        <Card
          title="监管事项"
          right={
            <div className="flex items-center gap-2">
              <div className="flex rounded-[6px] border border-line overflow-hidden">
                {[
                  { id: "all", label: "全部" },
                  { id: "open", label: "未关闭" },
                  { id: "red", label: "高风险" },
                  { id: "overdue", label: "逾期整改" },
                ].map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setRiskFilter(o.id as never)}
                    className={`h-8 px-3 text-[12px] transition-colors duration-150 ${
                      riskFilter === o.id ? "bg-brand text-white" : "bg-surface text-textsub hover:bg-tint"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <Button
                disabled={!canAct("business.export")}
                title={canAct("business.export") ? "导出当前筛选范围内的事项" : "当前身份不能导出业务数据"}
                onClick={() => {
                  if (!canAct("business.export")) return;
                  downloadCsv(
                    `监管事项_${domain}.csv`,
                    ["事项ID", "名称", "等级", "办理状态", "责任单位", "主对象", "规则", "场景", "有效整改期限", "是否逾期"],
                    visibleRisks.map((r) => [
                      r.id,
                      r.title,
                      r.severity === "red" ? "高风险" : "关注",
                      statusLabel[r.status],
                      orgName(r.owner_org_id),
                      r.primary_object_id,
                      r.rule_id,
                      r.scenario_ids.join("/"),
                      rectificationDueDate(r) ?? "",
                      isOverdueRectification(r, filters.asOf) ? "是" : "否",
                    ]),
                    {
                      title: `${meta.label}监管事项清单`,
                      scopeLines: [scopeLabel, `截至日 ${filters.asOf}`, `筛选：${riskFilter}`],
                    },
                  );
                }}
              >
                导出当前筛选
              </Button>
            </div>
          }
        >
          <DataTable
            rows={visibleRisks}
            rowKey={(r) => r.id}
            onRowClick={(r) => setRiskId(r.id)}
            empty="当前组织范围与筛选条件下没有监管事项。"
            pageSize={10}
            tableClassName="min-w-[960px]"
            columns={[
              { key: "id", title: "事项", width: "76px", nowrap: true, render: (r) => <span className="num">{r.id}</span> },
              { key: "title", title: "名称", minWidth: "220px", render: (r) => <span className="break-words leading-5">{r.title}</span> },
              { key: "sev", title: "等级", width: "88px", nowrap: true, render: (r) => <SeverityTag severity={r.severity} /> },
              { key: "status", title: "办理状态", width: "104px", nowrap: true, render: (r) => statusLabel[r.status] },
              {
                key: "phase",
                title: "问题所属环节",
                width: "150px",
                render: (r) => {
                  const link = seed.risk_context_links.find((l) => l.risk_id === r.id && l.domain === domain);
                  return link?.primary_phase_id
                    ? phaseName(link.primary_phase_id)
                    : link?.topic_id
                      ? topicName(link.topic_id)
                      : "—";
                },
              },
              { key: "org", title: "责任单位", width: "134px", render: (r) => orgName(r.owner_org_id) },
              {
                key: "due",
                title: "有效整改期限",
                width: "124px",
                render: (r) => <span className="num">{fmtDate(rectificationDueDate(r))}</span>,
              },
              {
                key: "overdue",
                title: "逾期",
                width: "84px",
                render: (r) =>
                  isOverdueRectification(r, filters.asOf) ? <Tag tone="red">逾期</Tag> : <span className="text-textsub">—</span>,
              },
            ]}
          />
        </Card>
      )}

      <IndicatorDrawer
        open={Boolean(indicatorId)}
        onClose={() => setIndicatorId(null)}
        indicator={indicatorId ? indicatorById(indicatorId) ?? null : null}
        indicatorOptions={kpiDefs}
        onSwitchIndicator={setIndicatorId}
        allowIndicatorSwitch
        initialOrgId={filters.orgId}
        includeChildren={filters.includeChildren}
        scopeLabel={scopeLabel}
        onOpenObject={(id, t) => {
          setObjectId(id);
          setObjectTab(t ?? "profile");
        }}
        onOpenRisk={setRiskId}
      />
      <RiskCaseDrawer riskId={riskId} onClose={() => setRiskId(null)} sourceLabel={`${meta.label}·${scopeTitle}`} />
      <ScenarioDrawer
        scenarioId={scenarioId}
        sourceOpen={scenarioSourceOpen}
        onClose={() => {
          setScenarioId(null);
          setScenarioSourceOpen(false);
        }}
        onOpenRisk={(id) => {
          setScenarioId(null);
          setScenarioSourceOpen(false);
          setRiskId(id);
        }}
        onOpenObject={(id) => {
          setScenarioId(null);
          setScenarioSourceOpen(false);
          setObjectId(id);
        }}
      />
      <ObjectDrawer
        objectId={objectId}
        initialTab={objectTab}
        onClose={() => setObjectId(null)}
        onOpenRisk={setRiskId}
      />
    </div>
  );
}
