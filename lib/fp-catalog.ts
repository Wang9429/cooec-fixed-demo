/**
 * FP-20260916-R2 资金/产权目录。JSON 是需求目录，合并进现有 CatalogPersist，
 * 不覆盖 CASH-S01/PTY-S01 等既有 ID，也不替换 configuration_seed。
 */

import fundsJson from "@/data/fp/funds_scenarios.json";
import propertyJson from "@/data/fp/property_scenarios.json";
import type {
  CatalogAiTask,
  CatalogGroup,
  CatalogIndicator,
  CatalogPersist,
  CatalogRule,
  CatalogSubscenario,
} from "./config-catalog";
import {
  CASH2_FINANCE_HOMEPAGE_IDS,
  CASH_CONDITIONAL_ROUTES,
  EXEC_MODE_FROM_ZH,
  FIRST_BATCH_RUNTIME,
  FIRST_BATCH_SUBS,
  STAGE_LABEL_TO_ID,
  resolvedTopicId,
  type RuntimeCapability,
} from "./fp-topics";
import type { DomainId } from "./types";

export interface FpScenarioRow {
  id: string;
  primary_id: string;
  primary_name: string;
  name: string;
  topic?: string;
  stage?: string;
  description?: string;
  mode?: string;
  fields?: string | string[];
  rule?: string;
  applicability?: string;
}

const fundsRows = fundsJson as FpScenarioRow[];
const propertyRows = propertyJson as FpScenarioRow[];

const FIRST = new Set<string>(FIRST_BATCH_SUBS);

function fieldsOf(row: FpScenarioRow): string[] {
  if (Array.isArray(row.fields)) return row.fields;
  if (!row.fields) return [];
  return row.fields
    .split(/[；;、]|拟补充|拟验证/g)
    .map((s) => s.replace(/^[:：\s]+/, "").trim())
    .filter((s) => s.length >= 2 && s.length < 40)
    .slice(0, 8);
}

function objectTypesFor(domain: DomainId, topicId: string): string[] {
  if (domain === "CASH") {
    if (topicId === "CASH2-T-ACCOUNT") return ["account"];
    if (topicId === "CASH2-T-PAYMENT") return ["cash_transaction", "obligation", "contract"];
    if (topicId === "CASH2-T-FINANCE") return ["contract"];
    if (topicId === "CASH2-T-OPERATION") return ["contract"];
    if (topicId === "CASH2-T-SPECIAL") return ["contract", "cash_transaction"];
    return ["legal_entity"];
  }
  if (topicId === "PTY2-T-CONTROL") return ["legal_entity"];
  if (topicId === "PTY2-T-REG") return ["property_matter", "legal_entity"];
  if (topicId === "PTY2-T-IDENTITY") return ["property_matter"];
  return ["property_matter"];
}

function runtimeOf(id: string): RuntimeCapability {
  return FIRST_BATCH_RUNTIME[id] ?? "definition_only";
}

function subFromRow(row: FpScenarioRow, domain: DomainId): CatalogSubscenario {
  const topicId = resolvedTopicId(row.id, row.topic ?? row.stage, domain);
  const first = FIRST.has(row.id);
  const runtime = runtimeOf(row.id);
  const mode = EXEC_MODE_FROM_ZH[row.mode ?? ""] ?? "rule_ai_human";
  return {
    id: row.id,
    parent_id: row.primary_id,
    name: row.name,
    domain,
    execution_mode: mode,
    primary_phase_id: domain === "RIGHTS" ? STAGE_LABEL_TO_ID[row.stage ?? ""] ?? "" : "",
    status: first ? "published" : "draft",
    enabled: first,
    applicability: first ? "confirmed" : "pending",
    required_fields: fieldsOf(row),
    object_types: objectTypesFor(domain, topicId),
    topic_id: topicId,
    runtime_capability: runtime,
    description: row.description,
    rule_text: row.rule,
    applicability_note: row.applicability,
    associated_phase_ids: row.stage && STAGE_LABEL_TO_ID[row.stage] ? [STAGE_LABEL_TO_ID[row.stage]] : [],
    conditional_routes: CASH_CONDITIONAL_ROUTES[row.id] ?? [],
    legacy_topic: row.topic,
    legacy_stage: row.stage,
  };
}

function isOfficialPrimaryId(id: string, domain: DomainId): boolean {
  if (domain === "CASH") return /^CASH2-P(0[1-9]|1[01])$/.test(id);
  if (domain === "RIGHTS") return /^PTY2-P(0[1-9]|10)$/.test(id);
  return false;
}

function groupsFrom(rows: FpScenarioRow[], domain: DomainId): CatalogGroup[] {
  const seen = new Map<string, CatalogGroup>();
  for (const row of rows) {
    if (seen.has(row.primary_id)) continue;
    // 官方 11/10 一级项作为目录发布，不因没有已启用子场景而从配置中消失。
    const official = isOfficialPrimaryId(row.primary_id, domain);
    seen.set(row.primary_id, {
      id: row.primary_id,
      name: row.primary_name,
      domain,
      status: official ? "published" : "draft",
    });
  }
  return [...seen.values()];
}

function ruleFor(row: FpScenarioRow, domain: DomainId): CatalogRule {
  const first = FIRST.has(row.id);
  const runtime = runtimeOf(row.id);
  const published = first
    ? {
        version: "FP-R2-1",
        at: "2026-06-30",
        operator: "种子发布",
        scope: "授权范围内样例对象",
        effective_date: "2026-01-01",
        parameters: sampleParams(row.id),
      }
    : null;
  return {
    id: ruleIdOf(row.id),
    name: `${row.name}监测规则`,
    primary_subscenario_id: row.id,
    condition_description: row.rule ?? row.description ?? "",
    status: first ? "published" : "draft",
    enabled: first,
    version_id: first ? "FP-R2-1" : "DRAFT",
    draft_parameters: sampleParams(row.id),
    published,
    versions: published ? [published] : [],
    runtime_capability: runtime,
    domain,
  };
}

function ruleIdOf(subId: string): string {
  if (subId === "CASH2-S039") return "CASH2-R039";
  return subId.replace("-S", "-R");
}

function sampleParams(id: string): Record<string, string | number> {
  switch (id) {
    case "CASH2-S039":
      return {
        amount_tolerance_wan: 0,
        amount_tolerance_unit: "万元",
        sample_note: "货币精度容差，单位万元，上限0.01万元（100元），不宣称法定红线",
      };
    case "CASH2-S037":
      return { amount_tolerance_wan: 0 };
    case "CASH2-S033":
      return { statutory_fallback_days: 0, note: "到期日按合同及适用规则，不统一加60日" };
    case "CASH2-S035":
      return { consecutive_periods_n: 3 };
    case "PTY2-S006":
      return { amount_tolerance_wan: 0 };
    case "PTY2-S035":
      return { report_valid_months: 12 };
    case "PTY2-S028":
      return { filing_days: 30 };
    case "CASH2-S012":
      return { occupancy_basis: "有效责任金额", sample_note: "不混比名义金额与净责任额" };
    case "CASH2-S029":
      return { sample_note: "到期未收回按合同本金与有效回收计算，不引入无依据容差" };
    case "CASH2-S040":
      return { sample_note: "仅台账审批号为空不得判定未审批" };
    case "CASH2-S006":
      return { sample_note: "同主体同基准日比对银行确认清单与企业台账；缺独立银行清单不得称已筛查" };
    case "CASH2-S017":
      return { sample_note: "同一凭据有效累计报支，剔除合法分摊；关联同凭据不等于重复报销" };
    case "CASH2-S020":
      return { sample_note: "核验调整生效日前是否有覆盖主体与人员范围的有效批准；不以流水合计代替工资总额" };
    case "PTY2-S003":
      return { sample_note: "仅核验模板明确要求前置的决策审批，依法可先行的预披露不视为违规" };
    case "PTY2-S011":
      return { sample_note: "专业核查：人工确认应覆盖范围与资产差异，不把数量差自动认定为隐匿" };
    case "PTY2-S014":
      return { sample_note: "辅助匹配应回避人员与表决记录；同姓或关系未核实不得判违规" };
    case "PTY2-S016":
      return { sample_note: "按该类行为已确认定价约束核验；不把非上市模板套上市股份" };
    case "PTY2-S037":
      return { sample_note: "按同一分期义务计算应收未收；无偿划转不适用" };
    case "PTY2-S038":
      return { sample_note: "核验实际使用时点资质有效性；状态来源缺失为未评估" };
    default:
      return { sample_note: "样例参数，待业务确认" };
  }
}

const DRAFT_GROUP: CatalogGroup = {
  id: "CASH2-P12",
  name: "违反规定以个人名义留存资金、收支结算、开立银行账户等",
  domain: "CASH",
  status: "draft",
};

const DRAFT_SUBS: CatalogSubscenario[] = [
  {
    id: "CASH2-S901",
    parent_id: "CASH2-P12",
    name: "企业资金管理账户以个人名义开立",
    domain: "CASH",
    execution_mode: "professional_review_support",
    primary_phase_id: "",
    status: "draft",
    enabled: false,
    applicability: "pending",
    required_fields: ["账户权属", "企业业务用途证明", "适用规定"],
    object_types: ["account"],
    topic_id: "CASH2-T-ACCOUNT",
    runtime_capability: "definition_only",
    description: "核查已证实用于企业资金管理的账户是否以个人名义开户。补充草稿，不计入80条，不自动启用。",
  },
  {
    id: "CASH2-S902",
    parent_id: "CASH2-P12",
    name: "企业款项在个人账户超期留存",
    domain: "CASH",
    execution_mode: "professional_review_support",
    primary_phase_id: "",
    status: "draft",
    enabled: false,
    applicability: "pending",
    required_fields: ["企业收款证明", "代收授权", "转缴期限"],
    object_types: ["cash_transaction"],
    topic_id: "CASH2-T-PAYMENT",
    runtime_capability: "definition_only",
    description: "核查已确认归属企业的款项是否超出合法代收转缴期限仍留在个人账户。补充草稿，不计入80条。",
  },
];

const FINANCE_INDICATORS: CatalogIndicator[] = [
  {
    id: "CASH2-I01",
    domain: "CASH",
    name: "营业收入",
    formula_display: "所选报告口径营业收入",
    definition_note: "期间发生额；以财务确认报告/管理报表为依据。合成报表，不冒用公开公司实际数。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH2-I02",
    domain: "CASH",
    name: "营业利润",
    formula_display: "报表营业利润",
    definition_note: "期间发生额；不替换为现金净流入。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH2-I03",
    domain: "CASH",
    name: "营业利润率",
    formula_display: "营业利润÷营业收入×100%",
    definition_note: "收入≤0时不给误导比率。父子比率不平均。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH2-I04",
    domain: "CASH",
    name: "资产总额",
    formula_display: "截至日报表资产总额",
    definition_note: "时点余额，不累加各月余额。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH2-I05",
    domain: "CASH",
    name: "负债总额",
    formula_display: "截至日报表负债总额",
    definition_note: "与资产同主体、同报表口径。作为资产负债率构成字段，不上区主卡。",
    status: "published",
    enabled: true,
    display_position: "metric_library",
  },
  {
    id: "CASH2-I06",
    domain: "CASH",
    name: "资产负债率",
    formula_display: "负债总额÷资产总额×100%",
    definition_note: "资产≤0时不显示普通百分比。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH2-I07",
    domain: "CASH",
    name: "带息债务余额",
    formula_display: "借款、债券等未偿本金余额",
    definition_note: "不得等同负债总额；未使用授信不计借款。资产负债分类主指标。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH2-I08",
    domain: "CASH",
    name: "流动比率",
    formula_display: "流动资产÷流动负债",
    definition_note: "流动负债为0时为不适用，不能显示无穷大。资产负债分类主指标。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH2-I09",
    domain: "CASH",
    name: "经营活动现金流量净额",
    formula_display: "现金流量表对应净额",
    definition_note: "期间发生额；不以全部银行收付简单相减替代。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH2-I10",
    domain: "CASH",
    name: "未来30日预计现金缺口",
    formula_display: "max(0,刚性流出−期初可用−确认流入)",
    definition_note: "预测值。本轮有样例时在流动性专题展示，不作为首页大卡。",
    status: "draft",
    enabled: false,
    display_position: "metric_library",
  },
  {
    id: "CASH2-I11",
    domain: "CASH",
    name: "核心业务连续亏损期数",
    formula_display: "连续已关账期间利润<0的期数",
    definition_note: "缺一期则不宣称连续。经营风险专题启用。",
    status: "published",
    enabled: true,
    display_position: "metric_library",
  },
  {
    id: "CASH2-I12",
    domain: "CASH",
    name: "逾期未付中小企业账款金额",
    formula_display: "已到期无争议未清偿义务合计",
    definition_note: "不按发票日期统一加60日。资金收付专题启用。",
    status: "published",
    enabled: true,
    display_position: "metric_library",
  },
  {
    id: "CASH2-I13",
    domain: "CASH",
    name: "净资产收益率",
    formula_display: "期间净利润÷平均净资产×100%",
    definition_note: "平均净资产＝（期初＋期末）÷2。不年化。净利润与净资产同主体同口径。盈利能力主指标。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH-I01",
    domain: "CASH",
    name: "账户资金余额",
    formula_display: "同截至日纳入范围账户余额折人民币合计",
    definition_note: "不跨期间相加；内部账户不重复计。资金流动性主指标。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "CASH-I02",
    domain: "CASH",
    name: "可用资金",
    formula_display: "（期末余额−受限余额）折人民币合计",
    definition_note: "多重限制不重复计入。资金流动性主指标。综合总览沿用本指标。",
    status: "published",
    enabled: true,
    display_position: "homepage",
  },
  {
    id: "CASH-I07",
    domain: "CASH",
    name: "受限资金占比",
    formula_display: "期末受限资金合计÷同范围资金余额合计×100%",
    definition_note: "分子分母同截至日、同范围账户。资金流动性主指标。综合总览沿用本指标。",
    status: "published",
    enabled: true,
    display_position: "homepage",
  },
];

const RIGHTS_INDICATORS: CatalogIndicator[] = [
  {
    id: "PTY2-I01",
    domain: "RIGHTS",
    name: "纳管法人户数",
    formula_display: "有效范围内法人按统一主体ID去重",
    definition_note: "境内以统一社会信用代码、境外以登记号与国家地区识别；含海工本体但仅当其在当前范围。分支机构、部门、账户不计户。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "PTY2-I02",
    domain: "RIGHTS",
    name: "控股及实际控制企业户数",
    formula_display: "纳管法人中经有效治理依据确认控制的被投企业",
    definition_note: "含已确认控制的全资及非全资企业，排除海工本体。占比分母为被投法人 N−B。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "PTY2-I03",
    domain: "RIGHTS",
    name: "参股企业户数",
    formula_display: "纳管法人中已确认不控制的被投企业",
    definition_note: "未录入控制结论的不归为参股，单列控制待核实。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
  {
    id: "PTY2-I04",
    domain: "RIGHTS",
    name: "在办产权事项数",
    formula_display: "截至日已启动、尚未完成或正式终止的产权事项按事项ID去重",
    definition_note: "不是规则命中数，也不是整改数。交易、登记、名称资质、治理变动在事项详情分类型展开。",
    status: "published",
    enabled: true,
    display_position: "domain_page",
  },
];

const FP_AI_TASKS: CatalogAiTask[] = [
  { id: "CASH-EXPLAIN-PL", name: "资金经营变化解释", enabled: true },
  { id: "CASH-PAY-EVIDENCE", name: "付款依据核对", enabled: true },
  { id: "CASH-DEBT-LIQ", name: "债务期限与流动性分析", enabled: true },
  { id: "CASH-SME-CLUE", name: "账款拖欠线索梳理", enabled: true },
  { id: "PTY-EQUITY-CHANGE", name: "股权变动梳理", enabled: true },
  { id: "PTY-SOURCE-DIFF", name: "产权来源差异核查", enabled: true },
  { id: "PTY-TRADE-DOCS", name: "交易过程材料比对", enabled: true },
  { id: "PTY-GOVERNANCE", name: "治理权利履职辅助核查", enabled: true },
];

function withMetricConfig(list: CatalogIndicator[]): CatalogIndicator[] {
  const extra: Record<string, Partial<CatalogIndicator>> = {
    "CASH2-I01": { category_id: "profitability", time_type: "flow", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH2-I02": { category_id: "profitability", time_type: "flow", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH2-I03": { category_id: "profitability", time_type: "period_ratio", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH2-I13": { category_id: "profitability", time_type: "period_ratio", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "quarter" },
    "CASH2-I04": { category_id: "balance_sheet", time_type: "stock", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH2-I06": { category_id: "balance_sheet", time_type: "period_ratio", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH2-I07": { category_id: "balance_sheet", time_type: "stock", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH2-I08": { category_id: "balance_sheet", time_type: "period_ratio", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH-I01": { category_id: "liquidity", time_type: "stock", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH-I02": { category_id: "liquidity", time_type: "stock", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH-I07": { category_id: "liquidity", time_type: "period_ratio", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "CASH2-I09": { category_id: "liquidity", time_type: "flow", trend_applicability: "conditional", trend_home_visible: true, trend_detail_visible: true, trend_frequency: "month" },
    "PTY2-I01": { category_id: "property_census", time_type: "point_snapshot", trend_applicability: "never", trend_home_visible: false, trend_detail_visible: false, trend_frequency: "month" },
    "PTY2-I02": { category_id: "property_census", time_type: "point_snapshot", trend_applicability: "never", trend_home_visible: false, trend_detail_visible: false, trend_frequency: "month" },
    "PTY2-I03": { category_id: "property_census", time_type: "point_snapshot", trend_applicability: "never", trend_home_visible: false, trend_detail_visible: false, trend_frequency: "month" },
    "PTY2-I04": { category_id: "property_census", time_type: "point_snapshot", trend_applicability: "never", trend_home_visible: false, trend_detail_visible: false, trend_frequency: "month" },
  };
  return list.map((i) => ({ ...i, ...extra[i.id] }));
}

export function buildFpCatalogSlice(): Pick<
  CatalogPersist,
  "groups" | "subscenarios" | "rules" | "indicators" | "ai"
> {
  const groups = [...groupsFrom(fundsRows, "CASH"), ...groupsFrom(propertyRows, "RIGHTS"), DRAFT_GROUP];
  const subs = [
    ...fundsRows.map((r) => subFromRow(r, "CASH")),
    ...propertyRows.map((r) => subFromRow(r, "RIGHTS")),
    ...DRAFT_SUBS,
  ];
  const rules = [...fundsRows, ...propertyRows].map((r) =>
    ruleFor(r, r.id.startsWith("PTY") ? "RIGHTS" : "CASH"),
  );
  return {
    groups,
    subscenarios: subs,
    rules,
    indicators: withMetricConfig([...FINANCE_INDICATORS, ...RIGHTS_INDICATORS]),
    ai: {
      enabled: true,
      mode_display: "预置分析（未接真实模型）",
      external_model_connected: false,
      tasks: FP_AI_TASKS,
      allowed_domains: ["FA", "INTL", "CASH", "RIGHTS", "ENG"],
    },
  };
}

export function fpScenarioRows(): { funds: FpScenarioRow[]; property: FpScenarioRow[] } {
  return { funds: fundsRows, property: propertyRows };
}

export function isFirstBatchSub(id: string): boolean {
  return FIRST.has(id);
}

export function fpRuleId(subId: string): string {
  return ruleIdOf(subId);
}

export const FP_HOMEPAGE_SAFE = new Set<string>(["CASH-I01", "CASH-I02", "CASH-I07", "CASH-I04", "CASH-I06", "CASH-OPEN"]);

export function isFundsPageIndicator(id: string): boolean {
  return (CASH2_FINANCE_HOMEPAGE_IDS as readonly string[]).includes(id);
}

export const PROPERTY_CENSUS_IDS = new Set(["PTY2-I01", "PTY2-I02", "PTY2-I03", "PTY2-I04"]);

export function isPropertyCensusIndicator(id: string): boolean {
  return PROPERTY_CENSUS_IDS.has(id);
}
