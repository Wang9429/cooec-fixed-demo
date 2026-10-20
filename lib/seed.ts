import seedJson from "@/data/demo_seed.json";
import scaleJson from "@/data/overview_scale_seed.json";
import catalogJson from "@/data/investment_catalog.json";
import type {
  DemoSeed,
  DomainId,
  InvestmentCatalog,
  LifecycleTemplate,
  MonitoringRow,
  Organization,
} from "./types";
import { liveScenarioName } from "./scenario-names-live";
import {
  FP_ACCOUNTS,
  FP_ACTIONS,
  FP_BUSINESS_LINKS,
  FP_CONTRACTS,
  FP_COVERAGE,
  FP_EVALS,
  FP_EVIDENCE,
  FP_LEGAL_ENTITIES,
  FP_LINKS,
  FP_MATTERS,
  FP_OBLIGATIONS,
  FP_RISKS,
  FP_SNAPSHOTS,
  FP_STAGES,
  FP_TEMPLATES,
  FP_TX,
} from "./fp-seed";
import {
  FP_R32_ACTIONS,
  FP_R32_COVERAGE,
  FP_R32_EVALS,
  FP_R32_EVIDENCE,
  FP_R32_LINKS,
  FP_R32_MATTERS,
  FP_R32_RISKS,
  FP_R32_TX,
} from "./fp-r32-seed";
import { CASH_TOPICS, FIRST_BATCH_RUNTIME, RIGHTS_TOPICS, isOfficialFpSub } from "./fp-topics";

/**
 * 全平台唯一的种子读取入口。页面与计算模块都从这里取数，
 * 不在各领域另造 mock 数组（AGENTS.md “统一数据与关联”）。
 * 扩容匿名样例追加到原种子，不改写 R01–R09 及原项目金额事实。
 */
const base = seedJson as unknown as DemoSeed;
const extra = scaleJson as unknown as Partial<DemoSeed> & {
  source_notes?: Record<string, unknown>;
  organizations?: Organization[];
};

function concatUnique<T extends { id?: string; risk_id?: string; domain?: string }>(
  a: T[] | undefined,
  b: T[] | undefined,
  key: (row: T) => string,
): T[] {
  const out = [...(a ?? [])];
  const seen = new Set(out.map(key));
  for (const row of b ?? []) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

const SURVEY_ORG = new Set(["ORG-HQ", "ORG-A", "ORG-A1", "ORG-OV", "ORG-B", "ORG-C"]);
const SURVEY_UNIT: Record<string, Organization["unit_category"]> = {
  "ORG-HQ": "headquarters",
  "ORG-A": "company",
  "ORG-A1": "business_unit",
  "ORG-OV": "branch",
  "ORG-B": "company",
  "ORG-C": "company",
};

const mergedOrgs: Organization[] = concatUnique(base.organizations, extra.organizations, (o) => o.id).map((o) => {
  if (!SURVEY_ORG.has(o.id)) return o;
  return {
    ...o,
    unit_category: o.unit_category ?? SURVEY_UNIT[o.id],
    data_source: o.data_source ?? "survey_confirmed",
  };
});

export const seed = {
  ...base,
  organizations: mergedOrgs,
  legal_entities: concatUnique(base.legal_entities, [...(extra.legal_entities ?? []), ...FP_LEGAL_ENTITIES], (x) => x.id),
  fixed_asset_projects: concatUnique(base.fixed_asset_projects, extra.fixed_asset_projects, (x) => x.id),
  assets: concatUnique(base.assets, extra.assets, (x) => x.id),
  equity_projects: concatUnique(base.equity_projects, extra.equity_projects, (x) => x.id),
  engineering_projects: concatUnique(base.engineering_projects, extra.engineering_projects, (x) => x.id),
  contracts: concatUnique(concatUnique(base.contracts, extra.contracts, (x) => x.id), FP_CONTRACTS, (x) => x.id),
  obligations: concatUnique(base.obligations ?? [], FP_OBLIGATIONS, (x) => x.id),
  cash_transactions: concatUnique(concatUnique(base.cash_transactions, FP_TX, (x) => x.id), FP_R32_TX, (x) => x.id),
  accounts: concatUnique(base.accounts, FP_ACCOUNTS, (x) => x.id),
  ownership_snapshots: concatUnique(base.ownership_snapshots, FP_SNAPSHOTS, (x) => x.id),
  property_matters: concatUnique(concatUnique(base.property_matters, FP_MATTERS, (x) => x.id), FP_R32_MATTERS, (x) => x.id),
  lifecycle_templates: concatUnique(base.lifecycle_templates, FP_TEMPLATES, (x) => x.id),
  lifecycle_instances: concatUnique(base.lifecycle_instances, FP_STAGES, (x) => x.id),
  rule_evaluations: concatUnique(
    concatUnique(concatUnique(base.rule_evaluations, extra.rule_evaluations, (x) => x.id), FP_EVALS, (x) => x.id),
    FP_R32_EVALS,
    (x) => x.id,
  ),
  scenario_monitoring_coverage: concatUnique(
    concatUnique(
      concatUnique(base.scenario_monitoring_coverage, extra.scenario_monitoring_coverage, (x) => x.id),
      FP_COVERAGE,
      (x) => x.id,
    ),
    FP_R32_COVERAGE,
    (x) => x.id,
  ),
  risk_cases: concatUnique(
    concatUnique(concatUnique(base.risk_cases, extra.risk_cases, (x) => x.id), FP_RISKS, (x) => x.id),
    FP_R32_RISKS,
    (x) => x.id,
  ).map((r) => {
    if (r.id === "R07" && !r.scenario_ids.includes("CASH2-S039")) {
      return { ...r, scenario_ids: [...r.scenario_ids, "CASH2-S039"] };
    }
    return r;
  }),
  evidence: concatUnique(
    concatUnique(concatUnique(base.evidence, extra.evidence, (x) => x.id), FP_EVIDENCE, (x) => x.id),
    FP_R32_EVIDENCE,
    (x) => x.id,
  ),
  risk_context_links: [
    ...(base.risk_context_links ?? []),
    ...((extra.risk_context_links ?? []) as DemoSeed["risk_context_links"]),
    ...FP_LINKS,
    ...FP_R32_LINKS,
  ],
  case_actions: concatUnique(
    concatUnique(concatUnique(base.case_actions, extra.case_actions, (x) => x.id), FP_ACTIONS, (x) => x.id),
    FP_R32_ACTIONS,
    (x) => x.id,
  ),
  business_links: concatUnique(concatUnique(base.business_links, extra.business_links, (x) => x.id), FP_BUSINESS_LINKS, (x) => x.id),
  domain_topics: [
    { domain: "CASH" as DomainId, topics: CASH_TOPICS.map((t) => ({ id: t.id, name: t.name })) },
    { domain: "RIGHTS" as DomainId, topics: RIGHTS_TOPICS.map((t) => ({ id: t.id, name: t.name })) },
    ...(base.domain_topics ?? []).filter((d) => d.domain !== "CASH" && d.domain !== "RIGHTS"),
  ],
  expected_results: {
    ...base.expected_results,
    cash_balance_wan_cny: 7152,
    cash_restricted_wan_cny: 834.4,
    cash_available_wan_cny: 6317.6,
  },
} as DemoSeed;

export const scaleSourceNotes = extra.source_notes ?? {};
export const catalog = catalogJson as unknown as InvestmentCatalog;

export const AS_OF = seed.as_of; // 2026-06-30，业务截至日固定，不随电脑日期改变
export const DEFAULT_PERIOD = { start: "2026-01-01", end: AS_OF };

export const DOMAIN_META: Record<
  DomainId,
  { id: DomainId; pageId: string; label: string; route: string; short: string }
> = {
  FA: { id: "FA", pageId: "P20", label: "固定资产投资管理", route: "/fixed-asset-investment", short: "固定资产" },
  EQ: { id: "EQ", pageId: "P10", label: "股权投资管理", route: "/equity-investment", short: "股权" },
  INTL: { id: "INTL", pageId: "P30", label: "国际化业务", route: "/international-business", short: "国际化" },
  CASH: { id: "CASH", pageId: "P40", label: "资金管理", route: "/funds", short: "资金" },
  RIGHTS: { id: "RIGHTS", pageId: "P50", label: "产权管理", route: "/property-rights", short: "产权" },
  ENG: { id: "ENG", pageId: "P60", label: "工程项目管理", route: "/engineering-projects", short: "工程" },
};

/**
 * 侧栏业务领域五项：投资管理、资金、产权、国际化、工程。
 * 投资管理直接进入现有固定资产页，股权在页面内切换，不新建汇总页，不合并数据。
 */
export const NAV_ITEMS = [
  { id: "P00", label: "综合总览", route: "/overview", domain: null as DomainId | null },
  { id: "INV", label: "投资管理", route: "/fixed-asset-investment", domain: null as DomainId | null },
  { id: "P40", label: "资金管理", route: "/funds", domain: "CASH" as DomainId },
  { id: "P50", label: "产权管理", route: "/property-rights", domain: "RIGHTS" as DomainId },
  { id: "P30", label: "国际化业务", route: "/international-business", domain: "INTL" as DomainId },
  { id: "P60", label: "工程项目管理", route: "/engineering-projects", domain: "ENG" as DomainId },
];

export const INVESTMENT_NAV_ID = "INV";

const INVESTMENT_PATHS = [DOMAIN_META.FA.route, DOMAIN_META.EQ.route] as const;

export function isInvestmentPath(pathname: string): boolean {
  return INVESTMENT_PATHS.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export const templatesByDomain = (domain: DomainId): LifecycleTemplate[] =>
  seed.lifecycle_templates.filter((t) => t.domain === domain);

export const templateById = (id: string): LifecycleTemplate | undefined =>
  seed.lifecycle_templates.find((t) => t.id === id);

export const phaseName = (phaseId: string | null | undefined): string => {
  if (!phaseId) return "—";
  for (const t of seed.lifecycle_templates) {
    const node = t.phase_nodes.find((n) => n.id === phaseId);
    if (node) return node.name;
  }
  return phaseId;
};

export const topicName = (topicId: string | null | undefined): string => {
  if (!topicId) return "—";
  for (const d of seed.domain_topics) {
    const t = d.topics.find((x) => x.id === topicId);
    if (t) return t.name;
  }
  return topicId;
};

/**
 * scenario_monitoring_coverage 是 389 条覆盖候选，已包含 31 条实际监测关联。
 * 统一以覆盖表为单一来源，按 status 区分“已完成监测”与“覆盖候选”，
 * 不把两份数组拼接后计数（完整业需 15.1.1）。
 */
export const coverageRows: MonitoringRow[] = seed.scenario_monitoring_coverage;

export const SCENARIO_NAMES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const s of catalog.scenarios) map[s.id] = s.name;
  for (const s of seed.supplemental_scenarios) map[s.id] = s.scenario_name ?? s.name;
  return map;
})();

export const scenarioName = (id: string) => liveScenarioName(id) ?? SCENARIO_NAMES[id] ?? id;

/** 投资底稿之外、且不属于官方 80 条的补充项标签。官方资金/产权目录不得套用此泛称。 */
export const SUPPLEMENTAL_SCENARIO_LABEL = "补充监管场景";

function officialAdoption(id: string): string {
  const cap = FIRST_BATCH_RUNTIME[id] ?? "definition_only";
  if (cap === "structured_executable") return "结构化监测";
  if (cap === "assisted_review") return "线索核查";
  if (cap === "professional_review") return "专业核查";
  return "仅维护定义";
}

export const scenarioAdoption = (id: string): string => {
  const c = catalog.scenarios.find((s) => s.id === id);
  if (c) return c.adoption_mode;
  if (isOfficialFpSub(id)) return officialAdoption(id);
  return SUPPLEMENTAL_SCENARIO_LABEL;
};

export const scenarioSourceLabel = (id: string): string => {
  const c = catalog.scenarios.find((s) => s.id === id);
  if (c) return "投资监管子场景目录";
  if (isOfficialFpSub(id)) return id.startsWith("PTY2-") ? "产权监管场景目录" : "资金监管场景目录";
  if (/^(CASH2|PTY2)-/.test(id)) return "资金产权补充草稿";
  return SUPPLEMENTAL_SCENARIO_LABEL;
};

/** 研发审计用，仅配置页展示，不进入业务字段标签 */
export const scenarioAuditSource = (id: string): string => {
  const c = catalog.scenarios.find((s) => s.id === id);
  if (c) return `${c.source_sheet} ${c.source_range}`;
  return SUPPLEMENTAL_SCENARIO_LABEL;
};

export const objectTypeLabel: Record<string, string> = {
  fixed_asset_project: "固定资产投资项目",
  equity_project: "股权投资项目",
  engineering_project: "工程项目",
  asset: "资产",
  property_matter: "产权事项",
  cash_transaction: "资金交易",
  account: "银行账户",
  legal_entity: "法律主体",
  contract: "合同",
  obligation: "义务",
  risk_case: "监管事项",
};

export const monitoringStatusLabel: Record<string, string> = {
  evaluated_hit: "发现关注事项",
  evaluated_clear: "本次监测未发现异常",
  data_insufficient: "覆盖规划候选（待确认适用）",
  not_due: "尚未到核查时点",
  not_applicable: "当前范围无此类事项",
  reference_only: "待专业核查",
};

export const riskStatusLabel: Record<string, string> = seed.status_labels as Record<string, string>;

export const evidenceById = (id: string) => seed.evidence.find((e) => e.id === id);
export const sourceRecordById = (id: string) => seed.source_records.find((r) => r.id === id);
