"use client";

import React, { useEffect, useMemo, useState } from "react";
import FilterBar from "@/components/FilterBar";
import PageHeader from "@/components/PageHeader";
import IndicatorDrawer from "@/components/IndicatorDrawer";
import RiskCaseDrawer from "@/components/RiskCaseDrawer";
import ScenarioDrawer from "@/components/ScenarioDrawer";
import ObjectDrawer from "@/components/ObjectDrawer";
import ScenarioExecutionPanel from "@/components/ScenarioExecutionPanel";
import { Card, DataTable, Tag } from "@/components/ui";
import { useDemoStore } from "@/lib/store";
import { authorizedObjectIds, canDomain, intersectOrgScope } from "@/lib/config";
import { descendantOrgIds, orgName, orgPath } from "@/lib/org";
import { seed } from "@/lib/seed";
import { censusCounts, openMatterCount, penetratePaths } from "@/lib/fp-census";
import { ECONOMIC_BEHAVIORS } from "@/lib/fp-topics";
import type { PropertyMatter } from "@/lib/types";

const RIGHTS_THEMES = [
  { id: "PTY2-T-REG", label: "产权登记与信息核验" },
  { id: "PTY2-T-TRADE", label: "产权交易与变动" },
  { id: "PTY2-T-IDENTITY", label: "标识与名称资质" },
  { id: "PTY2-T-CONTROL", label: "股权关系与控制权" },
] as const;

function matterTopic(templateId: string): string | null {
  if (templateId.startsWith("PR-REG")) return "PTY2-T-REG";
  if (/^PR-(TRANSFER|FREE|CAPITAL|ASSET|LISTED)/.test(templateId)) return "PTY2-T-TRADE";
  return null;
}
import { indicatorById, type IndicatorDef } from "@/lib/metrics";
import { isRunnableDrawerIndicator } from "@/lib/indicator-scope";
import HoldingsTable from "@/components/fp/HoldingsTable";
import { entityName, holdingDiffNote, holdingRowsFor } from "@/lib/fp-display";
import { isOpen, isOverdueRectification, riskMatches } from "@/lib/risks";

export default function PropertyDomainView() {
  const { filters, user, catalog, risks } = useDemoStore();
  const [subjectId, setSubjectId] = useState(filters.orgId);
  const [subjectChildren, setSubjectChildren] = useState(filters.includeChildren);
  const [focusEntity, setFocusEntity] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "graph">("list");
  const [censusFilter, setCensusFilter] = useState<"N" | "C" | "P" | "T" | null>(null);
  const [topicId, setTopicId] = useState<string | null>("PTY2-T-REG");
  const [showEntities, setShowEntities] = useState(false);
  const [behavior, setBehavior] = useState<string>("nonlisted_transfer");
  const [lastTradeBehavior, setLastTradeBehavior] = useState<string>("nonlisted_transfer");
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [riskId, setRiskId] = useState<string | null>(null);
  const [objectId, setObjectId] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioSourceOpen, setScenarioSourceOpen] = useState(false);
  const [indicatorId, setIndicatorId] = useState<string | null>(null);

  const globalOrgIds = useMemo(
    () => intersectOrgScope(filters.orgId, filters.includeChildren, user),
    [filters.orgId, filters.includeChildren, user],
  );

  useEffect(() => {
    setSubjectId(filters.orgId);
    setSubjectChildren(filters.includeChildren);
    setFocusEntity(null);
    setRiskId(null);
    setObjectId(null);
    setScenarioId(null);
    setIndicatorId(null);
  }, [filters.orgId, filters.includeChildren, filters.periodStart, filters.periodEnd, filters.asOf, user?.id]);

  const pageOrgIds = useMemo(() => {
    const local = new Set(subjectChildren ? descendantOrgIds(subjectId) : [subjectId]);
    return new Set([...local].filter((id) => globalOrgIds.has(id)));
  }, [subjectId, subjectChildren, globalOrgIds]);

  const allowedObjectIds = useMemo(() => authorizedObjectIds(user), [user]);
  const census = useMemo(() => censusCounts(pageOrgIds, filters.asOf), [pageOrgIds, filters.asOf]);
  const matters = useMemo(() => openMatterCount(pageOrgIds), [pageOrgIds]);
  const themeMatters = useMemo(() => {
    return seed.property_matters.filter((matter) => pageOrgIds.has(matter.owner_org_id) && matterTopic(matter.template_id) === topicId);
  }, [pageOrgIds, topicId]);
  const overdueMatters = useMemo(() => {
    return themeMatters.filter((matter) => {
      const current = seed.lifecycle_instances.find((item) => item.object_id === matter.id && item.phase_id === matter.current_phase_id);
      return Boolean(
        current?.approved_plan_end &&
          current.approved_plan_end < filters.asOf &&
          current.business_status !== "completed" &&
          !current.actual_end,
      );
    });
  }, [themeMatters, filters.asOf]);
  const openRights = useMemo(
    () => risks.filter((item) => isOpen(item) && riskMatches(item, { domain: "RIGHTS", orgScope: pageOrgIds })),
    [risks, pageOrgIds],
  );
  const diffEntities = useMemo(
    () => census.list.filter((row) => holdingDiffNote(holdingRowsFor(row.entity.id))),
    [census.list],
  );

  const path = orgPath(subjectId).filter((o) => globalOrgIds.has(o.id) || o.id === filters.orgId);
  const gate = path.findIndex((o) => o.id === filters.orgId);
  const visiblePath = gate >= 0 ? path.slice(gate) : path;

  const censusKpiDefs = useMemo(() => {
    if (!canDomain(user, "RIGHTS")) return [];
    return (["PTY2-I01", "PTY2-I02", "PTY2-I03", "PTY2-I04"] as const)
      .map((id) => indicatorById(id))
      .filter((d): d is IndicatorDef => Boolean(d && isRunnableDrawerIndicator(d, "domain_page")));
  }, [user, catalog]);

  const openCensusIndicator = (id: string, filter: "N" | "C" | "P" | "T") => {
    setCensusFilter(filter);
    setIndicatorId(id);
  };

  const listEntities = useMemo(() => {
    let rows = census.list;
    if (censusFilter === "C") rows = rows.filter((x) => x.class === "controlled");
    if (censusFilter === "P") rows = rows.filter((x) => x.class === "participating");
    if (censusFilter === "N") rows = census.list;
    return rows;
  }, [census, censusFilter]);

  return (
    <div className="space-y-4">
      <PageHeader title="产权管理">
        <FilterBar />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="rights-subject-path">
        <span className="text-textsub">当前组织范围</span>
        {visiblePath.map((o, i) => (
          <span key={o.id} className="inline-flex items-center gap-2">
            {i > 0 && <span className="text-textsub">/</span>}
            <button
              type="button"
              className={o.id === subjectId ? "text-brand font-medium" : "text-textmain hover:text-brand"}
              onClick={() => {
                setSubjectId(o.id);
                setSubjectChildren(o.id === filters.orgId ? filters.includeChildren : true);
                setFocusEntity(null);
              }}
            >
              {o.name}
            </button>
          </span>
        ))}
        <Tag tone="brand">{subjectChildren ? "含下级" : "仅本级"}</Tag>
        <button
          type="button"
          className="h-7 px-2 rounded-[6px] border border-line text-[12px] hover:bg-tint"
          onClick={() => setSubjectChildren((v) => !v)}
        >
          切换{subjectChildren ? "仅本级" : "含下级"}
        </button>
        {focusEntity && (
          <>
            <Tag tone="amber">当前法人 {seed.legal_entities.find((e) => e.id === focusEntity)?.name ?? focusEntity}</Tag>
            <button type="button" className="h-7 px-2 rounded-[6px] border border-line text-[12px]" onClick={() => setFocusEntity(null)}>
              清除法人选择
            </button>
          </>
        )}
      </div>

      <Card title="产权监管范围">
        {canDomain(user, "RIGHTS") ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]" data-testid="rights-compact-stats">
            <span className="text-textsub">纳管法人 <span className="num text-textmain">{census.N}</span> 户</span>
            <button type="button" className="hover:text-brand" onClick={() => openCensusIndicator("PTY2-I04", "T")}>
              在办产权事项 <span className="num font-semibold">{matters.count}</span> 项
            </button>
            <span>
              当前主题计划逾期 <span className="num font-semibold">{overdueMatters.length}</span> 项
            </span>
            <span>
              持股来源待核查 <span className="num font-semibold">{diffEntities.length}</span> 户
            </span>
            <button type="button" className="hover:text-brand" onClick={() => openRights[0] && setRiskId(openRights[0].id)}>
              未关闭监管事项 <span className="num font-semibold">{openRights.length}</span> 件
              <span className="text-textsub">（逾期整改 {openRights.filter((item) => isOverdueRectification(item, filters.asOf)).length}）</span>
            </button>
            <button
              type="button"
              data-testid="rights-open-entities"
              className="h-8 px-3 rounded-[6px] border border-line text-[12px] hover:bg-tint"
              onClick={() => setShowEntities((value) => !value)}
            >
              {showEntities ? "收起法人及股权关系" : "查看法人及股权关系"}
            </button>
          </div>
        ) : (
          <p className="text-[13px] text-textsub">当前身份不能查看产权经营数据。</p>
        )}
        <p className="text-[12px] text-textsub mt-2">控制待核实 {census.U} 户。分支机构不算法人。股比差异先列入待核查，不直接认定违规或实际控制变化。</p>
        {showEntities && (
          <div className="mt-4" data-testid="rights-entity-panel">
        <div className="flex gap-2 mb-3">
          <button type="button" className={`h-8 px-3 rounded-[6px] border text-[12px] ${view === "list" ? "border-brand bg-tint text-brand" : "border-line"}`} onClick={() => setView("list")}>
            法人清单
          </button>
          <button type="button" className={`h-8 px-3 rounded-[6px] border text-[12px] ${view === "graph" ? "border-brand bg-tint text-brand" : "border-line"}`} onClick={() => setView("graph")}>
            股权关系
          </button>
        </div>

        {view === "list" ? (
          <DataTable
            rows={listEntities}
            rowKey={(r) => r.entity.id}
            onRowClick={(r) => {
              setFocusEntity(r.entity.id);
              setObjectId(r.entity.id);
            }}
            empty="当前组织范围内没有纳入产权管理的法人。"
            pageSize={8}
            columns={[
              { key: "name", title: "法人", minWidth: "180px", render: (r) => r.entity.name },
              { key: "id", title: "主体ID", width: "110px", render: (r) => <span className="num">{r.entity.id}</span> },
              {
                key: "class",
                title: "口径",
                width: "120px",
                render: (r) => ({ body: "海工本体", controlled: "控股及实控", participating: "参股", unverified: "控制待核实" }[r.class]),
              },
              { key: "own", title: "全资", width: "70px", render: (r) => (r.whollyOwned ? "是" : "否") },
              { key: "basis", title: "控制依据", minWidth: "180px", render: (r) => r.controlBasis || "—" },
              {
                key: "edge",
                title: "直接持股",
                render: (r) => {
                  const rows = holdingRowsFor(r.entity.id);
                  if (!rows.length) return "—";
                  return (
                    <ul className="space-y-1">
                      {rows.map((e) => (
                        <li key={e.id}>
                          {e.investorName} {e.pct}%
                          <span className="text-[12px] text-textsub"> ｜{e.source}｜基准日 {e.asOf}</span>
                        </li>
                      ))}
                    </ul>
                  );
                },
              },
            ]}
          />
        ) : (
          <EquityGraph orgIds={pageOrgIds} asOf={filters.asOf} focus={focusEntity} onFocus={(id) => { setFocusEntity(id); setObjectId(id); }} />
        )}
        {focusEntity && (
          <div className="mt-4 space-y-3">
            <HoldingsTable investeeId={focusEntity} title={`${entityName(focusEntity)}持股来源核对`} />
            <div className="text-[13px] text-textsub">
              穿透权益（完整无环路径乘积）：{" "}
              {penetratePaths(focusEntity)
                .map((p) => `${p.path.map((id) => entityName(id)).join("→")} ${(p.product * 100).toFixed(2)}%`)
                .join("；") || "链路不全，待核实"}
            </div>
          </div>
        )}
          </div>
        )}
      </Card>

      <ScenarioExecutionPanel
        domain="RIGHTS"
        directoryDomain="RIGHTS"
        topicId={topicId}
        behaviorId={topicId === "PTY2-T-TRADE" ? behavior : null}
        onTopicChange={(id) => {
          if (topicId === "PTY2-T-TRADE" && behavior && behavior !== "all") {
            setLastTradeBehavior(behavior);
          }
          setTopicId(id);
          setPhaseId(null);
          if (id === "PTY2-T-TRADE") {
            setBehavior(lastTradeBehavior || "nonlisted_transfer");
          }
          setScenarioId(null);
          setScenarioSourceOpen(false);
          setRiskId(null);
          if (objectId && objectId !== focusEntity) setObjectId(null);
        }}
        topicNavTestId="rights-topic-nav"
        allTopicTestId="rights-topic-all"
        allTopicLabel="全部场景（10）"
        topicOptions={RIGHTS_THEMES.map((t) => ({ id: t.id, label: t.label, testId: `rights-topic-${t.id}` }))}
        phaseId={null}
        orgIds={pageOrgIds}
        allowedObjectIds={allowedObjectIds}
        scopeTitle={topicId ? (RIGHTS_THEMES.find((t) => t.id === topicId)?.label ?? "产权") : "全部场景（10）"}
        toolbarExtra={
          <div data-testid="rights-theme-facts">
            <RightsThemeFacts topicId={topicId} matters={themeMatters} asOf={filters.asOf} onOpenObject={setObjectId} />
            {topicId === "PTY2-T-TRADE" ? (
              <div className="flex flex-wrap items-center gap-2 mt-3" data-testid="rights-trade-filter">
                <span className="text-[12px] text-textsub">经济行为</span>
                <select
                  data-testid="rights-behavior-select"
                  aria-label="经济行为"
                  className="h-8 px-3 rounded-[6px] border border-line bg-surface text-[12px] min-w-[200px]"
                  value={behavior}
                  onChange={(e) => {
                    const next = e.target.value;
                    setBehavior(next);
                    setPhaseId(null);
                    if (next !== "all") setLastTradeBehavior(next);
                    setScenarioId(null);
                    setRiskId(null);
                  }}
                >
                  <option value="all">全部</option>
                  {ECONOMIC_BEHAVIORS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
                {behavior === "free_transfer" && <Tag tone="neutral">无偿划转无价款，不生成价款逾期</Tag>}
                {behavior === "listed_shares" && <Tag tone="neutral">上市股份模板，不套非上市挂牌</Tag>}
              </div>
            ) : null}
          </div>
        }
        onOpenRisk={setRiskId}
        onOpenObject={setObjectId}
        onOpenScenario={(id, source) => {
          setScenarioSourceOpen(Boolean(source));
          setScenarioId(id);
        }}
      />

      <IndicatorDrawer
        open={Boolean(indicatorId)}
        onClose={() => setIndicatorId(null)}
        indicator={indicatorId ? indicatorById(indicatorId) ?? null : null}
        indicatorOptions={censusKpiDefs}
        onSwitchIndicator={setIndicatorId}
        allowIndicatorSwitch
        drawerEntry="domain_page"
        initialOrgId={subjectId}
        includeChildren={subjectChildren}
        scopeLabel={`${orgName(subjectId)}｜${filters.asOf}`}
        onOpenObject={setObjectId}
        onOpenRisk={setRiskId}
      />
      <RiskCaseDrawer riskId={riskId} onClose={() => setRiskId(null)} sourceLabel="产权管理" />
      <ScenarioDrawer
        scenarioId={scenarioId}
        sourceOpen={scenarioSourceOpen}
        onClose={() => {
          setScenarioId(null);
          setScenarioSourceOpen(false);
        }}
        onOpenRisk={(id) => {
          setScenarioId(null);
          setRiskId(id);
        }}
        onOpenObject={(id) => {
          setScenarioId(null);
          setObjectId(id);
        }}
      />
      <ObjectDrawer objectId={objectId} onClose={() => setObjectId(null)} onOpenRisk={setRiskId} onOpenObject={setObjectId} />
    </div>
  );
}

function RightsThemeFacts({
  topicId,
  matters,
  asOf,
  onOpenObject,
}: {
  topicId: string | null;
  matters: PropertyMatter[];
  asOf: string;
  onOpenObject: (id: string) => void;
}) {
  const sample = holdingRowsFor("JV001");
  const sampleNote = holdingDiffNote(sample);
  const showHoldings = topicId === "PTY2-T-REG" || topicId === "PTY2-T-CONTROL" || topicId === null;
  return (
    <div className="space-y-2 text-[13px]">
      {topicId === "PTY2-T-IDENTITY" && (
        <p className="text-textsub">当前样例没有单独的标识办理台账。下方仍按已配置场景展示规则执行结果，不补造应办理数量。</p>
      )}
      {topicId === "PTY2-T-CONTROL" && (
        <p className="text-textsub">持股比例差异只作为待核查线索。专业核查结论以事项和材料为准，不因信息不一致直接定性违规或虚假控股。</p>
      )}
      {matters.length > 0 ? (
        <ul className="space-y-1">
          {matters.slice(0, 4).map((matter) => {
            const current = seed.lifecycle_instances.find((item) => item.object_id === matter.id && item.phase_id === matter.current_phase_id);
            const node = seed.lifecycle_templates
              .find((item) => item.id === matter.template_id)
              ?.phase_nodes.find((item) => item.id === matter.current_phase_id);
            return (
              <li key={matter.id}>
                <button type="button" className="text-brand hover:underline" onClick={() => onOpenObject(matter.investee_id)}>
                  {entityName(matter.investee_id)}
                </button>
                <span className="text-textsub">
                  {" "}
                  {matter.name}｜{node?.name ?? matter.current_phase_id}
                  {current?.approved_plan_end ? `｜计划完成 ${current.approved_plan_end}` : ""}
                  {current?.approved_plan_end && current.approved_plan_end < asOf && !current.actual_end ? "｜计划日已过" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        topicId !== "PTY2-T-IDENTITY" && <p className="text-textsub">当前主题没有映射到的产权事项台账，场景规则仍按配置目录展示。</p>
      )}
      {showHoldings && sample.length > 0 && (
        <div data-testid="rights-holding-sample">
          <p className="text-textsub mb-1">{entityName("JV001")}持股来源对照。差异先待核查。</p>
          <ul className="space-y-1">
            {sample.map((row) => (
              <li key={row.id}>
                {row.source} <span className="num">{row.pct}%</span>
                <span className="text-textsub">｜生效日 {row.effectiveDate}｜基准日 {row.asOf}</span>
              </li>
            ))}
          </ul>
          {sampleNote && <p className="text-[12px] text-textsub mt-1">{sampleNote}</p>}
        </div>
      )}
    </div>
  );
}

function EquityGraph({
  orgIds,
  asOf,
  focus,
  onFocus,
}: {
  orgIds: Set<string>;
  asOf: string;
  focus: string | null;
  onFocus: (id: string) => void;
}) {
  const { list } = censusCounts(orgIds, asOf);
  const ids = new Set(list.map((x) => x.entity.id));
  ids.add("LE-HQ");
  const edges = seed.ownership_snapshots.filter((s) => ids.has(s.investor_id) && ids.has(s.investee_id));
  const unique = new Map<string, typeof edges>();
  for (const e of edges) {
    const k = `${e.investor_id}->${e.investee_id}`;
    unique.set(k, [...(unique.get(k) ?? []), e]);
  }
  return (
    <div className="border border-line rounded-[8px] p-4 overflow-x-auto">
      <div className="min-w-[640px] space-y-3">
        {[...unique.entries()].map(([k, snaps]) => {
          const [from, to] = k.split("->");
          const fromName = seed.legal_entities.find((e) => e.id === from)?.name ?? from;
          const toName = seed.legal_entities.find((e) => e.id === to)?.name ?? to;
          const selected = focus === from || focus === to;
          const pcts = snaps.map((s) => s.pct);
          const diff = Math.max(...pcts) - Math.min(...pcts);
          return (
            <div key={k} className={`space-y-1 ${selected ? "bg-tint rounded-[6px] px-2 py-1" : ""}`}>
              {snaps.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <button type="button" className="text-brand hover:underline" onClick={() => onFocus(from)}>
                    {fromName}
                  </button>
                  <span className="text-textsub">→</span>
                  <button type="button" className="text-brand hover:underline" onClick={() => onFocus(to)}>
                    {toName}
                  </button>
                  <span className="num">{s.pct}%</span>
                  <span className="text-textsub">来源 {s.source_type.includes("批准") ? "有效批准方案" : s.source_type.includes("工商") ? "工商登记" : s.source_type.includes("台账") ? "产权台账" : s.source_type}</span>
                  <span className="num text-textsub">生效日 {s.effective_date}</span>
                  <span className="num text-textsub">基准日 {s.snapshot_date}</span>
                </div>
              ))}
              {diff > 0 && <Tag tone="amber">差异待核实 {diff} 个百分点</Tag>}
            </div>
          );
        })}
        {unique.size === 0 && <p className="text-textsub text-[13px]">当前范围没有可见持股边。</p>}
      </div>
      <p className="text-[12px] text-textsub mt-3">同一法人多条出资边共享一个主体ID。展开关系或点击边不扩大授权。</p>
    </div>
  );
}
