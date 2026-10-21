"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import IndicatorDrawer, { formatMetricParts } from "@/components/IndicatorDrawer";
import ObjectDrawer from "@/components/ObjectDrawer";
import OrgPanorama from "@/components/OrgPanorama";
import RiskCaseDrawer from "@/components/RiskCaseDrawer";
import ScenarioDrawer from "@/components/ScenarioDrawer";
import FilterBar from "@/components/FilterBar";
import PageHeader from "@/components/PageHeader";
import { Card, DataTable, KpiCard, Modal, Notice } from "@/components/ui";
import { IconAlert, IconClipboard, IconLayers, IconOverview, DOMAIN_ICONS } from "@/components/icons";
import { DOMAIN_META, objectTypeLabel, scenarioName, seed } from "@/lib/seed";
import { isRetiredSupervisionDomain } from "@/lib/supervision-scope";
import { indicatorById } from "@/lib/metrics";
import { orgName, orgUnitTypeLabel, orgById, orgFilterCaption, ROOT_ORG_ID } from "@/lib/org";
import { authorizedObjectIds, authorizedOrgIds, can, canDomain, intersectOrgScope, riskVisible } from "@/lib/config";
import { liveRuleLabel } from "@/lib/live-config";
import { findObject } from "@/lib/objects";
import { statusLabel } from "@/lib/risks";
import { fmtAmountSmart } from "@/lib/format";
import { useDemoStore } from "@/lib/store";
import type { DomainId, RiskCase } from "@/lib/types";
import {
  completedRectificationCases,
  hitObjectsByType,
  hitOrgMetric,
  hitRuleIds,
  includesHeadquarters,
  inScopeProjects,
  managedOrganizations,
  managedOrgCount,
  monitorStatusLabel,
  openRectificationCases,
  orgMonitorStatus,
  overdueRectificationCases,
  overviewDomainCards,
  relatedObjects,
  showsHitCount,
  validHitRecords,
  type DomainCardModel,
  type HitRecord,
  type MetricSlot,
  type OrgMonitorStatus,
  type OverviewProjectRow,
  type OverviewScope,
} from "@/lib/overview";

type CaseQuery =
  | { title: string; mode: "open-rectification"; orgIds?: Set<string>; domain?: DomainId }
  | { title: string; mode: "overdue-rectification"; orgIds?: Set<string>; domain?: DomainId }
  | { title: string; mode: "completed-rectification"; orgIds?: Set<string> }
  | { title: string; mode: "ids"; ids: string[] };

type ObjectQuery =
  | { title: string; mode: "projects"; orgIds: Set<string>; focusOrgId: string; includeChildren: boolean }
  | { title: string; mode: "related"; orgIds: Set<string> }
  | { title: string; mode: "ids"; ids: string[] };

type UnitQuery = { title: string; orgIds: Set<string>; hitOnly?: boolean };

function metricValueText(slot: MetricSlot): { value: string; unit: string } {
  if (slot.status !== "ok" || !slot.def || !slot.metric) return { value: "—", unit: "" };
  if (slot.display === "numerator") {
    return { value: fmtAmountSmart(slot.metric.numerator), unit: slot.def.unit === "%" ? "万元" : slot.def.unit };
  }
  return formatMetricParts(slot.def, slot.metric);
}

function hitListSubtitle(scope: OverviewScope, domain: DomainId | undefined, scopeLabel: string): string {
  const status = orgMonitorStatus(scope.orgIds, scope, domain);
  if (!showsHitCount(status)) {
    return `来源范围：${scopeLabel}｜${monitorStatusLabel[status]}`;
  }
  const n = hitRuleIds(scope, domain).length;
  const extra = status === "partial" ? "｜部分完成" : "";
  return `来源范围：${scopeLabel}｜命中规则 ${n} 条，不按运行次数累加${extra}`;
}

function scenariosForRule(ruleId: string): string[] {
  const fromRisk = seed.risk_cases.filter((r) => r.rule_id === ruleId).flatMap((r) => r.scenario_ids);
  const fromCov = seed.scenario_monitoring_coverage.filter((r) => r.rule_ids?.includes(ruleId)).map((r) => r.scenario_id);
  return [...new Set([...fromRisk, ...fromCov])];
}

export default function OverviewPage() {
  const { filters, risks, actions, setFilters, user, catalog } = useDemoStore();
  const [riskId, setRiskId] = useState<string | null>(null);
  const [indicatorId, setIndicatorId] = useState<string | null>(null);
  const [objectId, setObjectId] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [caseScope, setCaseScope] = useState<CaseQuery | null>(null);
  const [objectScope, setObjectScope] = useState<ObjectQuery | null>(null);
  const [unitScope, setUnitScope] = useState<UnitQuery | null>(null);
  const [hitList, setHitList] = useState<{ title: string; orgIds: Set<string>; domain?: DomainId } | null>(null);
  const [projectType, setProjectType] = useState<string>("all");
  const listScrollRef = useRef(0);

  const orgIds = useMemo(
    () => intersectOrgScope(filters.orgId, filters.includeChildren, user),
    [filters.orgId, filters.includeChildren, user],
  );
  const authOrgs = useMemo(() => authorizedOrgIds(user), [user]);

  const ctx = useMemo(
    () => ({
      periodStart: filters.periodStart,
      periodEnd: filters.periodEnd,
      asOf: filters.asOf,
      risks,
      allowedObjectIds: authorizedObjectIds(user),
    }),
    [filters.periodStart, filters.periodEnd, filters.asOf, risks, user],
  );

  const visibleRisks = useMemo(() => risks.filter((r) => riskVisible(user, r)), [risks, user]);

  const overviewScope: OverviewScope = useMemo(
    () => ({
      orgIds,
      authorizedOrgIds: authOrgs,
      allowedObjectIds: ctx.allowedObjectIds ?? null,
      risks: visibleRisks,
      actions,
      asOf: filters.asOf,
      periodStart: filters.periodStart,
      periodEnd: filters.periodEnd,
      ctx,
    }),
    [orgIds, authOrgs, ctx, visibleRisks, actions, filters.asOf, filters.periodStart, filters.periodEnd],
  );

  const unitRows = useMemo(() => managedOrganizations(orgIds), [orgIds]);
  const projectRows = useMemo(
    () => inScopeProjects(orgIds, overviewScope.allowedObjectIds, filters.periodStart, filters.periodEnd, filters.asOf),
    [orgIds, overviewScope.allowedObjectIds, filters.periodStart, filters.periodEnd, filters.asOf],
  );
  const openRect = useMemo(() => openRectificationCases(overviewScope), [overviewScope]);
  const overdueRect = useMemo(() => overdueRectificationCases(overviewScope), [overviewScope]);
  const completedRect = useMemo(() => completedRectificationCases(overviewScope), [overviewScope]);
  const hitMetric = useMemo(() => hitOrgMetric(overviewScope), [overviewScope]);
  const hitOrgs = hitMetric.orgIds;

  const domainCards = useMemo(
    () => overviewDomainCards(overviewScope, (d) => canDomain(user, d)),
    [overviewScope, user, catalog],
  );

  const scopeLabel = `${orgName(filters.orgId)}${filters.includeChildren ? "（含下级）" : "（仅本级）"}｜${filters.periodStart}~${filters.periodEnd}`;

  useEffect(() => {
    setCaseScope(null);
    setObjectScope(null);
    setUnitScope(null);
    setHitList(null);
    setRiskId(null);
    setIndicatorId(null);
    setObjectId(null);
    setScenarioId(null);
    setProjectType("all");
  }, [filters.orgId, filters.includeChildren, filters.periodStart, filters.periodEnd, filters.asOf, user?.id]);

  const openOverlay = () => {
    listScrollRef.current = typeof window !== "undefined" ? window.scrollY : 0;
  };
  const restoreScroll = () => {
    const y = listScrollRef.current;
    requestAnimationFrame(() => window.scrollTo(0, y));
  };

  const scoped = (ids?: Set<string>): OverviewScope => (ids ? { ...overviewScope, orgIds: ids } : overviewScope);

  const caseRows: RiskCase[] = (() => {
    if (!caseScope) return [];
    if (caseScope.mode === "open-rectification") return openRectificationCases(scoped(caseScope.orgIds), caseScope.domain);
    if (caseScope.mode === "overdue-rectification")
      return overdueRectificationCases(scoped(caseScope.orgIds), caseScope.domain);
    if (caseScope.mode === "completed-rectification") return completedRectificationCases(scoped(caseScope.orgIds));
    return caseScope.ids.map((id) => visibleRisks.find((r) => r.id === id)).filter((r): r is RiskCase => Boolean(r));
  })();

  const objectOrgIds = objectScope && "orgIds" in objectScope ? objectScope.orgIds : orgIds;
  const rawObjectRows =
    objectScope?.mode === "projects"
      ? inScopeProjects(
          objectOrgIds,
          overviewScope.allowedObjectIds,
          filters.periodStart,
          filters.periodEnd,
          filters.asOf,
        )
      : objectScope?.mode === "related"
        ? relatedObjects(
            objectOrgIds,
            overviewScope.allowedObjectIds,
            filters.periodStart,
            filters.periodEnd,
            filters.asOf,
          )
        : objectScope?.mode === "ids"
          ? objectScope.ids.map((id) => {
              const obj = findObject(id);
              return {
                id,
                name: obj?.name ?? id,
                orgId: obj?.orgId ?? "",
                kind: (obj?.type ?? "object") as OverviewProjectRow["kind"] | "asset" | "object",
                projectType: obj?.typeLabel ?? "",
                status: "",
              };
            })
          : [];
  const objectRows =
    objectScope?.mode === "projects" && projectType !== "all"
      ? rawObjectRows.filter((r) => "kind" in r && r.kind === projectType)
      : rawObjectRows;

  const selectUnit = (orgId: string) => {
    setFilters({ orgId, includeChildren: true });
  };

  const unitTableIds = unitScope?.hitOnly ? hitOrgs : unitRows.map((o) => o.id);
  const hitScope = hitList ? scoped(hitList.orgIds) : overviewScope;
  const hitListStatus = hitList ? orgMonitorStatus(hitScope.orgIds, hitScope, hitList.domain) : hitMetric.status;
  const hitRows = hitList && showsHitCount(hitListStatus) ? validHitRecords(hitScope, hitList.domain) : [];

  return (
    <div className="space-y-4">
      {!can(user, "business.read") && (
        <Notice tone="amber" title="当前身份无业务数据权限">
          配置维护权限不自动带来业务数据。请切换总部或单位监管身份查看指标与事项，或进入系统配置。
        </Notice>
      )}

      <PageHeader title="综合总览">
        <FilterBar />
      </PageHeader>

      <section className="space-y-3">
        <h2 className="text-[16px] font-semibold text-textmain">监管主体全景</h2>
        <div className="reg-kpis">
          <KpiCard
            name="纳管单位数"
            value={managedOrgCount(orgIds)}
            unit="家"
            compare={includesHeadquarters(orgIds) ? "含当前单位及授权范围内下属" : "当前组织范围"}
            icon={<IconOverview size={20} />}
            scopeLabel={scopeLabel}
            onOpen={() => {
              openOverlay();
              setUnitScope({ title: "纳管单位", orgIds });
            }}
            returnKey="kpi-units"
          />
          <KpiCard
            name="纳管项目数"
            value={projectRows.length}
            unit="个"
            compare="投资项目与工程项目去重"
            icon={<IconLayers size={20} />}
            scopeLabel={scopeLabel}
            onOpen={() => {
              openOverlay();
              setProjectType("all");
              setObjectScope({
                title: `纳管项目｜${orgFilterCaption(filters.orgId, filters.includeChildren)}`,
                mode: "projects",
                orgIds,
                focusOrgId: filters.orgId,
                includeChildren: filters.includeChildren,
              });
            }}
            returnKey="kpi-projects"
          />
          <KpiCard
            name="规则命中涉及单位数"
            value={hitMetric.display}
            unit={hitMetric.display === "—" ? undefined : "家"}
            compare={hitMetric.caption}
            icon={<IconClipboard size={20} />}
            scopeLabel={scopeLabel}
            onOpen={() => {
              openOverlay();
              setUnitScope({ title: "规则命中涉及单位", orgIds, hitOnly: true });
            }}
            returnKey="kpi-hit-orgs"
          />
          <div
            className="text-left bg-surface border border-line rounded-[10px] px-5 py-[18px] min-h-[168px] h-full flex gap-3.5 shadow-[0_2px_10px_rgba(17,43,77,0.04)]"
            title={scopeLabel}
          >
            <span
              className="shrink-0 w-10 h-10 rounded-[8px] flex items-center justify-center"
              style={{ background: "var(--risk-red-bg)", color: "var(--risk-red-fg)" }}
            >
              <IconAlert size={20} />
            </span>
            <span className="min-w-0 flex-1 flex flex-col h-full">
              <button
                type="button"
                className="text-[13px] text-textsub leading-5 text-left hover:text-brand"
                data-overlay-return="kpi-open-rect"
                onClick={() => {
                  openOverlay();
                  setCaseScope({ title: "未关闭整改事项", mode: "open-rectification" });
                }}
              >
                未关闭整改事项数
              </button>
              <button
                type="button"
                className="mt-2 flex h-10 items-end gap-1 text-left"
                style={{ color: "var(--risk-red-fg)" }}
                data-overlay-return="kpi-open-rect-num"
                onClick={() => {
                  openOverlay();
                  setCaseScope({ title: "未关闭整改事项", mode: "open-rectification" });
                }}
              >
                <span className="num text-[32px] font-semibold leading-none">{openRect.length}</span>
                <span className="text-[14px] text-textsub mb-0.5">件</span>
              </button>
              <span className="text-[12px] text-textsub mt-1 leading-4">
                由截至日明细计算，待核查不计；晚于截至日的办理不改写历史。
              </span>
              <span className="mt-auto pt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                <button
                  type="button"
                  className="text-left hover:underline"
                  data-overlay-return="kpi-completed-rect"
                  onClick={() => {
                    openOverlay();
                    setCaseScope({ title: "本期完成整改", mode: "completed-rectification" });
                  }}
                >
                  本期完成整改 {completedRect.length} 件
                </button>
                <button
                  type="button"
                  className="text-left hover:underline"
                  style={{ color: overdueRect.length ? "var(--risk-red-fg)" : "var(--text-sub)" }}
                  data-overlay-return="kpi-overdue-rect"
                  onClick={() => {
                    openOverlay();
                    setCaseScope({ title: "逾期整改", mode: "overdue-rectification" });
                  }}
                >
                  逾期整改 {overdueRect.length} 件
                </button>
              </span>
            </span>
          </div>
        </div>

        <Card title="所属单位监管情况">
          <OrgPanorama
            selectedOrgId={authOrgs.has(filters.orgId) ? filters.orgId : [...authOrgs][0] ?? ROOT_ORG_ID}
            authorizedOrgIds={authOrgs}
            scope={overviewScope}
            onSelect={selectUnit}
            onReturnHq={() => selectUnit(ROOT_ORG_ID)}
            onOpenProjects={(ids, meta) => {
              openOverlay();
              setProjectType("all");
              setObjectScope({
                title: `纳管项目｜${orgFilterCaption(meta.orgId, meta.includeChildren)}`,
                mode: "projects",
                orgIds: ids,
                focusOrgId: meta.orgId,
                includeChildren: meta.includeChildren,
              });
            }}
            onOpenRules={(ids) => {
              openOverlay();
              setHitList({ title: "命中规则", orgIds: ids });
            }}
            onOpenRectification={(ids) => {
              openOverlay();
              setCaseScope({ title: "未关闭整改事项", mode: "open-rectification", orgIds: ids });
            }}
            onOpenRelated={(ids) => {
              openOverlay();
              setObjectScope({ title: "关联项目与资产", mode: "related", orgIds: ids });
            }}
          />
        </Card>
      </section>

      <section>
        <h2 className="text-[16px] font-semibold text-textmain mb-3">专项领域监管概况</h2>
        <div className="reg-domains">
          {domainCards.map((card) => (
            <DomainOverviewCard
              key={card.domain}
              card={card}
              onOpenIndicator={(id) => {
                openOverlay();
                setIndicatorId(id);
              }}
              onOpenHits={() => {
                openOverlay();
                setHitList({ title: `${DOMAIN_META[card.domain].label}监测结果`, orgIds, domain: card.domain });
              }}
              onOpenRectification={() => {
                openOverlay();
                setCaseScope({
                  title: `${DOMAIN_META[card.domain].label}未关闭整改`,
                  mode: "open-rectification",
                  domain: card.domain,
                });
              }}
              onOpenOverdue={() => {
                openOverlay();
                setCaseScope({
                  title: `${DOMAIN_META[card.domain].label}逾期整改`,
                  mode: "overdue-rectification",
                  domain: card.domain,
                });
              }}
            />
          ))}
        </div>
      </section>

      <Modal
        open={Boolean(caseScope)}
        onClose={() => {
          setCaseScope(null);
          restoreScroll();
        }}
        title={caseScope?.title ?? "事项清单"}
        subtitle={`来源范围：${scopeLabel}｜截至日 ${filters.asOf}｜共 ${caseRows.length} 条`}
        width={920}
      >
        <DataTable
          rows={caseRows}
          rowKey={(r) => r.id}
          onRowClick={(r) => setRiskId(r.id)}
          empty="该范围内没有事项。"
          compactEmpty
          columns={[
            { key: "title", title: "名称", render: (r) => r.title },
            { key: "status", title: "状态", width: "100px", nowrap: true, render: (r) => statusLabel[r.status] },
            { key: "org", title: "主责单位", width: "150px", nowrap: true, render: (r) => orgName(r.owner_org_id) },
            {
              key: "due",
              title: "整改期限",
              width: "120px",
              nowrap: true,
              render: (r) => r.rectification_plan?.due_date ?? r.current_task_due_date ?? "缺期限",
            },
            {
              key: "domains",
              title: "涉及领域",
              width: "168px",
              nowrap: true,
              render: (r) => r.domains.filter((d) => !isRetiredSupervisionDomain(d)).map((d) => DOMAIN_META[d].short).join("、"),
            },
            {
              key: "act",
              title: "操作",
              width: "88px",
              align: "right",
              nowrap: true,
              render: (r) => (
                <button
                  type="button"
                  className="text-[13px] text-brand hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRiskId(r.id);
                  }}
                >
                  查看详情
                </button>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={Boolean(unitScope)}
        onClose={() => {
          setUnitScope(null);
          restoreScroll();
        }}
        title={unitScope?.title ?? "单位清单"}
        subtitle={
          unitScope?.hitOnly && !showsHitCount(hitMetric.status)
            ? `来源范围：${scopeLabel}｜${hitMetric.caption}`
            : `来源范围：${scopeLabel}｜共 ${unitTableIds.length} 家`
        }
        width={720}
      >
        <DataTable
          rows={unitTableIds.map((id) => ({ id }))}
          rowKey={(r) => r.id}
          pageSize={12}
          empty={
            unitScope?.hitOnly && !showsHitCount(hitMetric.status)
              ? `当前范围、期间及截至日内，没有适用的监测执行记录：${hitMetric.caption}。`
              : "当前范围没有单位。"
          }
          compactEmpty
          columns={[
            { key: "name", title: "单位", render: (r) => orgName(r.id) },
            {
              key: "type",
              title: "类型",
              width: "110px",
              nowrap: true,
              render: (r) => {
                const org = orgById(r.id);
                return org ? orgUnitTypeLabel(org) : "单位";
              },
            },
            {
              key: "n",
              title: unitScope?.hitOnly ? "命中规则" : "本级纳管项目数",
              width: "128px",
              nowrap: true,
              render: (r) => {
                if (unitScope?.hitOnly) {
                  return hitRuleIds({ ...overviewScope, orgIds: new Set([r.id]) }).length;
                }
                const n = inScopeProjects(
                  new Set([r.id]),
                  overviewScope.allowedObjectIds,
                  filters.periodStart,
                  filters.periodEnd,
                  filters.asOf,
                ).length;
                return (
                  <button
                    type="button"
                    className="text-brand hover:underline num"
                    onClick={() => {
                      setProjectType("all");
                      setObjectScope({
                        title: `本级纳管项目｜${orgFilterCaption(r.id, false)}`,
                        mode: "projects",
                        orgIds: new Set([r.id]),
                        focusOrgId: r.id,
                        includeChildren: false,
                      });
                    }}
                  >
                    {n}
                  </button>
                );
              },
            },
            {
              key: "act",
              title: "操作",
              width: "120px",
              align: "right",
              nowrap: true,
              render: (r) =>
                unitScope?.hitOnly ? (
                  <button
                    type="button"
                    className="text-[13px] text-brand hover:underline"
                    onClick={() => {
                      setHitList({ title: `${orgName(r.id)}命中规则与对象`, orgIds: new Set([r.id]) });
                    }}
                  >
                    查看命中
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-[13px] text-brand hover:underline"
                    onClick={() => setObjectScope({ title: `${orgName(r.id)}关联对象`, mode: "related", orgIds: new Set([r.id]) })}
                  >
                    关联对象
                  </button>
                ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={Boolean(objectScope)}
        onClose={() => {
          setObjectScope(null);
          restoreScroll();
        }}
        title={objectScope?.title ?? "对象清单"}
        subtitle={`来源范围：${
          objectScope && "focusOrgId" in objectScope
            ? orgFilterCaption(objectScope.focusOrgId, objectScope.includeChildren)
            : objectScope && "orgIds" in objectScope && objectScope.orgIds.size === 1
              ? orgFilterCaption([...objectScope.orgIds][0], false)
              : scopeLabel.split("｜")[0]
        }｜截至日 ${filters.asOf}｜共 ${objectRows.length} 条`}
        width={800}
      >
        {objectScope?.mode === "projects" && (
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              ["all", "全部"],
              ["fixed_asset_project", "投资项目"],
              ["engineering_project", "工程项目"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`text-[13px] rounded-full px-3 py-1 border ${projectType === id ? "border-brand text-brand" : "border-line text-textsub"}`}
                onClick={() => setProjectType(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <DataTable
          rows={objectRows}
          rowKey={(r) => r.id}
          pageSize={12}
          onRowClick={(r) => setObjectId(r.id)}
          empty="当前范围没有关联对象。"
          compactEmpty
          columns={[
            { key: "name", title: "名称", render: (r) => r.name },
            {
              key: "kind",
              title: "类型",
              width: "140px",
              nowrap: true,
              render: (r) =>
                "kind" in r
                  ? r.kind === "fixed_asset_project"
                    ? "固定资产投资项目"
                    : r.kind === "equity_project"
                      ? "股权投资项目"
                      : r.kind === "engineering_project"
                        ? "工程项目"
                        : r.kind === "asset"
                          ? "资产"
                          : "对象"
                  : "对象",
            },
            {
              key: "org",
              title: "归属单位",
              width: "150px",
              nowrap: true,
              render: (r) => ("orgId" in r && r.orgId ? orgName(r.orgId) : "—"),
            },
            {
              key: "act",
              title: "操作",
              width: "88px",
              align: "right",
              nowrap: true,
              render: (r) => (
                <button
                  type="button"
                  className="text-[13px] text-brand hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setObjectId(r.id);
                  }}
                >
                  查看档案
                </button>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={Boolean(hitList)}
        onClose={() => {
          setHitList(null);
          restoreScroll();
        }}
        title={hitList?.title ?? "监测结果"}
        subtitle={hitListSubtitle(hitScope, hitList?.domain, scopeLabel)}
        width={920}
      >
        <HitResultPanel
          hits={hitRows}
          monitorStatus={hitListStatus}
          onOpenObject={setObjectId}
          onOpenScenario={setScenarioId}
        />
      </Modal>

      <IndicatorDrawer
        open={Boolean(indicatorId)}
        onClose={() => {
          setIndicatorId(null);
          restoreScroll();
        }}
        indicator={indicatorId ? indicatorById(indicatorId) ?? null : null}
        indicatorOptions={[]}
        onSwitchIndicator={() => undefined}
        allowIndicatorSwitch={false}
        initialOrgId={filters.orgId}
        includeChildren={filters.includeChildren}
        scopeLabel={scopeLabel}
        onOpenObject={setObjectId}
        onOpenRisk={setRiskId}
      />
      <ObjectDrawer objectId={objectId} onClose={() => setObjectId(null)} onOpenRisk={setRiskId} />
      <RiskCaseDrawer riskId={riskId} onClose={() => setRiskId(null)} sourceLabel="综合总览" />
      <ScenarioDrawer scenarioId={scenarioId} onClose={() => setScenarioId(null)} onOpenRisk={setRiskId} onOpenObject={setObjectId} />
    </div>
  );
}

function HitResultPanel({
  hits,
  monitorStatus,
  onOpenObject,
  onOpenScenario,
}: {
  hits: HitRecord[];
  monitorStatus: OrgMonitorStatus;
  onOpenObject: (id: string) => void;
  onOpenScenario: (id: string) => void;
}) {
  const byType = hitObjectsByType(hits);
  const rules = [...new Set(hits.map((h) => h.ruleId))];
  const scenarios = [...new Set(hits.flatMap((h) => scenariosForRule(h.ruleId)))];
  const emptyNote =
    monitorStatus === "not_started"
      ? "当前范围、期间及截至日内，没有适用的监测执行记录。"
      : monitorStatus === "unevaluated"
        ? "已有监测对象，但尚未形成评估结论。"
        : monitorStatus === "uncovered"
          ? "当前范围存在明确的数据未覆盖记录。"
          : monitorStatus === "pending"
            ? "适用性尚未确认，不计入已开展监测。"
            : monitorStatus === "no_business"
              ? "当前范围无业务。"
              : "已运行监测，没有命中。";
  return (
    <div className="space-y-4">
      {!showsHitCount(monitorStatus) && (
        <p className="text-[13px] text-textsub">
          {emptyNote}状态：{monitorStatusLabel[monitorStatus]}。
        </p>
      )}
      <div>
        <h3 className="text-[14px] font-medium mb-2">命中规则</h3>
        {rules.length === 0 ? (
          <p className="text-[13px] text-textsub">
            {showsHitCount(monitorStatus) ? "已运行监测，没有命中。" : emptyNote}
          </p>
        ) : (
          <ul className="text-[13px] space-y-1">
            {rules.map((id) => (
              <li key={id}>{liveRuleLabel(id)}</li>
            ))}
          </ul>
        )}
      </div>
      {scenarios.length > 0 && (
        <div>
          <h3 className="text-[14px] font-medium mb-2">监管子场景</h3>
          <div className="flex flex-wrap gap-2">
            {scenarios.map((id) => (
              <button key={id} type="button" className="text-[13px] text-brand hover:underline" onClick={() => onOpenScenario(id)}>
                {scenarioName(id)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <h3 className="text-[14px] font-medium mb-2">命中对象（按类型分列）</h3>
        {byType.length === 0 ? (
          <p className="text-[13px] text-textsub">没有可展示的命中对象。</p>
        ) : (
          byType.map((group) => (
            <div key={group.type} className="mb-3">
              <div className="text-[13px] text-textsub mb-1">
                {objectTypeLabel[group.type] ?? group.type} {group.objects.length}
              </div>
              <DataTable
                rows={group.objects}
                rowKey={(r) => `${r.ruleId}-${r.objectId}`}
                compactEmpty
                columns={[
                  { key: "name", title: "对象", render: (r) => findObject(r.objectId)?.name ?? r.objectId },
                  { key: "org", title: "归属单位", width: "140px", nowrap: true, render: (r) => orgName(r.orgId) },
                  { key: "rule", title: "规则", width: "160px", nowrap: true, render: (r) => r.ruleId },
                  {
                    key: "act",
                    title: "操作",
                    width: "88px",
                    align: "right",
                    nowrap: true,
                    render: (r) => (
                      <button type="button" className="text-[13px] text-brand hover:underline" onClick={() => onOpenObject(r.objectId)}>
                        查看档案
                      </button>
                    ),
                  },
                ]}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DomainOverviewCard({
  card,
  onOpenIndicator,
  onOpenHits,
  onOpenRectification,
  onOpenOverdue,
}: {
  card: DomainCardModel;
  onOpenIndicator: (id: string) => void;
  onOpenHits: () => void;
  onOpenRectification: () => void;
  onOpenOverdue: () => void;
}) {
  const meta = DOMAIN_META[card.domain];
  const Icon = DOMAIN_ICONS[card.domain];
  return (
    <article className="reg-domain-card bg-surface border border-line rounded-[10px] shadow-[0_2px_10px_rgba(17,43,77,0.04)] p-5">
      <div className="flex items-center justify-between gap-2 min-h-8">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-[8px] bg-[#EAF1FD] text-brand flex items-center justify-center shrink-0">
            {Icon && <Icon size={16} />}
          </span>
          <Link href={meta.route} className="text-[16px] font-semibold text-textmain hover:text-brand leading-5 truncate">
            {meta.label}
          </Link>
        </div>
        <Link href={meta.route} className="text-[13px] text-brand shrink-0 hover:underline whitespace-nowrap">
          进入领域
        </Link>
      </div>
      <div className="reg-domain-metrics">
        {card.metrics.map((slot, i) => {
          const parts = metricValueText(slot);
          const clickable = slot.status === "ok" && slot.def;
          const inner = (
            <>
              <div className="text-[13px] text-textsub leading-5">{slot.label}</div>
              <div className="flex items-baseline gap-1 mt-1 min-w-0">
                <span className="num text-[22px] font-semibold text-textmain leading-none truncate">
                  {parts.unit === "%" ? `${parts.value}%` : parts.value}
                </span>
                {parts.unit && parts.unit !== "%" && (
                  <span className="text-[13px] text-textsub whitespace-nowrap">{parts.unit}</span>
                )}
              </div>
              {slot.status !== "ok" && (
                <div className="text-[12px] text-textsub mt-1 leading-4">{slot.emptyReason ?? "—"}</div>
              )}
            </>
          );
          if (clickable) {
            return (
              <button
                key={`${slot.indicatorId}-${slot.display}-${i}`}
                type="button"
                className="text-left min-w-0"
                onClick={() => onOpenIndicator(slot.indicatorId)}
                data-overlay-return={slot.indicatorId}
              >
                {inner}
              </button>
            );
          }
          return (
            <div key={`${slot.indicatorId}-${slot.display}-${i}`} className="min-w-0">
              {inner}
            </div>
          );
        })}
      </div>
      <div className="reg-domain-exceptions">
        <button type="button" className="text-[12px] rounded-full px-2 py-0.5 border border-line whitespace-nowrap" onClick={onOpenHits}>
          {card.hitRuleDisplay === "—"
            ? `命中规则 —｜${card.hitMonitorLabel}`
            : `命中规则 ${card.hitRuleDisplay} 条${card.hitMonitorStatus === "partial" ? "｜部分完成" : ""}`}
        </button>
        <button
          type="button"
          className="text-[12px] rounded-full px-2 py-0.5 border border-line whitespace-nowrap"
          onClick={onOpenRectification}
        >
          未关闭整改 {card.openRectificationCount} 件
        </button>
        {card.overdueRectificationCount > 0 && (
          <button
            type="button"
            className="text-[12px] rounded-full px-2 py-0.5 border border-line whitespace-nowrap"
            style={{ color: "var(--risk-red-fg)" }}
            onClick={onOpenOverdue}
          >
            逾期整改 {card.overdueRectificationCount} 件
          </button>
        )}
      </div>
    </article>
  );
}
