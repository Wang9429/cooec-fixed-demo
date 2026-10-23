"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Drawer, Tag, DataTable, Notice, Button, LinkButton, DescList, Modal } from "@/components/ui";
import { aggregate, computeIndicator, indicatorLeaves, type IndicatorDef, type LeafMetric, type NodeMetric } from "@/lib/metrics";
import { descendantOrgIds, orgLevelLabel, orgById, orgName } from "@/lib/org";
import { fmtAmount, fmtAmountSmart, fmtInt, fmtPctNumber, fmtSignedPct } from "@/lib/format";
import { objectTypeLabel, seed } from "@/lib/seed";
import { useDemoStore } from "@/lib/store";
import { authorizedObjectIds, canDomain, intersectOrgScope } from "@/lib/config";
import {
  drawerAncestorPath,
  drawerChildOrgs,
  isIndicatorAbnormalStatus,
  isOrgMirrorLeaf,
  metricRollupOrgIds,
  orgMetricDataState,
  relatedMatterIds,
  resolveDrawerSelection,
  scopedIndicatorLeaves,
  switchableDrawerIndicators,
  nearestApplicableOrgId,
  orgApplicableForIndicator,
  type DrawerSelection,
} from "@/lib/indicator-scope";
import { formatComparableChange, formatYoyShort, priorYearPeriod } from "@/lib/fp-compare";
import { catalogIndicatorMeta } from "@/lib/live-config";
import { categoryIdOf, computeTrendPoints, eligibleTrendPoints, trendSpecOf } from "@/lib/fp-trend";
import { DetailTrend } from "@/components/fp/MetricTrend";
import { isPropertyCensusIndicator } from "@/lib/fp-catalog";
import { FOCUS_PROJECT_LABEL, MAJOR_PROJECT_CALIBER, majorProjectIds } from "@/lib/investment-focus";

function statusTag(m: NodeMetric) {
  switch (m.status) {
    case "risk":
      return <Tag tone="red" icon="●">高风险</Tag>;
    case "attention":
      return <Tag tone="amber" icon="▲">关注</Tag>;
    case "normal":
      return <Tag tone="green" icon="✓">有效监测正常</Tag>;
    case "no_business":
      return <Tag tone="neutral">当前范围无业务</Tag>;
    default:
      return <Tag tone="neutral">数据不足/未评估</Tag>;
  }
}

export function formatMetricParts(
  def: IndicatorDef,
  m: NodeMetric,
): { value: string; unit: string } {
  if (m.value === null) return { value: "—", unit: "" };
  if (def.kind === "count") return { value: fmtInt(m.value), unit: def.unit };
  if (def.kind === "amount") return { value: fmtAmountSmart(m.value), unit: def.unit };
  if (def.unit === "倍") return { value: m.value.toFixed(2), unit: "倍" };
  if (def.kind === "signed_ratio") {
    const signed = fmtSignedPct(m.value);
    return { value: signed.replace(/%$/, ""), unit: "%" };
  }
  return { value: fmtPctNumber(m.value), unit: "%" };
}

export function formatMetric(def: IndicatorDef, m: NodeMetric): string {
  const parts = formatMetricParts(def, m);
  if (parts.value === "—") return "—";
  if (!parts.unit) return parts.value;
  return parts.unit === "%" ? `${parts.value}%` : `${parts.value} ${parts.unit}`;
}

/** KPI 辅助行：状态只出现一次，不与覆盖说明重复拼接同一句。 */
export function formatKpiCaption(
  m: NodeMetric,
  def?: IndicatorDef,
): { compare: string; dataState?: string } {
  if (m.status === "no_business") return { compare: "当前范围无业务" };
  if (m.status === "unknown" || m.value === null) {
    return { compare: m.emptyReason ?? "数据不足，未评估" };
  }
  const compare = m.status === "risk" ? "高风险" : m.status === "attention" ? "关注" : "有效监测正常";
  const cov = m.coverage.partial
    ? `已覆盖 ${m.coverage.evaluated}/${m.coverage.expected}`
    : `全覆盖 ${m.coverage.evaluated}/${m.coverage.expected}`;
  const dataState = def?.targetLabel ? `${def.targetLabel}｜${cov}` : cov;
  return { compare, dataState };
}

export interface IndicatorDrawerProps {
  open: boolean;
  onClose: () => void;
  indicator: IndicatorDef | null;
  indicatorOptions: IndicatorDef[];
  onSwitchIndicator: (id: string) => void;
  initialOrgId: string;
  scopeLabel: string;
  /** 对象档案；传入后在浮层之上继续打开，不跳离背景页 */
  onOpenObject?: (id: string, tab?: string) => void;
  /** 事项办理 */
  onOpenRisk?: (id: string) => void;
  /** 与背景 KPI 一致的含下级/仅本级。抽屉内再选下级只改变浮层。 */
  includeChildren?: boolean;
  /** 总览入口不提供切换；领域页仅在可运行指标之间切换。 */
  allowIndicatorSwitch?: boolean;
  /** 资金/产权领域页可切换 domain_page 指标，总览仍仅 homepage。 */
  drawerEntry?: "homepage" | "domain_page";
}

/** 每次打开或换口径时以 key 重挂载，穿透定位回到当前范围的顶层节点。 */
export default function IndicatorDrawer(props: IndicatorDrawerProps) {
  if (!props.open) return null;
  return (
    <IndicatorDrawerBody
      key={`${props.initialOrgId}:${props.includeChildren ? "desc" : "self"}`}
      {...props}
    />
  );
}

function IndicatorDrawerBody({
  open,
  onClose,
  indicator,
  indicatorOptions,
  onSwitchIndicator,
  initialOrgId,
  scopeLabel,
  onOpenObject,
  onOpenRisk,
  includeChildren = true,
  allowIndicatorSwitch = false,
  drawerEntry = "homepage",
}: IndicatorDrawerProps) {
  const { filters, risks, user } = useDemoStore();
  const [selection, setSelection] = useState<DrawerSelection>({ kind: "org", id: initialOrgId });
  const [anchorOrgId, setAnchorOrgId] = useState(initialOrgId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(descendantOrgIds(initialOrgId)));
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  const [majorOnly, setMajorOnly] = useState(true);
  const [traceLeafId, setTraceLeafId] = useState<string | null>(null);

  const openObject = (id: string, tab?: string) => onOpenObject?.(id, tab);
  const openRisk = (id: string) => onOpenRisk?.(id);
  const openLeaf = (leaf: LeafMetric) => {
    if (leaf.objectType === "risk_case") {
      openRisk(leaf.objectId);
      return;
    }
    openObject(leaf.objectId);
  };

  const dataOrgIds = useMemo(
    () => intersectOrgScope(initialOrgId, includeChildren, user),
    [initialOrgId, includeChildren, user],
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

  const prior = priorYearPeriod(filters.periodStart, filters.periodEnd, filters.asOf);
  const priorCtx = useMemo(
    () => ({
      periodStart: prior.periodStart,
      periodEnd: prior.periodEnd,
      asOf: prior.asOf,
      risks,
      allowedObjectIds,
    }),
    [prior.periodStart, prior.periodEnd, prior.asOf, risks, allowedObjectIds],
  );

  const allLeaves: LeafMetric[] = useMemo(
    () => (indicator ? indicatorLeaves(indicator, ctx) : []),
    [indicator, ctx],
  );
  const scopedLeaves = useMemo(
    () => scopedIndicatorLeaves(allLeaves, dataOrgIds),
    [allLeaves, dataOrgIds],
  );
  const priorScopedLeaves = useMemo(
    () => (indicator ? scopedIndicatorLeaves(indicatorLeaves(indicator, priorCtx), dataOrgIds) : []),
    [indicator, priorCtx, dataOrgIds],
  );
  const majorIds = useMemo(() => majorProjectIds(), []);
  const projectFocus = Boolean(indicator && indicator.domain === "FA" && indicator.leafObjectType === "fixed_asset_project");
  const listedLeaves = useMemo(
    () => (projectFocus && majorOnly ? scopedLeaves.filter((leaf) => majorIds.has(leaf.objectId)) : scopedLeaves),
    [projectFocus, majorOnly, scopedLeaves, majorIds],
  );
  const leafOrgIds = useMemo(() => new Set(scopedLeaves.map((l) => l.orgId)), [scopedLeaves]);
  const applicableLeafIds = useMemo(
    () => new Set(scopedLeaves.map((l) => l.objectId)),
    [scopedLeaves],
  );

  const switchable = useMemo(() => {
    if (!allowIndicatorSwitch || !indicator) return [];
    if (!canDomain(user, indicator.domain)) return [];
    const meta = catalogIndicatorMeta(indicator.id);
    const category = (meta?.category_id as string | undefined) ?? categoryIdOf(indicator.id, null);
    return switchableDrawerIndicators(indicator.domain, indicatorOptions, drawerEntry, category);
  }, [allowIndicatorSwitch, indicator, indicatorOptions, user, drawerEntry]);

  const emptyMetric = (): NodeMetric => ({
    value: null,
    numerator: null,
    denominator: null,
    leaves: [],
    status: "unknown",
    coverage: { evaluated: 0, expected: 0, partial: false },
  });

  const nodeMetric = (orgId: string): NodeMetric => {
    if (!indicator) return emptyMetric();
    const rollup = metricRollupOrgIds(orgId, initialOrgId, includeChildren, dataOrgIds);
    return aggregate(indicator, scopedLeaves, rollup);
  };

  const nodeMetricPrior = (orgId: string): NodeMetric => {
    if (!indicator) return emptyMetric();
    const rollup = metricRollupOrgIds(orgId, initialOrgId, includeChildren, dataOrgIds);
    return aggregate(indicator, priorScopedLeaves, rollup);
  };

  const leafMetricOf = (leaf: LeafMetric): NodeMetric => {
    if (!indicator) return emptyMetric();
    return aggregate(indicator, [leaf], new Set([leaf.orgId]));
  };

  useEffect(() => {
    setSelection((prev) => {
      if (prev.kind === "leaf" && applicableLeafIds.has(prev.id)) return prev;
      const fromOrg = prev.kind === "org" ? prev.id : anchorOrgId;
      const indicatorId = indicator?.id ?? "";
      const target = nearestApplicableOrgId(fromOrg, initialOrgId, dataOrgIds, indicatorId);
      if (prev.kind === "org" && prev.id === target && (!indicatorId || orgApplicableForIndicator(prev.id, indicatorId))) {
        return prev;
      }
      return { kind: "org", id: target };
    });
    setTraceLeafId((id) => (id && applicableLeafIds.has(id) ? id : null));
  }, [indicator?.id, initialOrgId, dataOrgIds, applicableLeafIds, anchorOrgId]);

  const resolved = resolveDrawerSelection(selection, initialOrgId, dataOrgIds, applicableLeafIds);
  const selectedLeaf =
    resolved.kind === "leaf" ? scopedLeaves.find((l) => l.objectId === resolved.id) : undefined;

  const selectedMetric: NodeMetric = useMemo(() => {
    if (!indicator) return emptyMetric();
    if (resolved.kind === "org") return nodeMetric(resolved.id);
    if (!selectedLeaf) return nodeMetric(initialOrgId);
    return leafMetricOf(selectedLeaf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicator, resolved.kind, resolved.id, selectedLeaf, scopedLeaves, dataOrgIds, initialOrgId, includeChildren]);

  const trendBundle = useMemo(() => {
    if (!indicator) return { spec: null, points: null as ReturnType<typeof eligibleTrendPoints> };
    const meta = catalogIndicatorMeta(indicator.id);
    const spec = trendSpecOf(indicator.id, {
      applicability: meta?.trend_applicability === "never" ? "never" : undefined,
      homeVisible: meta?.trend_home_visible,
      detailVisible: meta?.trend_detail_visible,
      frequency: meta?.trend_frequency,
    });
    if (!spec || spec.detailVisible === false) return { spec: null, points: null };
    const orgId = resolved.kind === "org" ? resolved.id : (selectedLeaf?.orgId ?? initialOrgId);
    const rollup = metricRollupOrgIds(orgId, initialOrgId, includeChildren, dataOrgIds);
    const ids = rollup.size ? rollup : new Set([orgId]);
    const raw = computeTrendPoints(indicator, ids, ctx, spec, computeIndicator);
    return { spec, points: eligibleTrendPoints(raw, spec.minPoints) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicator, resolved.kind, resolved.id, selectedLeaf, ctx, dataOrgIds, initialOrgId, includeChildren]);

  const abnormalLeafIds = useMemo(() => {
    if (!indicator) return new Set<string>();
    return new Set(
      scopedLeaves.filter((l) => isIndicatorAbnormalStatus(leafMetricOf(l).status)).map((l) => l.objectId),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicator, scopedLeaves]);

  const keepOrgIds = useMemo(() => {
    const keep = new Set<string>();
    if (!onlyAbnormal) {
      dataOrgIds.forEach((id) => keep.add(id));
      return keep;
    }
    const markAncestors = (orgId: string) => {
      let cur: string | undefined = orgId;
      while (cur && dataOrgIds.has(cur)) {
        keep.add(cur);
        if (cur === initialOrgId) break;
        cur = orgById(cur)?.parent_id ?? undefined;
      }
    };
    for (const orgId of dataOrgIds) {
      if (isIndicatorAbnormalStatus(nodeMetric(orgId).status)) markAncestors(orgId);
    }
    for (const leaf of scopedLeaves) {
      if (abnormalLeafIds.has(leaf.objectId)) markAncestors(leaf.orgId);
    }
    if (keep.size === 0) keep.add(initialOrgId);
    return keep;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyAbnormal, dataOrgIds, scopedLeaves, abnormalLeafIds, initialOrgId, indicator, includeChildren]);

  if (!indicator) return null;

  const selectedName =
    resolved.kind === "org"
      ? (orgById(resolved.id)?.name ?? orgName(initialOrgId))
      : selectedLeaf
        ? `${selectedLeaf.name}（${objectTypeLabel[selectedLeaf.objectType] ?? selectedLeaf.objectType}）`
        : orgName(initialOrgId);

  const childRows =
    resolved.kind === "org"
      ? [
          ...drawerChildOrgs(resolved.id, initialOrgId, includeChildren, dataOrgIds, leafOrgIds).map((c) => ({
            id: c.id,
            name: c.name,
            type: orgLevelLabel(c),
            metric: nodeMetric(c.id),
            isOrg: true,
          })),
          ...listedLeaves
            .filter((l) => l.orgId === resolved.id && !isOrgMirrorLeaf(l))
            .map((l) => ({
              id: l.objectId,
              name: l.name,
              type: objectTypeLabel[l.objectType] ?? l.objectType,
              metric: leafMetricOf(l),
              isOrg: false,
            })),
        ]
      : [];

  const detailLeaves = resolved.kind === "org" ? selectedMetric.leaves : selectedLeaf ? [selectedLeaf] : [];
  const displayDetailLeaves =
    projectFocus && majorOnly ? detailLeaves.filter((leaf) => majorIds.has(leaf.objectId)) : detailLeaves;
  const relatedIds = relatedMatterIds(detailLeaves);

  const target = indicator.target ?? null;
  const deviation =
    target !== null && selectedMetric.value !== null ? selectedMetric.value - target : null;

  const traceLeaf = traceLeafId ? scopedLeaves.find((l) => l.objectId === traceLeafId) : undefined;
  const ancestors = drawerAncestorPath(initialOrgId);

  const handleSwitch = (id: string) => {
    if (!switchable.some((opt) => opt.id === id)) return;
    onSwitchIndicator(id);
  };

  const renderTreeNode = (orgId: string, depth: number): React.ReactNode => {
    const org = orgById(orgId);
    if (!org || !dataOrgIds.has(orgId)) return null;
    if (onlyAbnormal && !keepOrgIds.has(orgId)) return null;
    const kids = drawerChildOrgs(orgId, initialOrgId, includeChildren, dataOrgIds, leafOrgIds);
    const leaves = listedLeaves.filter((l) => l.orgId === orgId && !isOrgMirrorLeaf(l));
    const metric = nodeMetric(orgId);
    const priorM = nodeMetricPrior(orgId);
    const yoy = formatYoyShort(indicator, metric, priorM);
    const dataState = orgMetricDataState(orgId, metric);
    const isExpanded = expanded.has(orgId);
    const selected = resolved.kind === "org" && resolved.id === orgId;
    const related = relatedMatterIds(
      scopedLeaves.filter((l) => metricRollupOrgIds(orgId, initialOrgId, includeChildren, dataOrgIds).has(l.orgId)),
    ).length;

    return (
      <div key={orgId}>
        <div
          className={`flex items-start gap-1.5 pr-2 rounded-[4px] cursor-pointer transition-colors duration-150 ${
            selected ? "bg-tint" : "hover:bg-[#eef3fb]"
          }`}
          style={{ paddingLeft: 6 + depth * 14, minHeight: 44, paddingTop: 6, paddingBottom: 6 }}
          onClick={() => {
            setAnchorOrgId(orgId);
            setSelection({ kind: "org", id: orgId });
          }}
          role="treeitem"
          aria-selected={selected}
          tabIndex={0}
          data-node-id={orgId}
          data-node-kind="org"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setAnchorOrgId(orgId);
              setSelection({ kind: "org", id: orgId });
            }
          }}
        >
          {kids.length + leaves.length > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((s) => {
                  const n = new Set(s);
                  if (n.has(orgId)) n.delete(orgId);
                  else n.add(orgId);
                  return n;
                });
              }}
              className="w-4 h-4 shrink-0 text-[10px] text-textsub hover:text-brand"
              aria-label={isExpanded ? "收起" : "展开"}
            >
              {isExpanded ? "▼" : "▶"}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span
            className={`text-[14px] truncate flex-1 ${selected ? "text-brand font-medium" : "text-textmain"}`}
            title={org.name}
          >
            {org.name}
          </span>
          <span className="flex flex-col items-end shrink-0 max-w-[120px]">
            <span
              className="num text-[13px] text-right text-textmain truncate w-full"
              title={formatMetric(indicator, metric)}
            >
              {formatMetric(indicator, metric)}
            </span>
            <span className="text-[11px] text-textsub truncate w-full text-right" title={`${dataState}｜${yoy}`}>
              {yoy} · {dataState}
            </span>
          </span>
          {related > 0 && (
            <span className="text-[11px] shrink-0 text-textsub" title={`对象关联事项 ${related} 件，不计入当前指标异常`}>
              关{related}
            </span>
          )}
        </div>
        {isExpanded && (
          <>
            {kids.map((k) => renderTreeNode(k.id, depth + 1))}
            {leaves.map((leaf) => {
              const lm = leafMetricOf(leaf);
              if (onlyAbnormal && !abnormalLeafIds.has(leaf.objectId)) return null;
              const sel = resolved.kind === "leaf" && resolved.id === leaf.objectId;
              const leafYoy = formatYoyShort(indicator, lm, aggregate(indicator, priorScopedLeaves.filter((x) => x.objectId === leaf.objectId), new Set([leaf.orgId])));
              const leafState = lm.emptyReason ?? (lm.value === null ? "未取数" : "已取数");
              return (
                <div
                  key={leaf.objectId}
                  className={`flex items-center gap-1.5 pr-2 rounded-[4px] cursor-pointer transition-colors duration-150 ${
                    sel ? "bg-tint" : "hover:bg-[#eef3fb]"
                  }`}
                  style={{ paddingLeft: 6 + (depth + 1) * 14 + 16, minHeight: 32 }}
                  onClick={() => {
                    setAnchorOrgId(leaf.orgId);
                    setSelection({ kind: "leaf", id: leaf.objectId });
                  }}
                  role="treeitem"
                  aria-selected={sel}
                  tabIndex={0}
                  data-node-id={leaf.objectId}
                  data-node-kind="leaf"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setAnchorOrgId(leaf.orgId);
                      setSelection({ kind: "leaf", id: leaf.objectId });
                    }
                  }}
                >
                  <span
                    className={`text-[14px] truncate flex-1 ${sel ? "text-brand font-medium" : "text-textmain"}`}
                    title={leaf.name}
                  >
                    {leaf.name}
                  </span>
                  <span className="text-[11px] text-textsub shrink-0">
                    {objectTypeLabel[leaf.objectType] ?? leaf.objectType}
                  </span>
                  <span
                    className="num text-[13px] shrink-0 min-w-[64px] max-w-[120px] text-right text-textmain truncate"
                    title={`${formatMetric(indicator, lm)}｜${leafYoy}｜${leafState}`}
                  >
                    {formatMetric(indicator, lm)}
                  </span>
                  <span className="text-[11px] text-textsub shrink-0 max-w-[88px] truncate" title={leafState}>
                    {leafYoy}
                  </span>
                  {leaf.riskIds.length > 0 && (
                    <span
                      className="text-[11px] shrink-0 text-textsub"
                      title="对象关联事项，不计入当前指标异常"
                    >
                      关{leaf.riskIds.length}
                    </span>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2 flex-wrap" data-drawer-indicator={indicator.id}>
          {indicator.name}
          <Tag tone="brand">组织穿透</Tag>
        </span>
      }
      subtitle={
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <span>指标范围：{scopeLabel}</span>
          <span className="num">
            期间 {filters.periodStart} ~ {filters.periodEnd}
          </span>
          <span className="num">截至日 {filters.asOf}</span>
          <span>数据性质：合成样例</span>
        </span>
      }
      footer={
        <div className="flex items-center justify-end">
          <Button onClick={onClose}>关闭</Button>
        </div>
      }
    >
      <div className="h-full flex min-h-0">
        <aside className="w-[30%] min-w-[280px] max-w-[380px] border-r border-line bg-[#f7f9fd] flex flex-col min-h-0">
          <div className="px-4 py-2.5 border-b border-line flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-textmain">组织及对象穿透</span>
            <label className="flex items-center gap-1 text-[12px] text-textsub cursor-pointer">
              <input
                type="checkbox"
                checked={onlyAbnormal}
                onChange={(e) => setOnlyAbnormal(e.target.checked)}
                data-only-abnormal
              />
              只看异常
            </label>
            {projectFocus && (
              <label className="flex items-center gap-1 text-[12px] text-textsub cursor-pointer">
                <input
                  type="checkbox"
                  checked={majorOnly}
                  onChange={(e) => setMajorOnly(e.target.checked)}
                  data-testid="major-project-only"
                />
                只看{FOCUS_PROJECT_LABEL}
              </label>
            )}
          </div>
          {projectFocus && (
            <div className="px-4 py-1.5 border-b border-line text-[11px] text-textsub leading-4" data-testid="major-project-caliber">
              {MAJOR_PROJECT_CALIBER}
            </div>
          )}
          <div className="px-4 py-1.5 border-b border-line text-[11px] text-textsub leading-4">
            取数范围为授权范围 ∩ 当前筛选；海油工程总部—二级单位—三级单位—{objectTypeLabel[indicator.leafObjectType] ?? "末端对象"}；
            缺层按真实管理关系跳过。祖先路径仅展示，点击不会扩大范围。
          </div>
          {ancestors.length > 0 && (
            <div className="px-4 py-1.5 border-b border-line text-[12px] text-textsub leading-5" data-drawer-ancestors>
              {ancestors.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && <span className="mx-1 text-textsub">›</span>}
                  <span title="路径展示，不可扩大取数范围">{a.name}</span>
                </span>
              ))}
              <span className="mx-1">›</span>
              <span className="text-textmain">{orgName(initialOrgId)}</span>
            </div>
          )}
          <div className="flex-1 overflow-auto py-2 px-2" role="tree" data-drawer-tree>
            {dataOrgIds.size === 0 ? (
              <p className="px-3 py-6 text-[13px] text-textsub">当前身份在所选范围内无业务组织。</p>
            ) : (
              renderTreeNode(initialOrgId, 0)
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0 overflow-auto">
          <div className="px-6 py-4 space-y-4">
            {switchable.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap" data-indicator-switcher>
                <span className="text-[12px] text-textsub">切换指标（仅同领域同分类已启用入口，保留期间与截至日）：</span>
                {switchable.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSwitch(opt.id)}
                    data-switch-indicator={opt.id}
                    className={`h-7 px-2.5 rounded-[6px] border text-[12px] transition-colors duration-150 ${
                      opt.id === indicator.id
                        ? "border-brand bg-tint text-brand"
                        : "border-line bg-surface text-textsub hover:bg-tint"
                    }`}
                  >
                    {opt.name}
                  </button>
                ))}
              </div>
            )}

            <div className="border border-line rounded-[8px] p-4 bg-surface">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-[12px] text-textsub" data-current-node>
                    当前节点：{selectedName}
                  </div>
                  <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                    <span className="num text-[32px] font-semibold leading-9" data-drawer-value>
                      {formatMetric(indicator, selectedMetric)}
                    </span>
                    {statusTag(selectedMetric)}
                  </div>
                  {resolved.kind === "org" && (
                    <div className="text-[12px] text-textsub mt-1" data-drawer-yoy>
                      {formatComparableChange(indicator, selectedMetric, nodeMetricPrior(resolved.id), prior.label).text}
                      ｜{orgMetricDataState(resolved.id, selectedMetric)}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  {target !== null ? (
                    <>
                      <div className="text-[12px] text-textsub">{indicator.targetLabel}</div>
                      <div className="num text-[14px] text-textmain mt-1">
                        偏差 {deviation === null ? "—" : `${deviation > 0 ? "+" : ""}${deviation.toFixed(2)} 个百分点`}
                      </div>
                    </>
                  ) : (
                    <div className="text-[12px] text-textsub">未配置目标，不生成虚构偏差</div>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-line">
                <DescList
                  cols={4}
                  items={[
                    {
                      label: indicator.id === "FA-I06" ? "分子（投资完成额）" : "分子",
                      value:
                        selectedMetric.numerator === null ? (
                          "—"
                        ) : (
                          <span className="num">{fmtAmount(selectedMetric.numerator)}</span>
                        ),
                    },
                    {
                      label: "分母",
                      value:
                        selectedMetric.denominator === null ? (
                          <span className="text-textsub">不适用（计数/金额类指标）</span>
                        ) : (
                          <span className="num">{fmtAmount(selectedMetric.denominator)}</span>
                        ),
                    },
                    {
                      label: "数据覆盖",
                      value: (
                        <span data-drawer-coverage>
                          {selectedMetric.coverage.evaluated}/{selectedMetric.coverage.expected} 个对象
                          {selectedMetric.coverage.partial ? "（部分覆盖）" : ""}
                        </span>
                      ),
                    },
                    {
                      label: "对象关联事项",
                      value:
                        relatedIds.length > 0 ? (
                          <span className="text-textsub" data-related-matters>
                            {relatedIds.length} 件（不计入当前指标异常）
                          </span>
                        ) : (
                          <span data-related-matters>0</span>
                        ),
                    },
                  ]}
                />
              </div>

              {selectedMetric.emptyReason && (
                <div className="mt-3">
                  <Notice tone="neutral">{selectedMetric.emptyReason}</Notice>
                </div>
              )}
            </div>

            {trendBundle.spec && trendBundle.points && !isPropertyCensusIndicator(indicator.id) ? (
              <DetailTrend def={indicator} points={trendBundle.points} spec={trendBundle.spec} />
            ) : null}

            {resolved.kind === "org" && childRows.length > 0 && (
              <div className="border border-line rounded-[8px] overflow-hidden bg-surface">
                <div className="px-4 py-2.5 border-b border-line text-[14px] font-medium">
                  下级比较
                </div>
                <DataTable
                  dense
                  rows={childRows}
                  rowKey={(r) => r.id}
                  onRowClick={(r) => {
                    if (r.isOrg) {
                      setAnchorOrgId(r.id);
                      setSelection({ kind: "org", id: r.id });
                    } else {
                      const leaf = scopedLeaves.find((l) => l.objectId === r.id);
                      if (leaf) setAnchorOrgId(leaf.orgId);
                      setSelection({ kind: "leaf", id: r.id });
                    }
                  }}
                  columns={[
                    { key: "name", title: "名称", render: (r) => <span className="text-brand">{r.name}</span> },
                    { key: "type", title: "类型", width: "120px", render: (r) => <span className="text-textsub text-[13px]">{r.type}</span> },
                    {
                      key: "value",
                      title: "指标值",
                      align: "right",
                      width: "160px",
                      render: (r) => formatMetric(indicator, r.metric),
                    },
                    {
                      key: "yoy",
                      title: "同期变化",
                      align: "right",
                      width: "120px",
                      render: (r) =>
                        r.isOrg
                          ? formatYoyShort(indicator, r.metric, nodeMetricPrior(r.id))
                          : formatYoyShort(
                              indicator,
                              r.metric,
                              aggregate(
                                indicator,
                                priorScopedLeaves.filter((x) => x.objectId === r.id),
                                new Set([scopedLeaves.find((l) => l.objectId === r.id)?.orgId ?? initialOrgId]),
                              ),
                            ),
                    },
                    {
                      key: "status",
                      title: "数据状态",
                      width: "150px",
                      render: (r) =>
                        r.isOrg ? orgMetricDataState(r.id, r.metric) : r.metric.emptyReason ?? (r.metric.value === null ? "未取数" : "已取数"),
                    },
                  ]}
                />
              </div>
            )}

            <div className="border border-line rounded-[8px] overflow-hidden bg-surface">
              <div className="px-4 py-2.5 border-b border-line text-[14px] font-medium flex items-center justify-between">
                <span>指标构成与业务明细</span>
                <span className="text-[12px] text-textsub" data-detail-count>
                  {projectFocus && majorOnly
                    ? `${FOCUS_PROJECT_LABEL} ${displayDetailLeaves.length} 个；指标仍按全部适用对象汇总`
                    : `共 ${detailLeaves.length} 个对象，按对象 ID 去重`}
                </span>
              </div>
              {displayDetailLeaves.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-textsub">
                  {projectFocus && majorOnly && detailLeaves.length > 0
                    ? `当前节点没有${FOCUS_PROJECT_LABEL}。取消勾选后可查看其余项目。`
                    : "当前范围无业务，不显示 0% 或正常绿灯"}
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {displayDetailLeaves.map((leaf) => (
                    <div key={leaf.objectId} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => openLeaf(leaf)}
                            className="text-brand text-[14px] hover:underline"
                          >
                            {leaf.name}
                          </button>
                          <Tag tone="neutral">{objectTypeLabel[leaf.objectType] ?? leaf.objectType}</Tag>
                          <span className="text-[12px] text-textsub num">{leaf.objectId}</span>
                          {!leaf.dataComplete && <Tag tone="neutral">数据不足</Tag>}
                        </div>
                        <span className="num text-[16px] font-semibold">
                          {formatMetric(indicator, leafMetricOf(leaf))}
                        </span>
                      </div>
                      {leaf.gapNote && (
                        <div className="mt-2">
                          <Notice tone="amber">{leaf.gapNote}</Notice>
                        </div>
                      )}
                      {leaf.riskIds.length > 0 && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] text-textsub">对象关联事项</span>
                          {leaf.riskIds.map((id) => (
                            <button key={id} type="button" onClick={() => openRisk(id)}>
                              <Tag tone="neutral">事项 {id}</Tag>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 grid grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-1.5">
                        {leaf.extras.map((x, i) => (
                          <div key={i} className="min-w-0">
                            <div className="text-[12px] text-textsub">{x.label}</div>
                            <div className="num text-[13px] text-textmain" title={x.hint}>
                              {x.value}
                              {x.hint && <span className="ml-1 text-[11px] text-textsub">ⓘ</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {leaf.objectType === "asset" && (
                        <div className="mt-2">
                          {(() => {
                            const source = seed.assets.find((asset) => asset.id === leaf.objectId)?.source_project_id;
                            const project = source ? seed.fixed_asset_projects.find((item) => item.id === source) : undefined;
                            if (!project) return null;
                            return (
                              <LinkButton onClick={() => openObject(project.id)}>
                                关联投资项目 {project.name}
                              </LinkButton>
                            );
                          })()}
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-3 flex-wrap">
                        <LinkButton onClick={() => openLeaf(leaf)}>
                          {leaf.objectType === "risk_case" ? "查看事项详情" : "查看对象档案"}
                        </LinkButton>
                        {leaf.objectType !== "risk_case" && (
                        <LinkButton onClick={() => openObject(leaf.objectId, "relations")}>
                          业务关联
                        </LinkButton>
                        )}
                        <LinkButton onClick={() => setTraceLeafId(leaf.objectId)}>
                          查看计算依据
                        </LinkButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-line rounded-[8px] p-4 bg-surface">
              <div className="text-[14px] font-medium mb-2">口径与构成</div>
              <DescList
                cols={1}
                items={[
                  ...(!isPropertyCensusIndicator(indicator.id)
                    ? [{ label: "计算公式", value: <span className="text-[13px]">{indicator.formula}</span> }]
                    : []),
                  { label: "口径说明", value: <span className="text-[13px]">{indicator.caliber}</span> },
                  { label: "数据来源", value: <span className="text-[13px]">{indicator.sourceNote}</span> },
                  {
                    label: "版本与性质",
                    value: (
                      <span className="text-[13px]">
                        规则版本记录于来源依据；参数为底稿参数或配置参数，正式阈值由业务部门确认后配置。
                      </span>
                    ),
                  },
                  ...(indicator.id === "FA-I06"
                    ? [
                        {
                          label: "首页展示关系",
                          value: (
                            <span className="text-[13px]">
                              投资完成额是本指标分子，与执行率共用启用和首页展示开关，不是独立首页指标。
                            </span>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              {(selectedLeaf || (isPropertyCensusIndicator(indicator.id) && scopedLeaves[0])) && (
                <div className="mt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setTraceLeafId(selectedLeaf?.objectId ?? scopedLeaves[0].objectId)}
                  >
                    查看计算依据
                    {selectedLeaf ? `：${indicator.name}·${selectedLeaf.name}` : ""}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {traceLeaf && (
        <TraceModal
          indicator={indicator}
          leaf={traceLeaf}
          scopeLabel={`${orgById(traceLeaf.orgId)?.name ?? traceLeaf.orgId}｜${filters.periodStart}~${filters.periodEnd}｜截至 ${filters.asOf}`}
          onClose={() => setTraceLeafId(null)}
          onOpenRisk={openRisk}
        />
      )}
    </Drawer>
  );
}

/**
 * 数据追溯：公式、输入值与结果全部按“当前指标 + 当前对象 + 当前期间”实算，
 * 不复用其他指标已登记的追溯记录。种子追溯只有在 object_id 与 indicator_id
 * 同时对上时才作为源记录补充展示（完整业需 16.3）。
 */
function TraceModal({
  indicator,
  leaf,
  scopeLabel,
  onClose,
  onOpenRisk,
}: {
  indicator: IndicatorDef;
  leaf: LeafMetric;
  scopeLabel: string;
  onClose: () => void;
  onOpenRisk: (id: string) => void;
}) {
  const trace = seed.data_traces.find(
    (t) => t.object_id === leaf.objectId && t.indicator_id === indicator.id,
  );
  const sources = trace
    ? seed.source_records.filter((s) => trace.source_record_ids.includes(s.id))
    : [];
  const result = aggregate(indicator, [leaf], new Set([leaf.orgId]));
  const isRatio = indicator.kind === "ratio" || indicator.kind === "signed_ratio";

  return (
    <Modal
      open
      onClose={onClose}
      title={`计算依据：${indicator.name}·${leaf.name}`}
      width={760}
    >
      <div className="space-y-4">
        <DescList
          cols={1}
          items={[
            { label: "指标", value: <span className="text-[13px]">{indicator.name}（{indicator.id}）</span> },
            { label: "对象", value: <span className="text-[13px]">{leaf.name}<span className="num ml-2 text-textsub">{leaf.objectId}</span></span> },
            { label: "范围与期间", value: <span className="text-[13px]">{scopeLabel}</span> },
            { label: "计算公式", value: <span className="text-[13px]">{indicator.formula}</span> },
            {
              label: isRatio ? "分子 ÷ 分母" : "取值",
              value: (
                <span className="num text-[13px]">
                  {isRatio
                    ? `${fmtAmount(leaf.numerator)} ÷ ${fmtAmount(leaf.denominator)}`
                    : fmtAmount(leaf.numerator)}
                </span>
              ),
            },
            {
              label: "计算结果",
              value: (
                <span className="num text-[14px] font-semibold">
                  {formatMetric(indicator, result)}
                </span>
              ),
            },
            { label: "口径说明", value: <span className="text-[13px]">{indicator.caliber}</span> },
            ...(indicator.id === "FA-I06"
              ? [
                  {
                    label: "首页展示关系",
                    value: (
                      <span className="text-[13px]">
                        投资完成额是本指标分子，与执行率共用启用和首页展示开关，不是独立首页指标。
                      </span>
                    ),
                  },
                ]
              : []),
            { label: "数据来源", value: <span className="text-[13px]">{indicator.sourceNote}</span> },
            { label: "数据性质", value: <Tag tone="neutral">模拟数据</Tag> },
          ]}
        />

        <div>
          <div className="text-[13px] font-medium mb-1.5">输入构成</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {leaf.extras.map((x, i) => (
              <div key={i} className="min-w-0">
                <div className="text-[12px] text-textsub">{x.label}</div>
                <div className="num text-[13px] text-textmain">{x.value}</div>
              </div>
            ))}
          </div>
          {leaf.gapNote && (
            <div className="mt-2">
              <Notice tone="amber">{leaf.gapNote}</Notice>
            </div>
          )}
        </div>

        {trace ? (
          <div>
            <div className="text-[13px] font-medium mb-1.5">
              已登记追溯：{trace.name}
            </div>
            <p className="text-[12px] text-textsub mb-2">
              登记公式 <span className="num">{trace.calculation.formula}</span>；
              登记输入{" "}
              <span className="num">
                {trace.calculation.inputs
                  .map((i) => `${i.field} = ${fmtAmount(i.value)} ${i.unit}`)
                  .join("；")}
              </span>
              。{trace.detail_note}
            </p>
            {trace.component_object_ids.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {trace.component_object_ids.map((id) => (
                  <Tag key={id} tone="neutral">{id}</Tag>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Notice tone="neutral" title="源记录明细">
            当前样例未对「{indicator.name}」登记逐笔源记录，上方取值来自该对象的业务台账字段，
            接入后按拟来源系统补充逐笔凭据。
          </Notice>
        )}

        <DataTable
          columns={[
            {
              key: "id",
              title: "源记录",
              width: "180px",
              render: (s) => <span className="num text-[12px]">{s.id}</span>,
            },
            { key: "name", title: "内容", render: (s) => s.name },
            {
              key: "amount",
              title: "金额",
              align: "right",
              render: (s) => (
                <span className="num">
                  {fmtAmount(s.amount)} {s.amount_unit}
                </span>
              ),
            },
            { key: "system", title: "拟来源系统", render: (s) => s.source_system_label },
            {
              key: "date",
              title: "业务日期",
              width: "110px",
              render: (s) => <span className="num text-[12px]">{s.business_date}</span>,
            },
          ]}
          rows={sources}
          rowKey={(s) => s.id}
          dense
          empty="本指标在当前样例中没有逐笔源记录。"
        />
        {leaf.riskIds.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-textsub">对象关联事项</span>
            {leaf.riskIds.map((id) => (
              <Button key={id} variant="secondary" size="sm" onClick={() => onOpenRisk(id)}>
                查看事项 {id}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
