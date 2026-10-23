import { AS_OF, seed } from "./seed";
import { isOpen, riskMatches } from "./risks";
import type { DomainId, ObjectType, RiskCase } from "./types";
import { INDICATOR_CALIBER, inDateRange, periodFact } from "./period";
import { publishedWatchRule } from "./live-config";
import { consecutiveLossPeriods, financeLeaves, loanDetailLeaves, roeLeaves, segmentProfitLeaves, segmentRevenueLeaves, smeOverdueWan, cashBridgeNote } from "./finance";
import { censusEntities, openMatterCount } from "./fp-census";
import { accountBalancesAt, censusSnapAt } from "./fp-history-seed";

/**
 * 指标一律从基础业务记录计算；expected_results 只用于验收核对，
 * 不写死到卡片（完整业需 16.3 / AGENTS.md）。
 * 比例按“分子合计 / 分母合计”重算，绝不平均百分比。
 */

export type MetricKind = "ratio" | "amount" | "count" | "signed_ratio";

export type MetricStatus = "risk" | "attention" | "normal" | "unknown" | "no_business";

export interface MetricExtra {
  label: string;
  value: string;
  hint?: string;
}

export interface LeafMetric {
  objectId: string;
  objectType: ObjectType;
  name: string;
  orgId: string;
  numerator: number | null;
  denominator: number | null;
  /** 计数类指标用 1 */
  countWeight?: number;
  extras: MetricExtra[];
  riskIds: string[];
  dataComplete: boolean;
  gapNote?: string;
  /** 构成明细（分部、合同等），不进入上级汇总，避免与报表叶子重复加总。 */
  excludeFromRollup?: boolean;
}

export interface NodeMetric {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  leaves: LeafMetric[];
  status: MetricStatus;
  emptyReason?: string;
  coverage: { evaluated: number; expected: number; partial: boolean };
}

export interface IndicatorContext {
  periodStart: string;
  periodEnd: string;
  asOf: string;
  risks: RiskCase[];
  /** null/缺省=组织范围内全部对象；空数组=无对象权限 */
  allowedObjectIds?: string[] | null;
}

export interface IndicatorDef {
  id: string;
  name: string;
  domain: DomainId;
  unit: string;
  kind: MetricKind;
  leafObjectType: ObjectType;
  /** 指标口径与公式，P71 底部“口径与构成”展示 */
  formula: string;
  caliber: string;
  sourceNote: string;
  target?: number | null;
  targetLabel?: string;
  /** 越小越好 → true（如偏差率） */
  invertDirection?: boolean;
  /** 触发关注/风险的判定 */
  evaluate?: (value: number | null) => MetricStatus;
  digits?: number;
  catalogIndicatorId?: string;
  /** 比率默认×100；流动比率为 1 */
  ratioScale?: number;
  /** 存在合并报表叶子时，父级取值用合并口径，不把下级报表相加 */
  preferConsolidated?: boolean;
  leaves: (ctx: IndicatorContext) => LeafMetric[];
}

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || Number.isNaN(v) ? null : v;

function sum(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0);
}

export function aggregate(
  def: IndicatorDef,
  leaves: LeafMetric[],
  orgIds: Set<string>,
): NodeMetric {
  const inScope = leaves.filter((l) => orgIds.has(l.orgId));
  const rollupCandidates = inScope.filter((l) => !l.excludeFromRollup);
  const expected = rollupCandidates.length;
  const evaluated = rollupCandidates.filter((l) => l.dataComplete).length;

  if (rollupCandidates.length === 0) {
    if (def.kind === "count" && hasCountBusiness(def, orgIds)) {
      const status = def.evaluate ? def.evaluate(0) : "normal";
      return {
        value: 0,
        numerator: 0,
        denominator: null,
        leaves: [],
        status,
        coverage: { evaluated: 0, expected: 0, partial: false },
      };
    }
    return {
      value: null,
      numerator: null,
      denominator: null,
      leaves: [],
      status: "no_business",
      emptyReason: "当前范围无业务",
      coverage: { evaluated: 0, expected: 0, partial: false },
    };
  }

  const usable = rollupCandidates.filter((l) => l.dataComplete);
  if (usable.length === 0) {
    const gap = rollupCandidates.find((l) => l.gapNote)?.gapNote ?? inScope.find((l) => l.gapNote)?.gapNote;
    return {
      value: null,
      numerator: null,
      denominator: null,
      leaves: inScope,
      status: "unknown",
      emptyReason: gap ?? "必要事实不足，显示未评估",
      coverage: { evaluated: 0, expected, partial: true },
    };
  }

  const rollupLeaves =
    def.preferConsolidated && usable.some((l) => l.extras.some((e) => e.value === "合并报表"))
      ? usable.filter((l) => l.extras.some((e) => e.value === "合并报表"))
      : usable;

  let value: number | null;
  let numerator: number | null = null;
  let denominator: number | null = null;

  if (def.kind === "count") {
    value = rollupLeaves.reduce((a, l) => a + (l.countWeight ?? 1), 0);
  } else if (def.kind === "amount") {
    numerator = sum(rollupLeaves.map((l) => l.numerator));
    value = numerator;
  } else {
    numerator = sum(rollupLeaves.map((l) => l.numerator));
    denominator = sum(rollupLeaves.map((l) => l.denominator));
    const scale = def.ratioScale ?? 100;
    value = denominator && denominator !== 0 ? (numerator! / denominator) * scale : null;
  }

  const status = def.evaluate ? def.evaluate(value) : value === null ? "unknown" : "normal";

  return {
    value,
    numerator,
    denominator,
    leaves: inScope,
    status,
    emptyReason:
      value === null && def.kind !== "count"
        ? "分母为 0 或数据不足，按不适用处理，不显示 0%"
        : undefined,
    coverage: { evaluated, expected, partial: evaluated < expected },
  };
}

/* ------------------------------------------------------------------ */
/* 领域指标定义                                                         */
/* ------------------------------------------------------------------ */

const faProjects = () => seed.fixed_asset_projects;
const assets = () => seed.assets;
const eqProjects = () => seed.equity_projects;
const engProjects = () => seed.engineering_projects;
const accounts = () => seed.accounts;

function risksFor(objectId: string, ctx: IndicatorContext): string[] {
  return ctx.risks.filter((r) => isOpen(r) && r.primary_object_id === objectId).map((r) => r.id);
}

function censusEntityLeaves(ctx: IndicatorContext, cls?: "controlled" | "participating"): LeafMetric[] {
  const allOrgs = new Set(seed.organizations.map((o) => o.id));
  let list = censusEntities(allOrgs, ctx.asOf);
  if (cls) list = list.filter((x) => x.class === cls);
  const classLabel = { body: "海工本体", controlled: "控股及实控", participating: "参股", unverified: "控制待核实" } as const;
  return list.map((x) => ({
    objectId: x.entity.id,
    objectType: "legal_entity" as ObjectType,
    name: x.entity.name,
    orgId: x.ownerOrgId,
    numerator: 1,
    denominator: null,
    countWeight: 1,
    extras: [
      { label: "口径", value: classLabel[x.class] },
      { label: "控制依据", value: x.controlBasis || "—" },
      { label: "全资", value: x.whollyOwned ? "是" : "否" },
    ],
    riskIds: risksFor(x.entity.id, ctx),
    dataComplete: true,
  }));
}

function hasDomainObjects(domain: DomainId, orgIds: Set<string>): boolean {
  switch (domain) {
    case "FA":
      return (
        seed.fixed_asset_projects.some((p) => orgIds.has(p.owner_org_id)) ||
        seed.assets.some((a) => orgIds.has(a.owner_org_id))
      );
    case "EQ":
      return seed.equity_projects.some((p) => orgIds.has(p.owner_org_id));
    case "ENG":
    case "INTL":
      return seed.engineering_projects.some((p) => orgIds.has(p.owner_org_id));
    case "CASH":
      return seed.accounts.some((a) => orgIds.has(a.owner_org_id));
    case "RIGHTS":
      return seed.property_matters.some((m) => orgIds.has(m.owner_org_id));
    default:
      return false;
  }
}

function hasCountBusiness(def: IndicatorDef, orgIds: Set<string>): boolean {
  return hasDomainObjects(def.domain, orgIds);
}

function openRiskLeaves(domain: DomainId, ctx: IndicatorContext): LeafMetric[] {
  return ctx.risks
    .filter((r) => isOpen(r) && riskMatches(r, { domain, orgScope: undefined }))
    .map((r) => ({
      objectId: r.id,
      objectType: "risk_case" as ObjectType,
      name: r.title,
      orgId: r.owner_org_id,
      numerator: 1,
      denominator: null,
      countWeight: 1,
      extras: [
        { label: "等级", value: r.severity === "red" ? "高风险" : "关注" },
        { label: "主对象", value: r.primary_object_id },
      ],
      riskIds: [r.id],
      dataComplete: true,
    }));
}

function accountNativeAt(accountId: string, asOf: string): { closing: number; restricted: number; complete: boolean } | null {
  const a = accounts().find((x) => x.id === accountId);
  if (!a) return null;
  if (a.id === "ACC-INT") return { closing: 0, restricted: 0, complete: true };
  const b = accountBalancesAt(a, asOf);
  if (!b) return { closing: 0, restricted: 0, complete: false };
  return { closing: b.closing, restricted: b.restricted, complete: true };
}

function accountFlowExtras(accountId: string, ctx: IndicatorContext): MetricExtra[] {
  const txs = seed.cash_transactions.filter(
    (t) => t.account_id === accountId && inDateRange(t.date, ctx.periodStart, ctx.periodEnd) && t.date <= ctx.asOf,
  );
  const inflow = txs.filter((t) => t.direction === "inflow").reduce((s, t) => s + t.amount_wan_cny, 0);
  const outflow = txs.filter((t) => t.direction === "outflow").reduce((s, t) => s + t.amount_wan_cny, 0);
  return [
    {
      label: "本期流水",
      value: `${txs.length} 笔（收款 ${inflow} 万元／付款 ${outflow} 万元）`,
    },
  ];
}

export const INDICATORS: IndicatorDef[] = [
  /* ---------------- 固定资产投资 ---------------- */
  {
    id: "FA-I06",
    catalogIndicatorId: "FA-I06",
    name: "投资计划执行率",
    domain: "FA",
    unit: "%",
    kind: "ratio",
    leafObjectType: "fixed_asset_project",
    formula: "同期累计完成投资合计 ÷ 同期有效累计计划合计 × 100%",
    caliber:
      "分子为期间内完成投资（不等于资金支付），分母为同期有效累计计划。上级节点按分子合计/分母合计重算，不平均项目百分比。无年度计划的项目（如已投用项目）不进入分母。投资完成额即本指标分子，综合总览作为辅助业务字段展示，与执行率共用 FA-I06 的启用和首页展示开关，不是独立首页指标。",
    sourceNote: "投资计划、批复及完成额来自规划计划/SAP 拟来源（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 95 ? "normal" : v >= 80 ? "attention" : "risk"),
    leaves: (ctx) =>
      faProjects()
        .filter((p) => num(p.ytd_plan) !== null)
        .map((p) => ({
          objectId: p.id,
          objectType: "fixed_asset_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: num(p.ytd_completed_investment),
          denominator: num(p.ytd_plan),
          extras: [
            { label: "同期完成投资", value: `${p.ytd_completed_investment ?? "—"} 万元` },
            { label: "同期有效计划", value: `${p.ytd_plan ?? "—"} 万元` },
            {
              label: "资金支付",
              value: `${p.cash_paid_ytd ?? "—"} 万元`,
              hint: "投资完成额与资金支付分别统计，不互相替换",
            },
            { label: "项目类型", value: p.project_type },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: num(p.ytd_plan) !== null && num(p.ytd_completed_investment) !== null,
        })),
  },
  {
    id: "FA-I07",
    catalogIndicatorId: "FA-I07",
    name: "预计完工投资偏差率",
    domain: "FA",
    unit: "%",
    kind: "signed_ratio",
    leafObjectType: "fixed_asset_project",
    formula: "（预计完工投资 EAC 合计 − 有效批准概算合计） ÷ 有效批准概算合计 × 100%",
    caliber:
      "仅纳入预计完工投资数据完整的项目。上级按预计完工投资合计与有效批准概算合计重算，不平均各项目偏差率。构成金额按互斥项目相加。已发布规则里的 95% 关注线仍待业务确认，本指标不改那条已发布规则。",
    sourceNote: "有效概算来自模拟批准概算记录，预测构成来自合同、变更及估算依据（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v > 0 ? "risk" : v >= -5 ? "attention" : "normal"),
    leaves: (ctx) =>
      faProjects()
        .filter((p) => num(p.eac) !== null)
        .map((p) => ({
          objectId: p.id,
          objectType: "fixed_asset_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: (p.eac ?? 0) - p.effective_approved_budget,
          denominator: p.effective_approved_budget,
          extras: [
            { label: "预计完工投资 EAC", value: `${p.eac} 万元` },
            { label: "有效批准概算", value: `${p.effective_approved_budget} 万元` },
            {
              label: "预测数据完整性",
              value: p.eac_complete ? "完整" : "不完整（显示已知下限）",
            },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: p.eac_complete === true,
          gapNote: p.eac_complete ? undefined : "缺少必需预测项，仅显示已知预计投资下限",
        })),
  },
  {
    id: "FA-I14",
    catalogIndicatorId: "FA-I14",
    name: "重大资产低利用率净值占比",
    domain: "FA",
    unit: "%",
    kind: "ratio",
    leafObjectType: "asset",
    formula: "已确认低利用率重大资产账面净值 ÷ 纳入监测重大资产账面净值 × 100%",
    caliber:
      "分子只含经人工确认的低利用率资产，候选与确认状态分开；同一资产仅按已定义归属汇总，不按服务项目重复计净值。",
    sourceNote: "资产台账、利用率记录来自设备完整性/运行记录拟来源（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 50 ? "risk" : v > 0 ? "attention" : "normal"),
    leaves: (ctx) =>
      assets()
        .filter((a) => a.is_major)
        .map((a) => ({
          objectId: a.id,
          objectType: "asset" as ObjectType,
          name: a.name,
          orgId: a.owner_org_id,
          numerator: a.low_utilization_confirmed ? a.net_book_value : 0,
          denominator: a.net_book_value,
          extras: [
            { label: "账面净值", value: `${a.net_book_value} 万元` },
            { label: "原值", value: `${a.gross_value} 万元` },
            {
              label: "最近季度利用率",
              value: a.quarterly_utilization_history.at(-1)
                ? `${a.quarterly_utilization_history.at(-1)!.period} ${a.quarterly_utilization_history.at(-1)!.actual_pct}%`
                : "未记录",
            },
            { label: "适用阈值", value: `${a.utilization_threshold_pct}%` },
            {
              label: "低利用率确认",
              value: a.low_utilization_confirmed
                ? `已确认（${a.confirmation_date}）`
                : "未确认",
            },
            {
              label: "来源投资项目",
              value: seed.fixed_asset_projects.find((project) => project.id === a.source_project_id)?.name ?? "未关联项目",
            },
          ],
          riskIds: risksFor(a.id, ctx),
          dataComplete: true,
        })),
  },
  {
    id: "FA-I01",
    catalogIndicatorId: "FA-I01",
    name: "同类资产总体利用率",
    domain: "FA",
    unit: "%",
    kind: "ratio",
    leafObjectType: "asset",
    formula: "报告期同类资产实际使用小时合计 ÷ 同期可利用小时合计 × 100%",
    caliber:
      "只汇总同类别、同计量口径（小时）的使用量与可利用量；小时、天数、产能不能相加。父层整体正常仍可包含高风险资产。",
    sourceNote: "运行小时来自设备运行记录拟来源（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 50 ? "normal" : "attention"),
    leaves: (ctx) =>
      assets().map((a) => ({
        objectId: a.id,
        objectType: "asset" as ObjectType,
        name: a.name,
        orgId: a.owner_org_id,
        numerator: a.productive_hours,
        denominator: a.planned_available_hours,
        extras: [
          { label: "本月实际使用", value: `${a.productive_hours} 小时` },
          { label: "本月可利用", value: `${a.planned_available_hours} 小时` },
          { label: "预警阈值", value: `${a.utilization_threshold_pct}%` },
        ],
        riskIds: risksFor(a.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "FA-I21",
    catalogIndicatorId: "FA-I21",
    name: "投资资金计划执行偏差率",
    domain: "FA",
    unit: "%",
    kind: "signed_ratio",
    leafObjectType: "fixed_asset_project",
    formula: "（同期实际支付合计 − 有效资金计划合计） ÷ 有效资金计划合计 × 100%",
    caliber: "资金支付与投资完成分别计算，不能互相替换；计划为 0 而发生支付时按计划外线索处理，不作除法。",
    sourceNote: "资金计划与支付来自财务云拟来源（模拟）",
    evaluate: (v) =>
      v === null ? "unknown" : Math.abs(v) > 5 ? "attention" : "normal",
    leaves: (ctx) =>
      faProjects()
        .filter((p) => num(p.funds_plan_ytd) !== null)
        .map((p) => ({
          objectId: p.id,
          objectType: "fixed_asset_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: (p.cash_paid_ytd ?? 0) - (p.funds_plan_ytd ?? 0),
          denominator: p.funds_plan_ytd ?? null,
          extras: [
            { label: "同期实际支付", value: `${p.cash_paid_ytd ?? "—"} 万元` },
            { label: "有效资金计划", value: `${p.funds_plan_ytd ?? "—"} 万元` },
            { label: "同期完成投资", value: `${p.ytd_completed_investment ?? "—"} 万元` },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: num(p.funds_plan_ytd) !== null && (p.funds_plan_ytd ?? 0) !== 0,
        })),
  },
  {
    id: "FA-CNT-PROJECT",
    name: "在管投资项目数",
    domain: "FA",
    unit: "个",
    kind: "count",
    leafObjectType: "fixed_asset_project",
    formula: "当前组织范围内固定资产投资项目按项目去重计数",
    caliber: "按管理归属单位统计；储备、在建、已投用项目分别标注当前阶段，不与工程合同项目混算。",
    sourceNote: "投资项目台账（模拟）",
    leaves: (ctx) =>
      faProjects().map((p) => ({
        objectId: p.id,
        objectType: "fixed_asset_project" as ObjectType,
        name: p.name,
        orgId: p.owner_org_id,
        numerator: 1,
        denominator: null,
        countWeight: 1,
        extras: [
          { label: "当前阶段", value: p.phase },
          { label: "项目类型", value: p.project_type },
          { label: "有效概算", value: `${p.effective_approved_budget} 万元` },
        ],
        riskIds: risksFor(p.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "FA-CNT-OVERBUDGET",
    name: "预计超概项目数",
    domain: "FA",
    unit: "个",
    kind: "count",
    leafObjectType: "fixed_asset_project",
    formula: "预计完工投资 > 当前有效概算的项目数（按项目去重）",
    caliber: "逐项判断，不用平均偏差替代逐项异常；数据不完整的项目单列并显示已知下限。与关注规则命中分开统计。",
    sourceNote: "预计完工投资构成及有效概算记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "risk" : "normal"),
    leaves: (ctx) =>
      faProjects()
        .filter((p) => num(p.eac) !== null && (p.eac as number) > p.effective_approved_budget)
        .map((p) => ({
          objectId: p.id,
          objectType: "fixed_asset_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: 1,
          denominator: null,
          countWeight: 1,
          extras: [
            { label: "预计完工投资", value: `${p.eac} 万元` },
            { label: "有效概算", value: `${p.effective_approved_budget} 万元` },
            {
              label: "偏差率",
              value: `${((((p.eac as number) - p.effective_approved_budget) / p.effective_approved_budget) * 100).toFixed(2)}%`,
            },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: true,
        })),
  },
  {
    id: "FA-CNT-WATCH-HIT",
    name: "超概关注规则命中项目数",
    domain: "FA",
    unit: "个",
    kind: "count",
    leafObjectType: "fixed_asset_project",
    formula: "已发布关注规则：预计完工投资偏差率 > 发布阈值的项目数。不改变预计超概事实。",
    caliber: "仅采用已发布且可执行的规则版本；草稿不计入。未发布或未到生效日显示未执行，不当 0。",
    sourceNote: "与预计超概项目数分列：超概按 EAC>有效概算，命中按发布阈值",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "attention" : "normal"),
    leaves: (ctx) => {
      const watch = publishedWatchRule();
      return faProjects()
        .filter((p) => num(p.eac) !== null)
        .map((p) => {
          const pct = (((p.eac as number) - p.effective_approved_budget) / p.effective_approved_budget) * 100;
          const ready = Boolean(watch) && ctx.asOf >= (watch?.effective_date ?? "");
          const hit = ready && pct > (watch?.pct ?? Infinity);
          return {
            objectId: p.id,
            objectType: "fixed_asset_project" as ObjectType,
            name: p.name,
            orgId: p.owner_org_id,
            numerator: hit ? 1 : 0,
            denominator: null,
            countWeight: hit ? 1 : 0,
            extras: [
              { label: "预计完工投资", value: `${p.eac} 万元` },
              { label: "有效概算", value: `${p.effective_approved_budget} 万元` },
              { label: "偏差率", value: `${pct.toFixed(2)}%` },
              {
                label: "关注规则",
                value: ready
                  ? `${watch!.ruleId} ${watch!.version} 阈值 ${watch!.pct}%｜${hit ? "命中" : "未命中"}`
                  : "未发布或未生效，未执行",
              },
            ],
            riskIds: risksFor(p.id, ctx),
            dataComplete: ready,
            gapNote: ready ? undefined : "关注规则未发布，未执行",
          };
        });
    },
  },
  {
    id: "FA-OPEN",
    name: "未关闭监管事项",
    domain: "FA",
    unit: "件",
    kind: "count",
    leafObjectType: "risk_case",
    formula: "截至日仍待核查/核查中/整改中/待复核的唯一事项数",
    caliber: "按事项去重；已排除、已关闭不计入。跨领域同一事项不重复计数。",
    sourceNote: "本平台监管事项与处理记录",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "risk" : "normal"),
    leaves: (ctx) => openRiskLeaves("FA", ctx),
  },

  /* ---------------- 股权投资 ---------------- */
  {
    id: "EQ-BALANCE",
    name: "股权投资账面余额",
    domain: "EQ",
    unit: "万元",
    kind: "amount",
    leafObjectType: "equity_project",
    formula: "期末减值前账面余额合计 − 减值准备合计",
    caliber: "期末账面余额与减值准备分别保存；不按持股比例替代会计确认。",
    sourceNote: "财务核算记录拟来源（模拟）",
    leaves: (ctx) =>
      eqProjects().map((p) => ({
        objectId: p.id,
        objectType: "equity_project" as ObjectType,
        name: p.name,
        orgId: p.owner_org_id,
        numerator: p.closing_book_balance_before_impairment - p.impairment_allowance,
        denominator: null,
        extras: [
          { label: "期初账面余额", value: `${p.opening_book_balance} 万元` },
          { label: "期末减值前余额", value: `${p.closing_book_balance_before_impairment} 万元` },
          { label: "减值准备", value: `${p.impairment_allowance} 万元` },
          { label: "被投企业", value: p.investee_id },
        ],
        riskIds: risksFor(p.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "EQ-I11",
    catalogIndicatorId: "EQ-I11",
    name: "年度投资计划完成率",
    domain: "EQ",
    unit: "%",
    kind: "ratio",
    leafObjectType: "equity_project",
    formula: "本年实际投入合计 ÷ 年度投资计划合计 × 100%",
    caliber: "分期出资按有效计划口径；不把全部获批投资额当成已到期义务。",
    sourceNote: "投资计划与出资记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 90 ? "normal" : "attention"),
    leaves: (ctx) =>
      eqProjects().map((p) => ({
        objectId: p.id,
        objectType: "equity_project" as ObjectType,
        name: p.name,
        orgId: p.owner_org_id,
        numerator: p.ytd_contribution,
        denominator: p.annual_investment_plan,
        extras: [
          { label: "本年实际投入", value: `${p.ytd_contribution} 万元` },
          { label: "年度投资计划", value: `${p.annual_investment_plan} 万元` },
          { label: "批准投资总额", value: `${p.approved_total_investment} 万元` },
        ],
        riskIds: risksFor(p.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "EQ-I15",
    catalogIndicatorId: "EQ-I15",
    name: "期间会计投资收益率",
    domain: "EQ",
    unit: "%",
    kind: "ratio",
    leafObjectType: "equity_project",
    formula: "财务确认投资收益合计 ÷ 期初期末投资账面余额平均数合计 × 100%（不年化）",
    caliber:
      "使用报告期经财务确认且去重的投资收益；已包含在会计投资收益中的股利不再相加。现金到账另列现金回报，不叠加。",
    sourceNote: "财务核算记录拟来源（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 5 ? "normal" : "attention"),
    leaves: (ctx) =>
      eqProjects().map((p) => ({
        objectId: p.id,
        objectType: "equity_project" as ObjectType,
        name: p.name,
        orgId: p.owner_org_id,
        numerator: p.accounting_investment_income_ytd,
        denominator: (p.opening_book_balance + p.closing_book_balance_before_impairment) / 2,
        extras: [
          { label: "财务确认收益", value: `${p.accounting_investment_income_ytd} 万元` },
          {
            label: "平均账面余额",
            value: `${(p.opening_book_balance + p.closing_book_balance_before_impairment) / 2} 万元`,
          },
          {
            label: "现金分红到账",
            value: `${p.cash_dividend_received} 万元`,
            hint: "会计确认收益与现金到账分开，不叠加",
          },
        ],
        riskIds: risksFor(p.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "EQ-CASH-DEVIATION",
    catalogIndicatorId: "EQ-I08",
    name: "现金回报目标偏差",
    domain: "EQ",
    unit: "%",
    kind: "signed_ratio",
    leafObjectType: "equity_project",
    formula: "（实际收到现金回报合计 − 同期现金回报目标合计） ÷ 同期目标合计 × 100%",
    caliber:
      "只计投资方实际收到的现金分红与已实现退出收益；被投企业利润、未实现估值增值不计入。目标≤0 时不作默认偏差率。",
    sourceNote: "分红决议与银行收款记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v <= -20 ? "attention" : "normal"),
    leaves: (ctx) =>
      eqProjects()
        .filter((p) => p.cash_return_target_ytd > 0)
        .map((p) => ({
          objectId: p.id,
          objectType: "equity_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: p.cash_dividend_received - p.cash_return_target_ytd,
          denominator: p.cash_return_target_ytd,
          extras: [
            { label: "实际现金到账", value: `${p.cash_dividend_received} 万元` },
            { label: "同期现金回报目标", value: `${p.cash_return_target_ytd} 万元` },
            { label: "已决议分红", value: `${p.dividend_due} 万元` },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: true,
        })),
  },
  {
    id: "EQ-X01-RATE",
    name: "到期出资履约率",
    domain: "EQ",
    unit: "%",
    kind: "ratio",
    leafObjectType: "equity_project",
    formula: "已匹配到期义务的实际履约金额合计 ÷ 截至日到期应履约金额合计 × 100%",
    caliber:
      "提前支付或未到期义务不进入分母；非货币出资采用已确认的交付及价值依据。补充场景 EQ-X01。",
    sourceNote: "出资义务与付款记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 100 ? "normal" : "attention"),
    leaves: (ctx) =>
      eqProjects()
        .filter((p) => p.contribution_due_date <= ctx.asOf)
        .map((p) => ({
          objectId: p.id,
          objectType: "equity_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: p.cumulative_contribution,
          denominator: p.contribution_due_to_date,
          extras: [
            { label: "截至日到期应出资", value: `${p.contribution_due_to_date} 万元` },
            { label: "累计实际出资", value: `${p.cumulative_contribution} 万元` },
            {
              label: "到期缺口",
              value: `${p.contribution_due_to_date - p.cumulative_contribution} 万元`,
            },
            { label: "本期到期日", value: p.contribution_due_date },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: true,
        })),
  },
  {
    id: "EQ-X02-RATE",
    name: "已到期分红回收率",
    domain: "EQ",
    unit: "%",
    kind: "ratio",
    leafObjectType: "equity_project",
    formula: "实际匹配回收额合计 ÷ 截至日到期应收额合计 × 100%",
    caliber: "已决议尚未到期的分红不进入分母；与资金领域共用同一分红义务及收款记录。补充场景 EQ-X02。",
    sourceNote: "分红决议、收款记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 100 ? "normal" : "attention"),
    leaves: (ctx) =>
      eqProjects()
        .filter((p) => p.dividend_due > 0 && p.dividend_due_date <= ctx.asOf)
        .map((p) => ({
          objectId: p.id,
          objectType: "equity_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: p.cash_dividend_received,
          denominator: p.dividend_due,
          extras: [
            { label: "到期应收分红", value: `${p.dividend_due} 万元` },
            { label: "实际到账", value: `${p.cash_dividend_received} 万元` },
            { label: "未收金额", value: `${p.dividend_due - p.cash_dividend_received} 万元` },
            { label: "约定收款日", value: p.dividend_due_date },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: true,
        })),
  },
  {
    id: "EQ-OPEN",
    name: "未关闭监管事项",
    domain: "EQ",
    unit: "件",
    kind: "count",
    leafObjectType: "risk_case",
    formula: "截至日仍未关闭的唯一事项数",
    caliber: "按事项去重；跨领域引用同一事项不重复计数。",
    sourceNote: "本平台监管事项",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "attention" : "normal"),
    leaves: (ctx) => openRiskLeaves("EQ", ctx),
  },

  /* ---------------- 工程项目 ---------------- */
  {
    id: "ENG-CNT",
    name: "在管工程项目",
    domain: "ENG",
    unit: "个",
    kind: "count",
    leafObjectType: "engineering_project",
    formula: "当前组织范围内工程履约项目按项目去重计数",
    caliber: "工程项目指对外履约业务；与固定资产自建自用项目分别建档，不重复计算规模。",
    sourceNote: "工程项目台账（模拟）",
    leaves: (ctx) =>
      engProjects().map((p) => ({
        objectId: p.id,
        objectType: "engineering_project" as ObjectType,
        name: p.name,
        orgId: p.owner_org_id,
        numerator: 1,
        denominator: null,
        countWeight: 1,
        extras: [
          { label: "客户", value: p.customer_id },
          { label: "所在国", value: p.country },
          { label: "主状态", value: p.phase },
        ],
        riskIds: risksFor(p.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "ENG-REVENUE",
    name: "有效合同额",
    domain: "ENG",
    unit: "万元",
    kind: "amount",
    leafObjectType: "engineering_project",
    formula: "当前有效不含税合同收入合计",
    caliber: "未获客户确认的索赔收益单列潜在增益，不计入有效合同收入。",
    sourceNote: "客户合同记录（模拟）",
    leaves: (ctx) =>
      engProjects().map((p) => ({
        objectId: p.id,
        objectType: "engineering_project" as ObjectType,
        name: p.name,
        orgId: p.owner_org_id,
        numerator: p.contract_revenue_ex_vat,
        denominator: null,
        extras: [
          { label: "客户合同", value: p.contract_id },
          { label: "预计完工成本", value: `${p.forecast_completion_cost} 万元` },
        ],
        riskIds: risksFor(p.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "ENG-I01",
    name: "预计完工毛利率",
    domain: "ENG",
    unit: "%",
    kind: "ratio",
    leafObjectType: "engineering_project",
    formula: "（有效不含税合同收入合计 − 预计完工成本合计） ÷ 有效不含税合同收入合计 × 100%",
    caliber:
      "上层按同口径收入、成本重新计算，不平均项目毛利率。预计完工成本含已发生、应计未入账、已签未执行、合理预计变更索赔及剩余工作估算，按来源去重。",
    sourceNote: "合同、成本包及预测记录（模拟）",
    target: 15,
    targetLabel: "目标毛利率 15.00%",
    evaluate: (v) => (v === null ? "unknown" : v <= 12 ? "risk" : v < 15 ? "attention" : "normal"),
    leaves: (ctx) =>
      engProjects().map((p) => ({
        objectId: p.id,
        objectType: "engineering_project" as ObjectType,
        name: p.name,
        orgId: p.owner_org_id,
        numerator: p.contract_revenue_ex_vat - p.forecast_completion_cost,
        denominator: p.contract_revenue_ex_vat,
        extras: [
          { label: "有效合同收入", value: `${p.contract_revenue_ex_vat} 万元` },
          { label: "预计完工成本", value: `${p.forecast_completion_cost} 万元` },
          { label: "有效目标成本", value: `${p.approved_cost_target} 万元` },
          { label: "目标毛利率", value: `${p.target_margin_pct.toFixed(2)}%` },
        ],
        riskIds: risksFor(p.id, ctx),
        dataComplete: p.cost_forecast_complete,
      })),
  },
  {
    id: "ENG-I06",
    name: "到期应收回收率",
    domain: "ENG",
    unit: "%",
    kind: "ratio",
    leafObjectType: "engineering_project",
    formula: "已匹配到期义务的收款合计 ÷ 截至日到期应收合计 × 100%",
    caliber:
      "未到期应收不计入分母（例：7月30日到期的1200万元在6月30日不列为逾期）。与资金领域 CASH-I04 使用同一义务及收款记录。",
    sourceNote: "应收义务与银行收款记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 100 ? "normal" : "attention"),
    leaves: (ctx) =>
      engProjects().map((p) => {
        const obs = seed.obligations.filter(
          (o) => o.project_id === p.id && o.kind === "工程应收" && o.due_date <= ctx.asOf,
        );
        const due = obs.reduce((a, o) => a + (o.amount_due ?? 0), 0);
        const rec = obs.reduce((a, o) => a + (o.amount_received ?? 0), 0);
        const notDue = seed.obligations
          .filter((o) => o.project_id === p.id && o.kind === "工程应收" && o.due_date > ctx.asOf)
          .reduce((a, o) => a + (o.amount_due ?? 0), 0);
        return {
          objectId: p.id,
          objectType: "engineering_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: rec,
          denominator: due,
          extras: [
            { label: "截至日到期应收", value: `${due} 万元` },
            { label: "已收", value: `${rec} 万元` },
            {
              label: "未到期应收",
              value: `${notDue} 万元`,
              hint: "未到期不计入分母，也不显示为逾期",
            },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: due > 0,
          gapNote: due > 0 ? undefined : "当前范围内无已到期应收义务",
        };
      }),
  },
  {
    id: "ENG-OPEN",
    name: "未关闭监管事项",
    domain: "ENG",
    unit: "件",
    kind: "count",
    leafObjectType: "risk_case",
    formula: "截至日仍未关闭的唯一事项数",
    caliber: "按事项去重；同一事项在资金、国际化出现时不重复计数。",
    sourceNote: "本平台监管事项",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "risk" : "normal"),
    leaves: (ctx) => openRiskLeaves("ENG", ctx),
  },
  {
    id: "CASH-I01",
    name: "账户资金余额",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "account",
    formula: "同截至日纳入范围账户余额折人民币合计（原币 × 模拟汇率 ÷ 10000）",
    caliber: "余额按截至日统计，不跨期间相加；原币金额、单位及模拟汇率可查。",
    sourceNote: cashBridgeNote(),
    leaves: (ctx) =>
      accounts().map((a) => {
        const at = accountNativeAt(a.id, ctx.asOf);
        const closing = at?.closing ?? 0;
        return {
          objectId: a.id,
          objectType: "account" as ObjectType,
          name: a.name,
          orgId: a.owner_org_id,
          numerator: (closing * a.fx_to_cny) / 10000,
          denominator: null,
          extras: [
            {
              label: "原币期末余额",
              value: `${closing.toLocaleString("zh-CN")} ${a.native_amount_unit}`,
            },
            { label: "币种", value: a.currency },
            {
              label: "模拟汇率",
              value: `${a.fx_to_cny}${a.fx_nature === "simulated" ? "（模拟）" : ""}`,
            },
            { label: "余额日期", value: ctx.asOf },
            ...(a.restriction_basis ? [{ label: "受限依据", value: a.restriction_basis }] : []),
            ...accountFlowExtras(a.id, ctx),
          ],
          riskIds: risksFor(a.id, ctx),
          dataComplete: Boolean(at?.complete),
          gapNote: at?.complete ? undefined : "该截至日无账户余额快照",
        };
      }),
  },
  {
    id: "CASH-I02",
    name: "可用资金",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "account",
    formula: "（期末余额 − 受限余额）折人民币合计",
    caliber: "受限资金显示限制类型与金额；多重限制账户金额不重复计入。",
    sourceNote: "账户余额及受限记录（模拟）",
    leaves: (ctx) =>
      accounts().map((a) => {
        const at = accountNativeAt(a.id, ctx.asOf);
        const closing = at?.closing ?? 0;
        const rest = at?.restricted ?? 0;
        return {
          objectId: a.id,
          objectType: "account" as ObjectType,
          name: a.name,
          orgId: a.owner_org_id,
          numerator: ((closing - rest) * a.fx_to_cny) / 10000,
          denominator: null,
          extras: [
            { label: "期末余额", value: `${((closing * a.fx_to_cny) / 10000).toFixed(2)} 万元` },
            {
              label: "受限余额",
              value: `${((rest * a.fx_to_cny) / 10000).toFixed(2)} 万元`,
            },
            {
              label: "原币受限",
              value: `${rest.toLocaleString("zh-CN")} ${a.native_amount_unit}`,
            },
            ...(a.restriction_basis ? [{ label: "受限依据", value: a.restriction_basis }] : []),
            ...accountFlowExtras(a.id, ctx),
          ],
          riskIds: risksFor(a.id, ctx),
          dataComplete: Boolean(at?.complete),
          gapNote: at?.complete ? undefined : "该截至日无账户余额快照",
        };
      }),
  },
  {
    id: "CASH-I07",
    name: "受限资金占比",
    domain: "CASH",
    unit: "%",
    kind: "ratio",
    leafObjectType: "account",
    formula: "期末受限资金合计 ÷ 同范围资金余额合计 × 100%",
    caliber: "分子分母同截至日、同范围账户；多重限制不重复计入。",
    sourceNote: "账户受限记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 20 ? "attention" : "normal"),
    leaves: (ctx) =>
      accounts().map((a) => {
        const at = accountNativeAt(a.id, ctx.asOf);
        const closing = at?.closing ?? 0;
        const rest = at?.restricted ?? 0;
        return {
          objectId: a.id,
          objectType: "account" as ObjectType,
          name: a.name,
          orgId: a.owner_org_id,
          numerator: (rest * a.fx_to_cny) / 10000,
          denominator: (closing * a.fx_to_cny) / 10000,
          extras: [
            { label: "币种", value: a.currency },
            { label: "受限原币", value: `${rest.toLocaleString("zh-CN")} ${a.native_amount_unit}` },
            ...(a.restriction_basis ? [{ label: "受限依据", value: a.restriction_basis }] : []),
          ],
          riskIds: risksFor(a.id, ctx),
          dataComplete: Boolean(at?.complete) && closing !== 0,
          gapNote: at?.complete ? undefined : "该截至日无账户余额快照",
        };
      }),
  },
  {
    id: "CASH-I04",
    name: "到期应收回收率",
    domain: "CASH",
    unit: "%",
    kind: "ratio",
    leafObjectType: "obligation",
    formula: "已匹配到期义务的收款合计 ÷ 截至日到期应收合计 × 100%",
    caliber: "按唯一应收义务计算；未到期不计入分母；预收和错配不直接冲销。",
    sourceNote: "应收/分红义务与银行收款记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : v >= 100 ? "normal" : "attention"),
    leaves: (ctx) =>
      seed.obligations
        .filter((o) => (o.kind === "工程应收" || o.kind === "现金分红") && o.due_date <= ctx.asOf)
        .map((o) => {
          const projOrg =
            seed.engineering_projects.find((p) => p.id === o.project_id)?.owner_org_id ??
            seed.equity_projects.find((p) => p.id === o.project_id)?.owner_org_id ??
            "ORG-HQ";
          return {
            objectId: o.id,
            objectType: "obligation" as ObjectType,
            name: `${o.kind}义务 ${o.id}`,
            orgId: projOrg,
            numerator: o.amount_received ?? 0,
            denominator: o.amount_due ?? 0,
            extras: [
              { label: "关联对象", value: o.project_id },
              { label: "到期日", value: o.due_date },
              { label: "到期应收", value: `${o.amount_due} 万元` },
              { label: "实际到账", value: `${o.amount_received} 万元` },
            ],
            riskIds: risksFor(o.project_id, ctx),
            dataComplete: true,
          };
        }),
  },
  {
    id: "CASH-I06",
    name: "异常支付事项数",
    domain: "CASH",
    unit: "笔",
    kind: "count",
    leafObjectType: "cash_transaction",
    formula: "实付金额 > 该笔有效批准金额的付款记录数（按付款记录去重）",
    caliber:
      "同一付款异常按事项与付款记录分别去重；实付超过批准但未超过业务可支付上限时，只提示超批准差额。",
    sourceNote: "付款申请、批准记录与银行回单（模拟）",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "risk" : "normal"),
    leaves: (ctx) =>
      seed.cash_transactions
        .filter(
          (t) =>
            t.direction === "outflow" &&
            t.approved_amount !== undefined &&
            t.amount_wan_cny > t.approved_amount &&
            t.date >= ctx.periodStart &&
            t.date <= ctx.periodEnd,
        )
        .map((t) => ({
          objectId: t.id,
          objectType: "cash_transaction" as ObjectType,
          name: `付款 ${t.id}`,
          orgId:
            seed.engineering_projects.find((p) => p.id === t.project_id)?.owner_org_id ??
            seed.accounts.find((a) => a.id === t.account_id)?.owner_org_id ??
            "ORG-HQ",
          numerator: 1,
          denominator: null,
          countWeight: 1,
          extras: [
            { label: "实付金额", value: `${t.amount_wan_cny} 万元` },
            { label: "有效批准", value: `${t.approved_amount} 万元` },
            { label: "超批准差额", value: `${t.amount_wan_cny - (t.approved_amount ?? 0)} 万元` },
            {
              label: "业务可支付上限",
              value: t.certified_payable_amount ? `${t.certified_payable_amount} 万元` : "—",
              hint: "本笔未超过业务可支付上限，不生成第二项风险",
            },
          ],
          riskIds: risksFor(t.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "CASH2-I01",
    name: "营业收入",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "legal_entity",
    formula: "所选报告口径营业收入",
    caliber: "期间发生额。上级有合并报表时用合并口径，下级对比用自身报表，不把下级百分比或金额直接加总冒称合并。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => [...financeLeaves("revenue", ctx), ...segmentRevenueLeaves(ctx)],
  },
  {
    id: "CASH2-I02",
    name: "营业利润",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "legal_entity",
    formula: "报表营业利润",
    caliber: "期间发生额；不替换为现金净流入。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => [...financeLeaves("operating_profit", ctx), ...segmentProfitLeaves(ctx)],
  },
  {
    id: "CASH2-I03",
    name: "营业利润率",
    domain: "CASH",
    unit: "%",
    kind: "ratio",
    leafObjectType: "legal_entity",
    formula: "营业利润÷营业收入×100%",
    caliber: "收入≤0时不适用。父子比率不平均，按合计分子分母重算。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => financeLeaves("operating_profit", ctx, { asRatioNumerator: "operating_profit", asRatioDenominator: "revenue" }),
  },
  {
    id: "CASH2-I04",
    name: "资产总额",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "legal_entity",
    formula: "截至日报表资产总额",
    caliber: "时点余额，不累加各月余额。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => financeLeaves("total_assets", ctx),
  },
  {
    id: "CASH2-I05",
    name: "负债总额",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "legal_entity",
    formula: "截至日报表负债总额",
    caliber: "与资产同主体、同报表口径。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => financeLeaves("total_liabilities", ctx),
  },
  {
    id: "CASH2-I06",
    name: "资产负债率",
    domain: "CASH",
    unit: "%",
    kind: "ratio",
    leafObjectType: "legal_entity",
    formula: "负债总额÷资产总额×100%",
    caliber: "资产≤0时不显示普通百分比。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => financeLeaves("total_liabilities", ctx, { asRatioNumerator: "total_liabilities", asRatioDenominator: "total_assets" }),
  },
  {
    id: "CASH2-I07",
    name: "带息债务余额",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "legal_entity",
    formula: "借款、债券等未偿本金余额",
    caliber: "不得等同负债总额；未使用授信不计借款。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => [...financeLeaves("interest_bearing_debt", ctx), ...loanDetailLeaves(ctx)],
  },
  {
    id: "CASH2-I08",
    name: "流动比率",
    domain: "CASH",
    unit: "倍",
    kind: "ratio",
    leafObjectType: "legal_entity",
    formula: "流动资产÷流动负债",
    caliber: "流动负债为0时不适用，不显示无穷大。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    ratioScale: 1,
    leaves: (ctx) => financeLeaves("current_assets", ctx, { asRatioNumerator: "current_assets", asRatioDenominator: "current_liabilities" }),
  },
  {
    id: "CASH2-I09",
    name: "经营活动现金流量净额",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "legal_entity",
    formula: "现金流量表对应净额",
    caliber: "期间发生额；不以全部银行收付简单相减替代。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => financeLeaves("operating_cf", ctx),
  },
  {
    id: "CASH2-I13",
    name: "净资产收益率",
    domain: "CASH",
    unit: "%",
    kind: "ratio",
    leafObjectType: "legal_entity",
    formula: "期间净利润÷平均净资产×100%",
    caliber: "平均净资产＝（期初净资产＋期末净资产）÷2。使用期间净利润，不年化。净利润、期初与期末净资产须同主体、同报表口径；缺一项则不适用。父子比率按合计分子分母重算，不平均下级收益率。",
    sourceNote: "合成财务报表（模拟）",
    preferConsolidated: true,
    leaves: (ctx) => roeLeaves(ctx),
  },
  {
    id: "CASH2-I11",
    name: "核心业务连续亏损期数",
    domain: "CASH",
    unit: "期",
    kind: "count",
    leafObjectType: "legal_entity",
    formula: "同一业务口径连续已关账期间利润<0的期数",
    caliber: "缺一期则不宣称连续。不以现金净流出代替亏损。",
    sourceNote: "合成分部利润（模拟）",
    evaluate: (v) => (v === null ? "unknown" : (v as number) >= 3 ? "attention" : "normal"),
    leaves: (ctx) =>
      ["ORG-A", "ORG-B", "ORG-C"].map((orgId) => {
        const hit = consecutiveLossPeriods(orgId, 3);
        void ctx;
        return {
          objectId: orgId,
          objectType: "legal_entity" as ObjectType,
          name: seed.organizations.find((o) => o.id === orgId)?.name ?? orgId,
          orgId,
          numerator: hit ? hit.count : 0,
          denominator: null,
          countWeight: hit ? hit.count : 0,
          extras: hit
            ? [
                { label: "核心业务", value: hit.name },
                { label: "连续期利润", value: hit.profits.map((p) => `${p}万元`).join("、") },
              ]
            : [{ label: "连续亏损", value: "未达条件" }],
          riskIds: risksFor(orgId, ctx),
          dataComplete: true,
        };
      }),
  },
  {
    id: "CASH2-I12",
    name: "逾期未付中小企业账款金额",
    domain: "CASH",
    unit: "万元",
    kind: "amount",
    leafObjectType: "obligation",
    formula: "已到期无争议未清偿义务合计",
    caliber: "到期日按合同及适用规则，不按发票日期统一加60日。",
    sourceNote: "合同付款义务（模拟）",
    leaves: (ctx) => {
      void ctx;
      return ["ORG-A", "ORG-B", "ORG-C"].map((orgId) => ({
        objectId: `SME-${orgId}`,
        objectType: "obligation" as ObjectType,
        name: `${orgId}中小企业账款`,
        orgId,
        numerator: smeOverdueWan(new Set([orgId]), ctx.asOf),
        denominator: null,
        extras: [{ label: "口径", value: "无争议到期未付" }],
        riskIds: risksFor(orgId, ctx),
        dataComplete: true,
      }));
    },
  },

  {
    id: "CASH-OPEN",
    name: "未关闭监管事项",
    domain: "CASH",
    unit: "件",
    kind: "count",
    leafObjectType: "risk_case",
    formula: "截至日仍未关闭的唯一事项数",
    caliber: "按事项去重；R03/R04 与股权领域为同一事项。",
    sourceNote: "本平台监管事项",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "risk" : "normal"),
    leaves: (ctx) => openRiskLeaves("CASH", ctx),
  },

  /* ---------------- 国际化 ---------------- */
  {
    id: "INTL-CNT",
    name: "境外在管项目",
    domain: "INTL",
    unit: "个",
    kind: "count",
    leafObjectType: "engineering_project",
    formula: "境外工程/投资项目按项目去重计数",
    caliber: "一个项目可涉及实施国、供应来源国、运输途经国；国家地区是辅助分组，不代替管理树。",
    sourceNote: "工程项目台账（模拟）",
    leaves: (ctx) =>
      engProjects()
        .filter((p) => p.country !== "中国")
        .map((p) => ({
          objectId: p.id,
          objectType: "engineering_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: 1,
          denominator: null,
          countWeight: 1,
          extras: [
            { label: "所在国", value: p.country },
            { label: "航线", value: p.route_ids.join("、") },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: true,
        })),
  },
  {
    id: "INTL-EXPOSURE",
    name: "未定价成本敞口",
    domain: "INTL",
    unit: "万元",
    kind: "amount",
    leafObjectType: "engineering_project",
    formula: "未定价采购金额（数量 × 基准单价 × 未锁价比例）+ 未锁定运费基数，按项目合计",
    caliber: "只统计未锁价、未结算且在影响期间内的敞口；同一成本不从采购与合同口径重复计入。",
    sourceNote: "采购敞口与运输费用基数（模拟）",
    leaves: (ctx) =>
      engProjects().map((p) => {
        const exps = seed.exposures.filter((e) => e.project_id === p.id);
        const steel = exps
          .filter((e) => e.category === "steel")
          .reduce(
            (a, e) =>
              a +
              ((e.quantity_tonnes ?? 0) * (e.base_price_yuan_per_tonne ?? 0) * (e.unpriced_share ?? 1)) /
                10000,
            0,
          );
        const freight = exps
          .filter((e) => e.category === "freight")
          .reduce((a, e) => a + (e.unpriced_base_cost_wan ?? 0), 0);
        return {
          objectId: p.id,
          objectType: "engineering_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: steel + freight,
          denominator: null,
          extras: [
            { label: "未定价钢材敞口", value: `${steel.toFixed(2)} 万元` },
            { label: "未锁定运费基数", value: `${freight.toFixed(2)} 万元` },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: exps.length > 0,
          gapNote: exps.length > 0 ? undefined : "当前范围无已确认敞口记录",
        };
      }),
  },
  {
    id: "INTL-AFFECTED",
    name: "已确认受影响项目",
    domain: "INTL",
    unit: "个",
    kind: "count",
    leafObjectType: "engineering_project",
    formula: "经人工确认受外部事件影响的项目按项目去重计数",
    caliber: "地区与名单匹配用于筛选候选业务，是否实际适用由有依据的规则或专业人员确认。",
    sourceNote: "国际事件台账及敞口确认记录（模拟）",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "attention" : "normal"),
    leaves: (ctx) => {
      const affected = new Set<string>();
      seed.international_events.forEach((e) =>
        (e.affected_project_ids ?? []).forEach((id) => affected.add(id)),
      );
      return engProjects()
        .filter((p) => affected.has(p.id))
        .map((p) => ({
          objectId: p.id,
          objectType: "engineering_project" as ObjectType,
          name: p.name,
          orgId: p.owner_org_id,
          numerator: 1,
          denominator: null,
          countWeight: 1,
          extras: [
            {
              label: "关联事件",
              value: seed.international_events
                .filter((e) => (e.affected_project_ids ?? []).includes(p.id))
                .map((e) => e.id)
                .join("、"),
            },
          ],
          riskIds: risksFor(p.id, ctx),
          dataComplete: true,
        }));
    },
  },
  {
    id: "INTL-OPEN",
    name: "未关闭监管事项",
    domain: "INTL",
    unit: "件",
    kind: "count",
    leafObjectType: "risk_case",
    formula: "截至日仍未关闭的唯一事项数",
    caliber: "按事项去重；R05/R06/R07 与工程、资金领域为同一事项。",
    sourceNote: "本平台监管事项",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "risk" : "normal"),
    leaves: (ctx) => openRiskLeaves("INTL", ctx),
  },

  /* ---------------- 产权 ---------------- */
  {
    id: "RIGHTS-ENTITIES",
    name: "纳入产权管理企业数",
    domain: "RIGHTS",
    unit: "户",
    kind: "count",
    leafObjectType: "legal_entity",
    formula: "存在有效权益关系记录的被投法人按被投法人去重计数",
    caliber:
      "企业数按法律主体 ID 去重；被投企业不因存在股权关系自动成为管理组织树下级，权益比例不上层求和。",
    sourceNote: "权益关系快照（模拟）",
    leaves: (ctx) => {
      const investees = new Map<string, string>();
      for (const p of eqProjects()) investees.set(p.investee_id, p.owner_org_id);
      return [...investees.entries()].map(([id, orgId]) => {
        const le = seed.legal_entities.find((l) => l.id === id);
        const snaps = seed.ownership_snapshots.filter((s) => s.investee_id === id);
        return {
          objectId: id,
          objectType: "legal_entity" as ObjectType,
          name: le?.name ?? id,
          orgId,
          numerator: 1,
          denominator: null,
          countWeight: 1,
          extras: [
            { label: "国家", value: le?.country ?? "—" },
            { label: "权益快照来源数", value: `${snaps.length}` },
            ...snaps.map((s) => ({
              label: `${s.source_type.includes("批准") ? "有效批准方案" : s.source_type.includes("工商") ? "工商登记" : s.source_type.includes("台账") ? "产权台账" : s.source_type}持股`,
              value: `${s.pct}%（生效日 ${s.effective_date}，基准日 ${s.snapshot_date}）`,
            })),
          ],
          riskIds: risksFor(id, ctx),
          dataComplete: true,
        };
      });
    },
  },
  {
    id: "RIGHTS-DIFF",
    name: "权益信息待核实差异",
    domain: "RIGHTS",
    unit: "项",
    kind: "count",
    leafObjectType: "legal_entity",
    formula: "同投资方、同被投企业、同有效期与同快照日下，各来源持股比例最大值 − 最小值 > 容差的组数",
    caliber:
      "先排除同步时间差；差异仅表示来源不一致，显示“待核实”，不直接认定未经批准变更或国有权益流失。",
    sourceNote: "批准方案、工商登记模拟快照、产权台账模拟快照",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "attention" : "normal"),
    leaves: (ctx) => {
      const groups = new Map<string, typeof seed.ownership_snapshots>();
      for (const s of seed.ownership_snapshots) {
        const k = `${s.investor_id}|${s.investee_id}|${s.effective_date}|${s.snapshot_date}`;
        groups.set(k, [...(groups.get(k) ?? []), s]);
      }
      const out: LeafMetric[] = [];
      for (const [, snaps] of groups) {
        const pcts = snaps.map((s) => s.pct);
        if (Math.max(...pcts) - Math.min(...pcts) <= 0) continue;
        const investee = snaps[0].investee_id;
        const orgId =
          eqProjects().find((p) => p.investee_id === investee)?.owner_org_id ?? "ORG-HQ";
        out.push({
          objectId: investee,
          objectType: "legal_entity",
          name: seed.legal_entities.find((l) => l.id === investee)?.name ?? investee,
          orgId,
          numerator: 1,
          denominator: null,
          countWeight: 1,
          extras: [
            { label: "有效日期", value: snaps[0].effective_date },
            { label: "快照日期", value: snaps[0].snapshot_date },
            ...snaps.map((s) => ({
              label: `${s.source_type.includes("批准") ? "有效批准方案" : s.source_type.includes("工商") ? "工商登记" : s.source_type.includes("台账") ? "产权台账" : s.source_type}持股`,
              value: `${s.pct}%（生效日 ${s.effective_date}，基准日 ${s.snapshot_date}）`,
            })),
            { label: "差异", value: `${Math.max(...pcts) - Math.min(...pcts)} 个百分点（待核实）` },
          ],
          riskIds: risksFor(investee, ctx),
          dataComplete: true,
        });
      }
      return out;
    },
  },
  {
    id: "RIGHTS-MATTERS",
    name: "在办产权事项",
    domain: "RIGHTS",
    unit: "件",
    kind: "count",
    leafObjectType: "property_matter",
    formula: "当前阶段尚未完成归档跟踪的产权事项按产权事项去重计数",
    caliber: "事项数、企业数与持股比例不相互替代；不同事项类型分别统计。",
    sourceNote: "产权事项台账（模拟）",
    leaves: (ctx) =>
      seed.property_matters.map((m) => ({
        objectId: m.id,
        objectType: "property_matter" as ObjectType,
        name: m.name,
        orgId: m.owner_org_id,
        numerator: 1,
        denominator: null,
        countWeight: 1,
        extras: [
          { label: "事项类型", value: m.matter_type },
          { label: "相关法人", value: m.investee_id },
          { label: "关联投资项目", value: m.related_project_id },
        ],
        riskIds: risksFor(m.id, ctx),
        dataComplete: true,
      })),
  },
  {
    id: "RIGHTS-OPEN",
    name: "未关闭监管事项",
    domain: "RIGHTS",
    unit: "件",
    kind: "count",
    leafObjectType: "risk_case",
    formula: "截至日仍未关闭的唯一事项数",
    caliber: "按事项去重；R08 与股权领域为同一事项。",
    sourceNote: "本平台监管事项",
    evaluate: (v) => (v === null ? "unknown" : (v as number) > 0 ? "attention" : "normal"),
    leaves: (ctx) => openRiskLeaves("RIGHTS", ctx),
  },
  {
    id: "PTY2-I01",
    name: "纳管法人户数",
    domain: "RIGHTS",
    unit: "户",
    kind: "count",
    leafObjectType: "legal_entity",
    formula: "有效范围内法人按统一主体ID去重",
    caliber: "境内以统一社会信用代码、境外以登记号与国家地区识别；含海工本体但仅当其在当前范围。分支机构、部门、账户不计户。",
    sourceNote: "法人及控制关系快照（模拟）",
    leaves: (ctx) => {
      const snap = censusSnapAt(ctx.asOf);
      if (snap) {
        return [
          {
            objectId: `CENSUS-N-${ctx.asOf}`,
            objectType: "legal_entity" as ObjectType,
            name: `纳管法人快照 ${ctx.asOf}`,
            orgId: "ORG-HQ",
            numerator: snap.N,
            denominator: null,
            countWeight: snap.N,
            extras: [{ label: "快照", value: `${ctx.asOf} 月末户数` }],
            riskIds: [],
            dataComplete: true,
          },
        ];
      }
      return censusEntityLeaves(ctx);
    },
  },
  {
    id: "PTY2-I02",
    name: "控股及实际控制企业户数",
    domain: "RIGHTS",
    unit: "户",
    kind: "count",
    leafObjectType: "legal_entity",
    formula: "纳管法人中经有效治理依据确认控制的被投企业",
    caliber: "含已确认控制的全资及非全资企业，排除海工本体。占比分母为被投法人 N−B。",
    sourceNote: "治理控制依据（模拟）",
    leaves: (ctx) => {
      const snap = censusSnapAt(ctx.asOf);
      if (snap) {
        return [
          {
            objectId: `CENSUS-C-${ctx.asOf}`,
            objectType: "legal_entity" as ObjectType,
            name: `控股及实控快照 ${ctx.asOf}`,
            orgId: "ORG-HQ",
            numerator: snap.C,
            denominator: null,
            countWeight: snap.C,
            extras: [{ label: "快照", value: `${ctx.asOf} 月末户数` }],
            riskIds: [],
            dataComplete: true,
          },
        ];
      }
      return censusEntityLeaves(ctx, "controlled");
    },
  },
  {
    id: "PTY2-I03",
    name: "参股企业户数",
    domain: "RIGHTS",
    unit: "户",
    kind: "count",
    leafObjectType: "legal_entity",
    formula: "纳管法人中已确认不控制的被投企业",
    caliber: "未录入控制结论的不归为参股，单列控制待核实。",
    sourceNote: "治理控制依据（模拟）",
    leaves: (ctx) => {
      const snap = censusSnapAt(ctx.asOf);
      if (snap) {
        return [
          {
            objectId: `CENSUS-P-${ctx.asOf}`,
            objectType: "legal_entity" as ObjectType,
            name: `参股快照 ${ctx.asOf}`,
            orgId: "ORG-HQ",
            numerator: snap.P,
            denominator: null,
            countWeight: snap.P,
            extras: [{ label: "快照", value: `${ctx.asOf} 月末户数` }],
            riskIds: [],
            dataComplete: true,
          },
        ];
      }
      return censusEntityLeaves(ctx, "participating");
    },
  },
  {
    id: "PTY2-I04",
    name: "在办产权事项数",
    domain: "RIGHTS",
    unit: "项",
    kind: "count",
    leafObjectType: "property_matter",
    formula: "截至日已启动、尚未完成或正式终止的产权事项按事项ID去重",
    caliber: "不是规则命中数，也不是整改数。交易、登记、名称资质、治理变动在事项详情分类型展开。",
    sourceNote: "产权事项台账（模拟）",
    leaves: (ctx) => {
      const snap = censusSnapAt(ctx.asOf);
      if (snap) {
        return [
          {
            objectId: `CENSUS-T-${ctx.asOf}`,
            objectType: "property_matter" as ObjectType,
            name: `在办事项快照 ${ctx.asOf}`,
            orgId: "ORG-HQ",
            numerator: snap.T,
            denominator: null,
            countWeight: snap.T,
            extras: [{ label: "快照", value: `${ctx.asOf} 月末事项数` }],
            riskIds: [],
            dataComplete: true,
          },
        ];
      }
      void ctx;
      return openMatterCount(new Set(seed.organizations.map((o) => o.id))).matters.map((m) => ({
        objectId: m.id,
        objectType: "property_matter" as ObjectType,
        name: m.name,
        orgId: m.owner_org_id,
        numerator: 1,
        denominator: null,
        countWeight: 1,
        extras: [
          { label: "事项类型", value: m.matter_type },
          { label: "相关法人", value: `${m.investor_id} → ${m.investee_id}` },
          { label: "当前环节", value: m.current_phase_id },
        ],
        riskIds: risksFor(m.id, ctx),
        dataComplete: true,
      }));
    },
  },
];

export const indicatorById = (id: string): IndicatorDef | undefined =>
  INDICATORS.find((i) => i.id === id);

export const indicatorsForDomain = (d: DomainId): IndicatorDef[] =>
  INDICATORS.filter((i) => i.domain === d);

export function indicatorLeaves(def: IndicatorDef, ctx: IndicatorContext): LeafMetric[] {
  let leaves = def.leaves(ctx).filter((l) => {
    if (ctx.allowedObjectIds === undefined || ctx.allowedObjectIds === null) return true;
    if (l.objectType === "risk_case") {
      const r = ctx.risks.find((x) => x.id === l.objectId);
      return r ? ctx.allowedObjectIds.includes(r.primary_object_id) : false;
    }
    return ctx.allowedObjectIds.includes(l.objectId);
  });
  const caliber = INDICATOR_CALIBER[def.id];
  if (caliber) {
    const fact = periodFact(ctx, caliber);
    if (!fact.ok) {
      leaves = leaves.map((l) => ({
        ...l,
        dataComplete: false,
        gapNote: fact.reason,
        numerator: null,
        denominator: null,
        extras: [...l.extras, { label: "取数口径", value: fact.reason ?? "该期间数据未覆盖" }],
      }));
    } else {
      leaves = leaves.map((l) =>
        l.extras.some((e) => e.label === "取数口径")
          ? l
          : { ...l, extras: [...l.extras, { label: "取数口径", value: fact.label }] },
      );
    }
  }
  return leaves;
}

export function computeIndicator(
  def: IndicatorDef,
  orgIds: Set<string>,
  ctx: IndicatorContext,
): NodeMetric {
  return aggregate(def, indicatorLeaves(def, ctx), orgIds);
}

export const DEFAULT_CTX: IndicatorContext = {
  periodStart: "2026-01-01",
  periodEnd: AS_OF,
  asOf: AS_OF,
  risks: seed.risk_cases,
};
