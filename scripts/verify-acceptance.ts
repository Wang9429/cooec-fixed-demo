/**
 * 验收自检：把页面实际调用的计算函数结果与 demo_seed.json 的
 * expected_results / expected_stage_results_v1_2 逐项对照。
 * 预期值只用于断言，不允许回写进指标卡（AGENTS.md 计算口径一节）。
 *
 * 运行：npm run verify
 */
import { seed, AS_OF } from "../lib/seed";
import { INDICATORS, computeIndicator, indicatorLeaves, type IndicatorDef, type NodeMetric } from "../lib/metrics";
import { orgScope, ROOT_ORG_ID, isManagedUnit } from "../lib/org";
import { computeFiveCounts, configuredScenarios, openCountForPhase } from "../lib/monitoring";
import { evaluationsForPublish, trialCashS039, trialPtyS028, trialRule, trialCashS012, trialCashS029, trialCashS040, trialPtyS025, trialCashS006, trialCashS017, trialCashS020, trialPtyS003, trialPtyS011, trialPtyS014, trialPtyS016, trialPtyS037, trialPtyS038 } from "../lib/fp-rules";
import { verificationFromEval, holdingRowsFor, holdingDiffNote, objectTitle, monitoringNoteLabel, inputFieldLabel, evidenceTitle } from "../lib/fp-display";
import { DOMAIN_OPTIONS, extractCatalog, validateSub } from "../lib/config-catalog";
import { lastExecutableCoverageNote } from "../lib/config-impact";
import { cashAccountStatementBridge, cashBridgeNote } from "../lib/finance";
import { CASH_S039_TOLERANCE_MAX_WAN } from "../lib/fp-tolerance";
import { hasEffectiveExecutableRule, syncLiveFromCatalog } from "../lib/live-config";
import { FP_SME } from "../lib/fp-seed";
import { isOpen, isOverdueRectification, rectificationStageCensus, snapshotRisksAtAsOf, statusAtAsOf } from "../lib/risks";
import type { CaseAction, DomainId } from "../lib/types";
import { authorizedObjectIds, can, canCaseAction, intersectOrgScope, userById } from "../lib/config";
import { inDateRange } from "../lib/period";
import { INDEPENDENT_TRIAL_PROJECTS } from "../lib/trial";
import {
  applicableMonitorExecutions,
  completedRectificationCases,
  hitOrgMetric,
  hitOwnerOrgIds,
  inScopeProjectCount,
  managedOrganizations,
  managedOrgCount,
  orgMonitorStatus,
  orgNodeStats,
  openRectificationCases,
  overdueRectificationCases,
  overviewDomainCards,
  overviewIndicatorEnabled,
  overviewIndicatorOnHomepage,
  validHitRecords,
  visibleChildOrgs,
  OVERVIEW_DOMAIN_ORDER,
  inScopeProjects,
} from "../lib/overview";
import {
  drawerChildOrgs,
  isIndicatorAbnormalStatus,
  isRunnableDrawerIndicator,
  metricRollupOrgIds,
  nearestApplicableOrgId,
  orgApplicableForIndicator,
  relatedMatterIds,
  resolveDrawerSelection,
  runnableDrawerIndicators,
  scopedIndicatorLeaves,
  switchableDrawerIndicators,
} from "../lib/indicator-scope";
import { CASH2_BS_IDS, CASH2_LIQ_IDS, CASH2_PROFIT_IDS, COVERAGE_REPRESENTATIVE, FIRST_BATCH_SUBS, MAIN_TOPIC_OVERRIDE, scenarioFitsBehavior } from "../lib/fp-topics";
import { CATEGORY_LABEL, computeTrendPoints, eligibleTrendPoints, trendSpecOf } from "../lib/fp-trend";
import { CASH_OFFICIAL_PRIMARY_IDS, RIGHTS_OFFICIAL_PRIMARY_IDS, coveragePrimaries, officialDirectory, officialSubIds, scopedDirectory } from "../lib/fp-directory";
import { scenarioAdoption, scenarioSourceLabel, SUPPLEMENTAL_SCENARIO_LABEL } from "../lib/seed";
import { migrateSupervisionDomainIds, remainsInSupervisionScope } from "../lib/supervision-scope";

const PERIOD_START = "2026-01-01";
const PERIOD_END = AS_OF;
const HQ = orgScope(ROOT_ORG_ID, true);
const CTX = { periodStart: PERIOD_START, periodEnd: PERIOD_END, asOf: AS_OF, risks: seed.risk_cases };
const EXPECT = seed.expected_results as Record<string, unknown>;

interface ScenarioExpectation {
  monitored_projects?: number;
  monitored_assets?: number;
  monitored_equity_projects?: number;
  hit_projects?: number;
  hit_assets?: number;
  hit_equity_projects?: number;
  open_cases: number;
  rectified_closed_cases: number;
  overdue_rectification_cases?: number;
}

const STAGE = seed.expected_stage_results_v1_2 as unknown as {
  open_case_count_by_phase: Record<string, number>;
  FA_V12_06_FA_S20: ScenarioExpectation;
  FA_V12_08_FA_S29: ScenarioExpectation;
  EQ_V12_05_EQ_X01: ScenarioExpectation;
  historical_completed_stage: {
    object_id: string;
    phase_id: string;
    business_status: string;
    still_open_risk_ids: string[];
  };
};

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown, tolerance = 0.01) {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) <= tolerance
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  通过  ${name}：${format(actual)}`);
  } else {
    failures.push(`${name}：实际 ${format(actual)}，预期 ${format(expected)}`);
    console.log(`  失败  ${name}：实际 ${format(actual)}，预期 ${format(expected)}`);
  }
}

function format(v: unknown): string {
  if (typeof v === "number") return String(Math.round(v * 10000) / 10000);
  return JSON.stringify(v);
}

function indicator(id: string): IndicatorDef {
  const def = INDICATORS.find((i) => i.id === id);
  if (!def) throw new Error(`指标 ${id} 不存在`);
  return def;
}

function nodeValue(id: string, orgIds: Set<string> = HQ): NodeMetric {
  return computeIndicator(indicator(id), orgIds, CTX);
}

function leafValue(indicatorId: string, objectId: string): number | null {
  const def = indicator(indicatorId);
  const leaf = def.leaves(CTX).find((l) => l.objectId === objectId);
  if (!leaf) throw new Error(`指标 ${indicatorId} 没有对象 ${objectId} 的明细`);
  if (leaf.numerator === null || leaf.denominator === null) return null;
  if (def.kind === "amount" || def.kind === "count") return leaf.numerator;
  if (leaf.denominator === 0) return null;
  return (leaf.numerator / leaf.denominator) * 100;
}

console.log(`\n数据版本 ${seed.version}｜演示截至日 ${AS_OF}｜期间 ${PERIOD_START} 至 ${PERIOD_END}`);

console.log("\n[1] 监管事项存量口径（按 risk_id 去重）");
const risks = seed.risk_cases;
const open = risks.filter(isOpen);
const originalOpen = ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"];
check("原未关闭事项R01–R08仍未关闭", originalOpen.every((id) => open.some((r) => r.id === id)), true);
check("扩容后未关闭事项不少于原8件", open.length >= 8, true);
check("红色高风险不少于原4件", open.filter((r) => r.severity === "red").length >= 4, true);
check("R09仍为已排除", risks.find((r) => r.id === "R09")?.status, "excluded");
check("已排除不少于1件", risks.filter((r) => r.status === "excluded").length >= 1, true);
check("R02仍为逾期整改", isOverdueRectification(risks.find((r) => r.id === "R02")!, AS_OF), true);

console.log("\n[2] 领域未关闭事项（同一事项可在多领域出现，合计后需去重）");
const domainExpect = EXPECT.domain_open_counts as Record<DomainId, number>;
const domainIds = Object.keys(domainExpect) as DomainId[];
const crossDomainIds = new Set<string>();
for (const d of domainIds) {
  const ids = open.filter((r) => r.domains.includes(d)).map((r) => r.id);
  ids.forEach((id) => crossDomainIds.add(id));
  check(`${d} 未关闭不少于原口径`, ids.length >= domainExpect[d], true);
}
check("六领域合计去重后不少于原8件", crossDomainIds.size >= 8, true);

console.log("\n[3] 固定资产投资指标");
check("总部投资计划执行率由明细重算且不等于锁死84", nodeValue("FA-I06").value !== 84, true);
check("FA-P001 执行率(%)", leafValue("FA-I06", "FA-P001"), EXPECT.fa_p001_ytd_execution_pct);
check("FA-P003 执行率(%)", leafValue("FA-I06", "FA-P003"), EXPECT.fa_p003_ytd_execution_pct);
check("FA-P001 预计完工偏差率(%)", leafValue("FA-I07", "FA-P001"), EXPECT.fa_p001_eac_deviation_pct);
check("总部预计完工偏差率(%)", nodeValue("FA-I07").value, EXPECT.fa_root_eac_deviation_pct);
check("重大资产低利用率净值占比由明细重算", typeof nodeValue("FA-I14").value === "number", true);
check("同类资产总体利用率由明细重算", typeof nodeValue("FA-I01").value === "number", true);

console.log("\n[4] 股权投资指标");
check(
  "EQ-P001 到期出资履约率(%)",
  leafValue("EQ-X01-RATE", "EQ-P001"),
  EXPECT.eq_p001_due_contribution_fulfillment_pct,
);
check(
  "EQ-P001 已到期分红回收率(%)",
  leafValue("EQ-X02-RATE", "EQ-P001"),
  EXPECT.eq_p001_due_dividend_collection_pct,
);
check(
  "EQ-P001 现金回报目标偏差(%)",
  leafValue("EQ-CASH-DEVIATION", "EQ-P001"),
  EXPECT.eq_p001_cash_return_deviation_pct,
);
check(
  "EQ-P001 期间会计投资收益率(%)",
  leafValue("EQ-I15", "EQ-P001"),
  EXPECT.eq_p001_accounting_return_pct,
);
check("总部会计投资收益率由明细重算", typeof nodeValue("EQ-I15").value === "number", true);
check("年度投资计划完成率由明细重算", typeof nodeValue("EQ-I11").value === "number", true);

console.log("\n[5] 工程项目与资金指标");
check("ENG-P001预计毛利率仍为12", leafValue("ENG-I01", "ENG-P001"), 12);
check("总部预计完工毛利率由明细重算", typeof nodeValue("ENG-I01").value === "number" && nodeValue("ENG-I01").value !== 12, true);
check("期末资金余额(万元)", nodeValue("CASH-I01").value, EXPECT.cash_balance_wan_cny);
check("可用资金(万元)", nodeValue("CASH-I02").value, EXPECT.cash_available_wan_cny);
const restrictedPct = nodeValue("CASH-I07");
check(
  "受限资金(万元，由占比与余额还原)",
  restrictedPct.numerator,
  EXPECT.cash_restricted_wan_cny,
);

console.log("\n[6] 阶段未关闭事项（横向箭头上的数字）");
const phaseExpect = STAGE.open_case_count_by_phase;
const phaseDomain = new Map<string, DomainId>();
for (const t of seed.lifecycle_templates) {
  for (const n of t.phase_nodes) phaseDomain.set(n.id, t.domain as DomainId);
}
let phaseMismatch = 0;
for (const [phaseId, expected] of Object.entries(phaseExpect)) {
  const domain = phaseDomain.get(phaseId);
  if (!domain) {
    failures.push(`阶段 ${phaseId} 在生命周期模板中不存在`);
    phaseMismatch += 1;
    continue;
  }
  const actual = openCountForPhase(domain, phaseId, HQ, risks, AS_OF).open;
  if (actual < expected) {
    failures.push(`阶段 ${phaseId} 未关闭数：实际 ${actual}，预期至少 ${expected}`);
    phaseMismatch += 1;
  }
}
check(`${Object.keys(phaseExpect).length} 个阶段未关闭数逐一比对`, phaseMismatch, 0);

console.log("\n[7] 环节联动五数（点击箭头后下区统计）");
function fiveCounts(domain: DomainId, phaseId: string, scenarioId: string) {
  return computeFiveCounts(
    {
      domain,
      orgScope: HQ,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      asOf: AS_OF,
      phaseId,
      scenarioId,
    },
    risks,
  );
}

const faS20 = fiveCounts("FA", "FA-V12-06", "FA-S20");
const e1 = STAGE.FA_V12_06_FA_S20;
check("建设实施/FA-S20 监测项目数", faS20.monitoredObjects.length, e1.monitored_projects);
check("建设实施/FA-S20 命中项目数", faS20.hitObjects.length, e1.hit_projects);
check("建设实施/FA-S20 未关闭事项不少于原口径", faS20.openRiskIds.length >= e1.open_cases, true);
check(
  "建设实施/FA-S20 本期整改闭环",
  faS20.rectifiedClosedRiskIds.length,
  e1.rectified_closed_cases,
);
check("建设实施/FA-S20 逾期整改", faS20.overdueRiskIds.length, e1.overdue_rectification_cases);

const faS29 = fiveCounts("FA", "FA-V12-08", "FA-S29");
const e2 = STAGE.FA_V12_08_FA_S29;
check("运营及后评价/FA-S29 监测资产数", faS29.monitoredObjects.length, e2.monitored_assets);
check("运营及后评价/FA-S29 命中资产数", faS29.hitObjects.length, e2.hit_assets);
check("运营及后评价/FA-S29 未关闭事项", faS29.openRiskIds.length, e2.open_cases);
check(
  "运营及后评价/FA-S29 本期整改闭环",
  faS29.rectifiedClosedRiskIds.length,
  e2.rectified_closed_cases,
);
check("运营及后评价/FA-S29 逾期整改", faS29.overdueRiskIds.length, e2.overdue_rectification_cases);

const eqX01 = fiveCounts("EQ", "EQ-V12-05", "EQ-X01");
const e3 = STAGE.EQ_V12_05_EQ_X01;
check("股权投后/EQ-X01 监测项目数", eqX01.monitoredObjects.length, e3.monitored_equity_projects);
check("股权投后/EQ-X01 命中项目数", eqX01.hitObjects.length, e3.hit_equity_projects);
check("股权投后/EQ-X01 未关闭事项不少于原口径", eqX01.openRiskIds.length >= e3.open_cases, true);
check(
  "股权投后/EQ-X01 本期整改闭环",
  eqX01.rectifiedClosedRiskIds.length,
  e3.rectified_closed_cases,
);

console.log("\n[8] 业务阶段已完成不影响事项存量");
const hist = STAGE.historical_completed_stage;
const histInstance = seed.lifecycle_instances.find(
  (i) => i.object_id === hist.object_id && i.phase_id === hist.phase_id,
);
check(
  `${hist.object_id} / ${hist.phase_id} 业务状态`,
  histInstance?.business_status,
  hist.business_status,
);
check(
  "该已完成阶段仍保留的未关闭事项",
  openCountForPhase("EQ", hist.phase_id, HQ, risks, AS_OF).riskIds,
  hist.still_open_risk_ids,
);

console.log("\n[9] 第二批：范围、期间、覆盖与权限");
const HQ_SELF = orgScope(ROOT_ORG_ID, false);
const hqSelfFa = computeIndicator(indicator("FA-I06"), HQ_SELF, CTX);
check("总部仅本级投资计划执行率状态", hqSelfFa.status, "no_business");
check("总部含下级投资计划执行率由明细重算", typeof nodeValue("FA-I06").value === "number" && nodeValue("FA-I06").value !== 84, true);

const unitBUser = userById("USER-UNIT-B");
const bOrgs = intersectOrgScope("ORG-B", true, unitBUser);
check("单位B范围不含A1", bOrgs.has("ORG-A1"), false);
check("单位B执行率(%)", computeIndicator(indicator("FA-I06"), bOrgs, CTX).value, EXPECT.fa_p003_ytd_execution_pct);
const bFaOpen = computeIndicator(indicator("FA-OPEN"), bOrgs, CTX);
check("单位B未关闭事项为0而非无业务", bFaOpen.value, 0);
check("单位B未关闭事项状态", bFaOpen.status, "normal");
const bLeaves = indicatorLeaves(indicator("FA-I06"), {
  ...CTX,
  allowedObjectIds: authorizedObjectIds(unitBUser),
}).filter((l) => bOrgs.has(l.orgId));
check("单位B执行率明细不含FA-P001", bLeaves.some((l) => l.objectId === "FA-P001"), false);

const faS02 = computeFiveCounts(
  {
    domain: "FA",
    orgScope: HQ,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    asOf: AS_OF,
    scenarioId: "FA-S02",
  },
  risks,
);
const faS21 = computeFiveCounts(
  {
    domain: "FA",
    orgScope: HQ,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    asOf: AS_OF,
    scenarioId: "FA-S21",
  },
  risks,
);
check("FA-S02应评估分母不含候选", faS02.requiredObjects.length, 0);
check("FA-S21应评估分母不含候选", faS21.requiredObjects.length, 0);

const Q1_CTX = { periodStart: "2026-01-01", periodEnd: "2026-03-31", asOf: AS_OF, risks };
const q1Fa = computeIndicator(indicator("FA-I06"), HQ, Q1_CTX);
check("Q1投资计划执行率未覆盖", q1Fa.status, "unknown");
check("Q1投资计划执行率原因", q1Fa.emptyReason, "该期间数据未覆盖");
check("Q1不含P-PAY001", seed.cash_transactions.some((t) => t.id === "P-PAY001" && inDateRange(t.date, "2026-01-01", "2026-03-31")), false);
check(
  "2025H2含历史付款",
  seed.cash_transactions.some((t) => t.id === "HIST-PAY01" && inDateRange(t.date, "2025-07-01", "2025-12-31")),
  true,
);

const viewUser = userById("USER-HQ-VIEW");
check("只读不能发布规则", can(viewUser, "config.rules.publish"), false);
check("只读不能重置配置", can(viewUser, "config.reset"), false);
check("只读不能督办", canCaseAction(viewUser, "urge"), false);
check("只读不能采用整改材料", canCaseAction(viewUser, "adopt_rectification"), false);

const configUser = userById("USER-CONFIG");
const configOrgs = intersectOrgScope("ORG-HQ", true, configUser);
check("配置管理员业务组织交集为空", configOrgs.size, 0);
check(
  "配置管理员执行率无业务",
  computeIndicator(indicator("FA-I06"), configOrgs, CTX).status,
  "no_business",
);
check("独立试算样本不含总部项目名", INDEPENDENT_TRIAL_PROJECTS.some((p) => p.name.includes("基地能力")), false);
check("独立试算样本甲预算", INDEPENDENT_TRIAL_PROJECTS[0].effective_approved_budget, 10000);

const pay = seed.cash_transactions.find((t) => t.id === "P-PAY001");
check("R07实付1200", pay?.amount_wan_cny, 1200);
check("R07批准800", pay?.approved_amount, 800);
check("R07可支付上限2000", pay?.certified_payable_amount, 2000);

console.log("\n[综合总览主体口径]");
const overviewScopeHq = {
  orgIds: HQ,
  authorizedOrgIds: HQ,
  allowedObjectIds: null as string[] | null,
  risks: seed.risk_cases,
  actions: seed.case_actions,
  asOf: AS_OF,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  ctx: CTX,
};
check("总部含下级纳管单位不含部门/项目部", managedOrganizations(HQ).some((o) => o.id === "ORG-HQ-FIN" || o.id === "ORG-A-PMO"), false);
check("总部含下级纳管单位含总部", managedOrgCount(HQ) >= 19, true);
check("总部仅本级纳管单位", managedOrgCount(HQ_SELF), 1);
check("工程项目期间实施规模", seed.engineering_projects.length, 64);
check(
  "工程项目本期完工",
  seed.engineering_projects.filter((p) => p.status === "本期完工").length,
  9,
);
check("总部含下级纳管项目大于原6个", inScopeProjectCount(HQ, null, PERIOD_START, PERIOD_END) > 6, true);
check("总部仅本级纳管项目", inScopeProjectCount(HQ_SELF, null, PERIOD_START, PERIOD_END), 0);
const orgA = orgScope("ORG-A", true);
check("单位A含下级纳管单位（不含总部）", managedOrgCount(orgA), 3);
check("单位C纳管单位", managedOrgCount(orgScope("ORG-C", true)), 1);
check("单位C纳管项目", inScopeProjectCount(orgScope("ORG-C", true), null, PERIOD_START, PERIOD_END), 0);
const hitOrgs = hitOwnerOrgIds(overviewScopeHq);
check("命中涉及单位不含无直接对象的总部", hitOrgs.includes("ORG-HQ"), false);
check("命中涉及单位含单位A直接归属对象", hitOrgs.includes("ORG-A"), true);
check("命中涉及单位仍含实际归属A1", hitOrgs.includes("ORG-A1"), true);
const aStats = orgNodeStats("ORG-A", overviewScopeHq);
const aSelfProjects = inScopeProjectCount(new Set(["ORG-A"]), null, PERIOD_START, PERIOD_END, AS_OF);
check("单位A含下级项目数大于本级", aStats.projectCount > aSelfProjects, true);
const a1Stats = orgNodeStats("ORG-A1", overviewScopeHq);
const a1Self = inScopeProjectCount(new Set(["ORG-A1"]), null, PERIOD_START, PERIOD_END, AS_OF);
check("末级A1含下级与本级项目数相同", a1Stats.projectCount, a1Self);
const bStats = orgNodeStats("ORG-B", overviewScopeHq);
const bSelf = inScopeProjectCount(new Set(["ORG-B"]), null, PERIOD_START, PERIOD_END, AS_OF);
check("无三级的单位B含下级与本级项目数相同", bStats.projectCount, bSelf);
const overviewCards = overviewDomainCards(overviewScopeHq, () => true);
const faCard = overviewCards.find((c) => c.domain === "FA");
check("总览领域卡顺序与侧栏一致且不含股权投资", overviewCards.map((c) => c.domain).join(","), OVERVIEW_DOMAIN_ORDER.join(","));
check("总览不保留股权投资卡片", overviewCards.some((c) => c.domain === "EQ"), false);
check(
  "纳管项目不含股权投资专属项目",
  inScopeProjects(HQ, null, PERIOD_START, PERIOD_END, AS_OF).some((p) => p.kind === "equity_project"),
  false,
);
check("配置领域不再提供股权投资管理", DOMAIN_OPTIONS.some((d) => d.id === "EQ"), false);
check("仅有股权投资权限时迁入投资管理", migrateSupervisionDomainIds(["EQ"]).join(","), "FA");
check("已有投资管理权限不重复添加", migrateSupervisionDomainIds(["FA", "EQ"]).join(","), "FA");
check("固定资产完成额与执行率同属FA-I06", Boolean(faCard && faCard.metrics.length === 2 && faCard.metrics.every((m) => m.indicatorId === "FA-I06")), true);
check("固定资产主指标为投资计划执行率", faCard?.metrics[0]?.label, "投资计划执行率");
check("固定资产辅助字段为投资完成额", faCard?.metrics[1]?.label, "投资完成额");
check("默认截至日命中单位显示数字", /^\d+$/.test(hitOrgMetric(overviewScopeHq).display), true);
const histAsOf = "2026-05-15";
const histScope = {
  ...overviewScopeHq,
  asOf: histAsOf,
  ctx: { ...CTX, asOf: histAsOf },
};
const openRect = openRectificationCases(overviewScopeHq);
check("历史截至日R11仍显示未关闭", openRectificationCases(histScope).some((r) => r.id === "R11"), true);
check("6月末R11不在未关闭整改", openRect.some((r) => r.id === "R11"), false);
check("历史截至日不含截至日后评估", validHitRecords(histScope).length, 0);
check("历史截至日无适用监测执行", applicableMonitorExecutions(HQ, histScope).evaluations + applicableMonitorExecutions(HQ, histScope).actualRows, 0);
check("历史截至日监测状态为未开展", orgMonitorStatus(HQ, histScope), "not_started");
check("历史截至日命中单位显示—", hitOrgMetric(histScope).display, "—");
check("历史截至日命中单位状态未开展监测", hitOrgMetric(histScope).caption, "未开展监测");
check("历史截至日不按空命中数组报0", hitOrgMetric(histScope).orgIds.length, 0);
const histFa = overviewDomainCards(histScope, () => true).find((c) => c.domain === "FA");
check("历史截至日领域命中为—", histFa?.hitRuleDisplay, "—");
check("历史截至日领域监测未开展", histFa?.hitMonitorLabel, "未开展监测");
check("历史截至日单位卡命中为—", orgNodeStats("ORG-A", histScope).hitRuleDisplay, "—");
check("历史截至日执行率不沿用6月末", computeIndicator(indicator("FA-I06"), HQ, { ...CTX, asOf: histAsOf }).status, "unknown");
check(
  "待核查不计入未关闭整改",
  openRect.every((r) => r.status !== "pending_review" && r.status !== "investigating"),
  true,
);
check("未关闭整改不含已排除", openRect.every((r) => r.status !== "excluded" && r.status !== "closed"), true);
check("逾期整改是未关闭整改子集", overdueRectificationCases(overviewScopeHq).every((r) => openRect.some((x) => x.id === r.id)), true);
check("本期完成整改仍为关闭", completedRectificationCases(overviewScopeHq).every((r) => r.status === "closed"), true);
check("原R01–R09仍在种子中", ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09"].every((id) => seed.risk_cases.some((r) => r.id === id)), true);

const hqSnaps = snapshotRisksAtAsOf(seed.risk_cases, AS_OF, seed.case_actions).filter((r) => HQ.has(r.owner_org_id));
const stageHq = rectificationStageCensus(hqSnaps.filter((r) => remainsInSupervisionScope(r.domains)));
check(
  "股权投资专属未关闭事项退出总览",
  hqSnaps.filter((r) => isOpen(r) && !remainsInSupervisionScope(r.domains)).every((r) => !openRect.some((x) => x.id === r.id)),
  true,
);
check(
  "仍关联保留领域且已进入整改的共享事项留在总览",
  hqSnaps
    .filter(
      (r) =>
        remainsInSupervisionScope(r.domains) &&
        r.domains.includes("EQ") &&
        (r.status === "rectifying" || r.status === "pending_verification"),
    )
    .every((r) => openRect.some((x) => x.id === r.id)),
  true,
);
check("总览未关闭整改等于整改中+待复核明细", openRect.map((r) => r.id).sort().join(","), stageHq.openRectification.join(","));
check("种子待核查R-FP-032不计入未关闭整改", openRect.some((r) => r.id === "R-FP-032"), false);
check("R01待核查不计入未关闭整改", openRect.some((r) => r.id === "R01"), false);
const rightsOpen = openRectificationCases(overviewScopeHq, "RIGHTS");
const rightsStage = rectificationStageCensus(
  snapshotRisksAtAsOf(seed.risk_cases, AS_OF, seed.case_actions).filter((r) => HQ.has(r.owner_org_id) && r.domains.includes("RIGHTS")),
);
check("产权领域未关闭整改与明细一致", rightsOpen.map((r) => r.id).sort().join(","), rightsStage.openRectification.join(","));

const s032Act: CaseAction = {
  id: "ACT-TEST-S032",
  risk_id: "R-FP-032",
  action: "confirm_rectification",
  date: "2026-06-30",
  actor: "验收",
  from_status: "pending_review",
  to_status: "rectifying",
  note: "专业核查结论关联整改",
  effective_date: "2026-06-30",
  sequence: 9001,
  recorded_at: "2026-06-30T00:00:00Z",
};
const after032 = {
  ...overviewScopeHq,
  actions: [...seed.case_actions, s032Act],
  risks: seed.risk_cases.map((r) => (r.id === "R-FP-032" ? { ...r, status: "rectifying" as const } : r)),
};
const openAfter032 = openRectificationCases(after032);
check("S032转整改中后计入总览未关闭整改", openAfter032.some((r) => r.id === "R-FP-032"), true);
check("S032转整改中后总览=原明细+1", openAfter032.length, openRect.length + 1);
const rightsAfter = openRectificationCases(after032, "RIGHTS");
check("S032转整改中后产权领域同步+1", rightsAfter.length, rightsOpen.length + 1);
const hist032 = {
  ...after032,
  asOf: "2026-06-20",
  ctx: { ...CTX, asOf: "2026-06-20" },
};
check("历史截至日不把后来办理写入S032", openRectificationCases(hist032).some((r) => r.id === "R-FP-032"), false);
check("历史截至日S032仍为待核查", statusAtAsOf(after032.risks.find((r) => r.id === "R-FP-032")!, "2026-06-20", after032.actions), "pending_review");
const wbHist = rectificationStageCensus(snapshotRisksAtAsOf(after032.risks, "2026-06-20", after032.actions).filter((r) => HQ.has(r.owner_org_id)));
check("历史工作台待核查含S032", wbHist.pending.includes("R-FP-032"), true);
check("历史工作台整改跟踪不含S032", wbHist.rectifying.includes("R-FP-032"), false);

check("EQ-I11总览不因首页启用", overviewIndicatorEnabled(indicator("EQ-I11")), false);
check("现金回报偏差随 EQ-I08 未启用", overviewIndicatorEnabled(indicator("EQ-CASH-DEVIATION")), false);
check("现金回报偏差不在首页展示", overviewIndicatorOnHomepage(indicator("EQ-CASH-DEVIATION")), false);
check("部门节点存在但不计入单位数", seed.organizations.some((o) => o.id === "ORG-HQ-FIN") && !isManagedUnit(seed.organizations.find((o) => o.id === "ORG-HQ-FIN")!), true);

console.log("\n[指标抽屉范围与联动]");
const hqUser = userById("USER-HQ-REG");
const aScope = intersectOrgScope("ORG-A", true, hqUser);
check("单位A含下级取数不含B", aScope.has("ORG-B"), false);
check("单位A含下级取数含A1", aScope.has("ORG-A1"), true);
check("单位A含下级取数不含总部", aScope.has("ORG-HQ"), false);

const faLeaves = indicatorLeaves(indicator("FA-I06"), CTX);
const aLeaves = scopedIndicatorLeaves(faLeaves, aScope);
check("单位A范围执行率明细不含单位B项目", aLeaves.every((l) => aScope.has(l.orgId)), true);
check("单位A范围执行率明细不含ORG-B", aLeaves.some((l) => l.orgId === "ORG-B"), false);

const aMetric = computeIndicator(indicator("FA-I06"), aScope, CTX);
check("单位A执行率覆盖与明细同口径", aMetric.coverage.expected, aLeaves.length);
check("单位A执行率叶子与覆盖一致", aMetric.leaves.length, aLeaves.length);

const assetLeaves = scopedIndicatorLeaves(indicatorLeaves(indicator("FA-I14"), CTX), aScope);
const assetIds = new Set(assetLeaves.map((l) => l.objectId));
const projectLeaf = aLeaves[0];
check("项目叶子对资产指标不适用", Boolean(projectLeaf) && !assetIds.has(projectLeaf.objectId), true);
const clamped = resolveDrawerSelection(
  { kind: "leaf", id: projectLeaf?.objectId ?? "FA-P001" },
  "ORG-A",
  aScope,
  assetIds,
);
check("切换不适用叶子回到筛选单位A而非总部", clamped, { kind: "org", id: "ORG-A" });
const clampedHq = resolveDrawerSelection({ kind: "org", id: "ORG-HQ" }, "ORG-A", aScope, assetIds);
check("祖先总部不可作为A范围取数节点", clampedHq, { kind: "org", id: "ORG-A" });

const rollupA = metricRollupOrgIds("ORG-A", "ORG-A", true, aScope);
check("单位A汇总不含B", rollupA.has("ORG-B"), false);
const rollupHqOutside = metricRollupOrgIds("ORG-HQ", "ORG-A", true, aScope);
check("祖先总部汇总为空不扩大取数", rollupHqOutside.size, 0);

const faRunnable = runnableDrawerIndicators("FA");
check("固定资产可运行入口含FA-I06", faRunnable.some((d) => d.id === "FA-I06"), true);
check("固定资产可运行入口不含停用或仅目录FA-I01", faRunnable.some((d) => d.id === "FA-I01"), false);
check("固定资产可运行入口不含股权指标", faRunnable.some((d) => d.domain !== "FA"), false);
check("EQ-I11不得作为运行入口", isRunnableDrawerIndicator(indicator("EQ-I11")), false);
check("按ID过滤跨领域选项", switchableDrawerIndicators("FA", [indicator("FA-I06"), indicator("EQ-BALANCE")]).every((d) => d.domain === "FA" && d.id !== "EQ-BALANCE"), true);

check("无业务不当成异常", isIndicatorAbnormalStatus("no_business"), false);
check("未评估不当成异常", isIndicatorAbnormalStatus("unknown"), false);
check("正常不当成异常", isIndicatorAbnormalStatus("normal"), false);
check("关注计入当前指标异常", isIndicatorAbnormalStatus("attention"), true);
check("高风险计入当前指标异常", isIndicatorAbnormalStatus("risk"), true);

const mixedLeaf = {
  ...aLeaves[0],
  riskIds: ["R99"],
};
check("关联事项不改变异常判定函数", relatedMatterIds([mixedLeaf]).includes("R99") && !isIndicatorAbnormalStatus("normal"), true);

const domains: DomainId[] = ["FA", "EQ", "INTL", "CASH", "RIGHTS", "ENG"];
for (const d of domains) {
  const list = runnableDrawerIndicators(d);
  check(`${d}运行入口均属本领域且可计算`, list.every((x) => x.domain === d && typeof x.leaves === "function"), true);
}

console.log("\n[FP-20260916-R2 资金与产权]");
const fpCat = extractCatalog();
const cash2 = fpCat.subscenarios.filter((s) => /^CASH2-S\d{3}$/.test(s.id) && !s.id.startsWith("CASH2-S9"));
const pty2 = fpCat.subscenarios.filter((s) => /^PTY2-S\d{3}$/.test(s.id));
check("资金正式子场景40条", cash2.length, 40);
check("产权正式子场景40条", pty2.length, 40);
check("80条ID唯一", new Set([...cash2, ...pty2].map((s) => s.id)).size, 80);
const drafts = fpCat.subscenarios.filter((s) => s.id === "CASH2-S901" || s.id === "CASH2-S902");
check("个人名义补充场景为草稿且未启用", drafts.length === 2 && drafts.every((s) => !s.enabled && s.status === "draft"), true);
for (const id of FIRST_BATCH_SUBS) {
  const sub = fpCat.subscenarios.find((s) => s.id === id);
  check(`${id} 已发布启用`, Boolean(sub?.enabled && sub.status === "published"), true);
}
const payFp = seed.cash_transactions.find((t) => t.id === "P-PAY001");
check("P-PAY001 实付1200", payFp?.amount_wan_cny, 1200);
check("P-PAY001 批准800", payFp?.approved_amount, 800);
check("P-PAY001 上限2000", payFp?.certified_payable_amount, 2000);
check("CASH2-S039 命中P-PAY001", trialCashS039("P-PAY001").result, "hit");
check("CASH2-S039 正常付款可评估", trialCashS039("P-FA001").result === "clear" || trialCashS039("P-FA001").result === "not_applicable" || trialCashS039("P-FA001").result === "hit", true);
check("PTY-M001 来源差异不适用未登记", trialPtyS028("PTY-M001").result, "not_applicable");
check("PTY-M009 应登记未办命中", trialPtyS028("PTY-M009").result, "hit");
check("PTY2-S032 专业核查不自动刷绿", trialRule("PTY2-S032", "LE-CTRL").result, "data_insufficient");
const i10 = fpCat.indicators.find((i) => i.id === "CASH2-I10");
check("CASH2-I10 未启用", Boolean(i10 && i10.enabled === false), true);
syncLiveFromCatalog(fpCat);
const cashPage = runnableDrawerIndicators("CASH", "domain_page");
check("领域页不含未启用CASH2-I10", cashPage.some((d) => d.id === "CASH2-I10"), false);
check("领域页含营业收入", cashPage.some((d) => d.id === "CASH2-I01"), true);
check("领域页含带息债务", cashPage.some((d) => d.id === "CASH2-I07"), true);
check("领域页含流动比率", cashPage.some((d) => d.id === "CASH2-I08"), true);
check("领域页含净资产收益率", cashPage.some((d) => d.id === "CASH2-I13"), true);
check("领域页含账户资金余额", cashPage.some((d) => d.id === "CASH-I01"), true);
check("领域页不含负债总额主卡", cashPage.some((d) => d.id === "CASH2-I05"), false);
const i05 = fpCat.indicators.find((i) => i.id === "CASH2-I05");
check("CASH2-I05 仅指标目录", i05?.display_position, "metric_library");
const i13 = fpCat.indicators.find((i) => i.id === "CASH2-I13");
check("CASH2-I13 领域页启用", Boolean(i13?.enabled && i13.display_position === "domain_page"), true);
const roe = nodeValue("CASH2-I13");
check("总部净资产收益率不年化", Number(roe.value?.toFixed(2)), Number(((4920 / 82500) * 100).toFixed(2)));
check("ROE分子净利润", roe.numerator, 4920);
check("ROE分母平均净资产", roe.denominator, 82500);
check("盈利能力四项", [...CASH2_PROFIT_IDS], ["CASH2-I01", "CASH2-I02", "CASH2-I03", "CASH2-I13"]);
check("资产负债四项", [...CASH2_BS_IDS], ["CASH2-I04", "CASH2-I06", "CASH2-I07", "CASH2-I08"]);
check("资金流动性四项", [...CASH2_LIQ_IDS], ["CASH-I01", "CASH-I02", "CASH-I07", "CASH2-I09"]);
const hqKidsDrawer = drawerChildOrgs("ORG-HQ", "ORG-HQ", true, HQ).map((o) => o.id);
const hqKidsOverview = visibleChildOrgs("ORG-HQ", HQ).map((o) => o.id);
check("抽屉组织树与总览直属下级一致", hqKidsDrawer, hqKidsOverview);
const r07 = seed.risk_cases.find((r) => r.id === "R07");
check("R07 仍关联CASH-S01", r07?.scenario_ids.includes("CASH-S01"), true);
check("R07 同步关联CASH2-S039", r07?.scenario_ids.includes("CASH2-S039"), true);

syncLiveFromCatalog(fpCat);
const payScenarios = configuredScenarios("CASH", null, "CASH2-T-PAYMENT");
check("业务收付表不含仅定义CASH2-S001", payScenarios.includes("CASH2-S001"), false);
check("业务收付表含已启用CASH2-S039", payScenarios.includes("CASH2-S039"), true);
check("业务收付表不含草稿CASH2-S901", payScenarios.includes("CASH2-S901"), false);
const specScenarios = configuredScenarios("CASH", null, "CASH2-T-SPECIAL");
check("专项专题含CASH2-S031", specScenarios.includes("CASH2-S031"), true);
check("专项专题不含CASH2-S039", specScenarios.includes("CASH2-S039"), false);
const tradeScenarios = configuredScenarios("RIGHTS", null, "PTY2-T-TRADE");
check("产权交易不含PTY-S01", tradeScenarios.includes("PTY-S01"), false);
check("产权交易含PTY2-S006", tradeScenarios.includes("PTY2-S006"), true);
const identScenarios = configuredScenarios("RIGHTS", null, "PTY2-T-IDENTITY");
check("标识专题默认无仅定义条目", identScenarios.every((id) => fpCat.subscenarios.find((s) => s.id === id)?.enabled), true);
const rightsPage = runnableDrawerIndicators("RIGHTS", "domain_page");
check("产权领域页含纳管法人户数", rightsPage.some((d) => d.id === "PTY2-I01"), true);

const specAcc = seed.accounts.find((a) => a.id === "ACC-SPEC");
const intAcc = seed.accounts.find((a) => a.id === "ACC-INT");
check("专户ACC-SPEC期末520万", specAcc ? (specAcc.closing_balance_native * specAcc.fx_to_cny) / 10000 : 0, 520);
check("专户ACC-SPEC全部受限", specAcc?.restricted_balance_native, specAcc?.closing_balance_native);
check("专户截至日", specAcc?.balance_as_of, "2026-06-30");
check("内部账户不重复计余额", intAcc?.closing_balance_native, 0);
const uniqueAcc = new Set(seed.accounts.map((a) => a.id));
check("账户ID不重复", uniqueAcc.size, seed.accounts.length);
check("容差0仍命中P-PAY001", trialCashS039("P-PAY001", { amount_tolerance_wan: 0 }).result, "hit");
check("容差0.01仍命中P-PAY001", trialCashS039("P-PAY001", { amount_tolerance_wan: CASH_S039_TOLERANCE_MAX_WAN }).result, "hit");
check("容差500仍命中P-PAY001", trialCashS039("P-PAY001", { amount_tolerance_wan: 500 }).result, "hit");
const clamped500 = trialCashS039("P-PAY001", { amount_tolerance_wan: 500 });
check("500万元容差被限制为货币精度", clamped500.inputs.amount_tolerance_wan, CASH_S039_TOLERANCE_MAX_WAN);
check("500万元容差标记已钳制", clamped500.inputs.amount_tolerance_clamped, true);
check("P-PAY001无有效批准变更", clamped500.inputs.approval_change, false);
const sme01 = FP_SME.find((s) => s.id === "SME-01");
check("SME到期按验收日起合同日", sme01?.due_date, "2026-05-20");
check("SME起算不是发票日", sme01?.start_event, "验收合格");
const histEval = seed.rule_evaluations.find((e) => e.id === "FP-EVAL-S039-OK");
check("历史评估版本仍为FP-R2-1", histEval?.rule_version, "FP-R2-1");
const rule039 = fpCat.rules.find((r) => r.id === "CASH2-R039");
if (rule039) {
  const published = {
    ...rule039,
    published: {
      version: "FP-R2-2",
      at: "2026-06-30",
      operator: "验收",
      scope: "样例",
      effective_date: "2026-06-30",
      parameters: { amount_tolerance_wan: CASH_S039_TOLERANCE_MAX_WAN, amount_tolerance_unit: "万元" },
    },
    version_id: "FP-R2-2",
  };
  const neu = evaluationsForPublish(published, "2026-06-30");
  check("发布追加新评估", neu.some((e) => e.id.includes("FP-R2-2") && e.subject_object_id === "P-PAY001"), true);
  check("新评估不占用历史ID", neu.every((e) => e.id !== "FP-EVAL-S039-OK"), true);
  check("历史评估仍在种子", Boolean(histEval), true);
  const payEval = neu.find((e) => e.subject_object_id === "P-PAY001");
  check("合理容差发布后P-PAY001仍命中", payEval?.result, "hit");
  check("新评估采用货币精度容差", payEval?.inputs.amount_tolerance_wan, CASH_S039_TOLERANCE_MAX_WAN);
}

const bridge = cashAccountStatementBridge();
check("监管账户合计7152", bridge.accountTotalWan, 7152);
check("总部合并报表货币资金6800", bridge.statementWan, 6800);
check("账户与报表差额352", bridge.gapWan, 352);
check("专户520计入监管账户", bridge.lines.some((l) => l.id === "ACC-SPEC" && l.amount_wan === 520), true);
check("差额依据不含虚构168万元在途", /168万元为在途|差额168/.test(cashBridgeNote()), false);
check("差额标明待核实", bridge.lines.some((l) => l.id === "GAP-352" && l.status === "unverified"), true);
const specLine = bridge.lines.find((l) => l.id === "ACC-SPEC");
check("专户不因受限排除报表", specLine?.note.includes("受限不等于报表排除"), true);

console.log("\n[FP-20260916-R3 趋势、同分类切换与专题覆盖]");
const s011 = fpCat.subscenarios.find((s) => s.id === "CASH2-S011");
check("S011 主专题为资金收付", s011?.topic_id, "CASH2-T-PAYMENT");
check("S011 覆盖写入与覆盖一致", MAIN_TOPIC_OVERRIDE["CASH2-S011"], "CASH2-T-PAYMENT");
const profitSwitch = switchableDrawerIndicators("CASH", cashPage, "domain_page", "profitability");
check("盈利能力切换不含资产负债率", profitSwitch.some((d) => d.id === "CASH2-I06"), false);
check("盈利能力切换不含可用资金", profitSwitch.some((d) => d.id === "CASH-I01"), false);
check("盈利能力切换含营业收入", profitSwitch.some((d) => d.id === "CASH2-I01"), true);
check("盈利能力切换含净资产收益率", profitSwitch.some((d) => d.id === "CASH2-I13"), true);
const liqSwitch = switchableDrawerIndicators("CASH", cashPage, "domain_page", "liquidity");
check("流动性切换不含营业收入", liqSwitch.some((d) => d.id === "CASH2-I01"), false);
check("流动性切换含账户资金余额", liqSwitch.some((d) => d.id === "CASH-I01"), true);
const nearestA1 = nearestApplicableOrgId("ORG-A1", "ORG-HQ", HQ, "CASH2-I01");
check("无独立报表节点切报表指标回到适用上级", nearestA1 === "ORG-A" || nearestA1 === "ORG-HQ", true);
check("ORG-A1 对营业收入不适用", orgApplicableForIndicator("ORG-A1", "CASH2-I01"), false);
check("ORG-A 对营业收入适用", orgApplicableForIndicator("ORG-A", "CASH2-I01"), true);
check("S040 ACC-B 命中", trialCashS040("ACC-B").result, "hit");
check("S040 ACC-A 正常", trialCashS040("ACC-A").result, "clear");
check("S040 ACC-USD 缺资料", trialCashS040("ACC-USD").result, "data_insufficient");
check("S012 GUAR-01 超额度命中", trialCashS012("GUAR-01").result, "hit");
check("S012 GUAR-OK 未超额度", trialCashS012("GUAR-OK").result, "clear");
check("S029 LEND-01 到期未收命中", trialCashS029("LEND-01").result, "hit");
check("S029 LEND-OK 已收回", trialCashS029("LEND-OK").result, "clear");
check("S025 PTY-M011 授权期满后使用命中", trialPtyS025("PTY-M011").result, "hit");
check("S025 PTY-M012 授权有效", trialPtyS025("PTY-M012").result, "clear");
const acctTopic = configuredScenarios("CASH", null, "CASH2-T-ACCOUNT");
const finTopic = configuredScenarios("CASH", null, "CASH2-T-FINANCE");
const opTopic = configuredScenarios("CASH", null, "CASH2-T-OPERATION");
check("账户专题含S040", acctTopic.includes("CASH2-S040"), true);
check("融资专题含S012", finTopic.includes("CASH2-S012"), true);
check("运作专题含S029", opTopic.includes("CASH2-S029"), true);
check("标识专题含S025", identScenarios.includes("PTY2-S025"), true);
const i01 = indicator("CASH2-I01");
const spec01 = trendSpecOf(i01.id);
const pts01 = spec01 ? computeTrendPoints(i01, HQ, CTX, spec01, computeIndicator) : [];
const eligible01 = spec01 ? eligibleTrendPoints(pts01, spec01.minPoints) : null;
check("营业收入月度趋势至少两点", Boolean(eligible01 && eligible01.filter((p) => p.value !== null).length >= 2), true);
check("营业收入趋势不补未来点", pts01.every((p) => p.asOf <= AS_OF), true);
const i13def = indicator("CASH2-I13");
const spec13 = trendSpecOf(i13def.id);
check("ROE 趋势频率为季度", spec13?.frequency, "quarter");
const pts13 = spec13 ? computeTrendPoints(i13def, HQ, CTX, spec13, computeIndicator) : [];
check("ROE 不用月度伪造点", pts13.every((p) => /季度/.test(p.label)), true);
const usableRoe = pts13.filter((p) => p.value !== null);
check("ROE 有独立季度点", usableRoe.length >= 2, true);
const i01cat = fpCat.indicators.find((i) => i.id === "CASH2-I01");
check("营业收入分类为盈利能力", i01cat?.category_id, "profitability");
check("分类标签", CATEGORY_LABEL.profitability, "盈利能力");
const illegalTrade = validateSub(
  { ...fpCat.subscenarios.find((s) => s.id === "PTY2-S025")!, topic_id: "PTY2-T-IDENTITY", primary_phase_id: "PTY2-ST-TRADE" },
  fpCat.groups,
  fpCat.subscenarios,
  false,
);
check("标识专题拒绝交易实施主环节", Boolean(illegalTrade.primary_phase_id), true);
const cashPhase = validateSub(
  { ...fpCat.subscenarios.find((s) => s.id === "CASH2-S039")!, primary_phase_id: "PTY2-ST-TRADE" },
  fpCat.groups,
  fpCat.subscenarios,
  false,
);
check("资金场景拒绝产权环节", Boolean(cashPhase.primary_phase_id), true);
const asOfMay = { ...CTX, asOf: "2026-05-15", periodEnd: "2026-06-30" };
const ptsMay = spec01 ? computeTrendPoints(i01, HQ, asOfMay, spec01, computeIndicator) : [];
check("截至5月15日趋势不含5月末以后点", ptsMay.every((p) => p.asOf <= "2026-05-15"), true);
const pty1 = indicator("PTY2-I01");
const specPty = trendSpecOf(pty1.id);
const ptsPty = specPty ? computeTrendPoints(pty1, HQ, CTX, specPty, computeIndicator) : [];
check("产权户数趋势适用为从不显示", specPty?.applicability, "never");
check("产权户数首页不配趋势", specPty?.homeVisible, false);
check("产权户数详情不配趋势", specPty?.detailVisible, false);

console.log("\n[FP-20260916-R3.1 一级目录与下半区]");
const cashDir = officialDirectory("CASH");
const rightsDir = officialDirectory("RIGHTS");
check("资金官方一级场景为11项", cashDir.length, 11);
check("产权官方一级场景为10项", rightsDir.length, 10);
check("资金一级ID按原始顺序", cashDir.map((g) => g.id), [...CASH_OFFICIAL_PRIMARY_IDS]);
check("产权一级ID按原始顺序", rightsDir.map((g) => g.id), [...RIGHTS_OFFICIAL_PRIMARY_IDS]);
check("资金目录不含P12", cashDir.some((g) => g.id === "CASH2-P12"), false);
check("资金子场景为40条", officialSubIds("CASH").length, 40);
check("产权子场景为40条", officialSubIds("RIGHTS").length, 40);
check("目录不含S901", officialSubIds("CASH").includes("CASH2-S901"), false);
check("无启用子场景的P03仍在目录", cashDir.some((g) => g.id === "CASH2-P03" && g.children.length === 2), true);
check("无启用子场景的P05仍在目录", cashDir.some((g) => g.id === "CASH2-P05"), true);
check("无启用子场景的PTY2-P01仍在目录", rightsDir.some((g) => g.id === "PTY2-P01" && g.children.length === 4), true);
const enabledOfficial = fpCat.subscenarios.filter((s) => officialSubIds("CASH").includes(s.id) || officialSubIds("RIGHTS").includes(s.id)).filter((s) => s.enabled);
check("未批量启用80条", enabledOfficial.length, FIRST_BATCH_SUBS.length);
check("已启用为首批可执行覆盖条数", enabledOfficial.map((s) => s.id).sort(), [...FIRST_BATCH_SUBS].slice().sort());
const allTopicsCash = scopedDirectory("CASH", null);
check("全部专题仍为11项一级", allTopicsCash.length, 11);
const payDir = scopedDirectory("CASH", "CASH2-T-PAYMENT");
check("收付专题一级不从命中反向生成", payDir.every((g) => (CASH_OFFICIAL_PRIMARY_IDS as readonly string[]).includes(g.id)), true);
check("收付专题含P01原有子场景", payDir.find((g) => g.id === "CASH2-P01")?.children.some((c) => c.id === "CASH2-S001"), true);
check("收付专题不含账户子场景S040", payDir.some((g) => g.children.some((c) => c.id === "CASH2-S040")), false);
const identDir = scopedDirectory("RIGHTS", "PTY2-T-IDENTITY");
check("标识专题不含交易一级P01", identDir.some((g) => g.id === "PTY2-P01"), false);
check("标识专题含P08", identDir.some((g) => g.id === "PTY2-P08"), true);
const tradeDir = scopedDirectory("RIGHTS", "PTY2-T-TRADE");
check("交易专题按条件关联含登记P09", tradeDir.some((g) => g.id === "PTY2-P09"), true);
check("交易专题按条件关联含标识P08", tradeDir.some((g) => g.id === "PTY2-P08"), true);
check("交易专题按条件关联含控制P10", tradeDir.some((g) => g.id === "PTY2-P10"), true);
check("登记专题不含交易P01", scopedDirectory("RIGHTS", "PTY2-T-REG").some((g) => g.id === "PTY2-P01"), false);
const cashNames = coveragePrimaries("CASH").map((p) => p.primary_name);
const rightsNames = coveragePrimaries("RIGHTS").map((p) => p.primary_name);
check("资金一级名称与对照表一致", cashDir.map((g) => g.name), cashNames);
check("产权一级名称与对照表一致", rightsDir.map((g) => g.name), rightsNames);
check("S001 不标补充监管场景", scenarioAdoption("CASH2-S001") === SUPPLEMENTAL_SCENARIO_LABEL, false);
check("S039 纳入方式为结构化监测", scenarioAdoption("CASH2-S039"), "结构化监测");
check("S032 纳入方式为专业核查", scenarioAdoption("PTY2-S032"), "专业核查");
check("S001 目录来源为资金监管场景目录", scenarioSourceLabel("CASH2-S001"), "资金监管场景目录");
check("PTY2-S024 目录来源为产权监管场景目录", scenarioSourceLabel("PTY2-S024"), "产权监管场景目录");
check("S901 不进入官方目录来源", scenarioSourceLabel("CASH2-S901"), "资金产权补充草稿");
const p03group = fpCat.groups.find((g) => g.id === "CASH2-P03");
check("无启用子场景的一级组仍发布为目录", p03group?.status, "published");
const s001 = fpCat.subscenarios.find((s) => s.id === "CASH2-S001");
check("S001 仍为草稿未启用", Boolean(s001 && !s001.enabled && s001.status === "draft"), true);
check("历史评估版本仍为FP-R2-1", histEval?.rule_version, "FP-R2-1");
check("R07 历史整改关联保留", r07?.scenario_ids.includes("CASH-S01") && r07?.scenario_ids.includes("CASH2-S039"), true);
check("业务收付表仍不含仅定义CASH2-S001", payScenarios.includes("CASH2-S001"), false);

console.log("\n[FP-20260917-R3.2 可执行覆盖]");
syncLiveFromCatalog(fpCat);
check("S006 银行确认清单一致未命中", trialCashS006("BANK-LE-A").result, "clear");
check("S017 合法分摊未命中", trialCashS017("VCH-001").result, "clear");
check("S020 批准早于生效未命中", trialCashS020("SAL-ADJ-OK").result, "clear");
check("S003 决策早于实施节点", trialPtyS003("PTY-M002").result, "clear");
check("S011 专业核查不自动认定隐匿", trialPtyS011("PTY-M002").result, "data_insufficient");
check("S014 已回避未命中", trialPtyS014("PTY-M002").result, "clear");
check("S016 成交等于评估基准", trialPtyS016("PTY-M002").result, "clear");
check("S037 有偿转让价款未足额", trialPtyS037("PTY-M002").result, "hit");
check("S037 无偿划转不适用", trialPtyS037("PTY-M003").result, "not_applicable");
check("S038 许可在有效期", trialPtyS038("PTY-M012").result, "clear");
check("无偿划转不套价款规则", scenarioFitsBehavior("PTY2-S037", "free_transfer"), false);
check("非上市转让适用价款规则", scenarioFitsBehavior("PTY2-S037", "nonlisted_transfer"), true);
for (const [primary, sub] of Object.entries(COVERAGE_REPRESENTATIVE)) {
  check(`${primary} 代表规则当前可执行`, hasEffectiveExecutableRule(sub), true);
}
const lastNote = lastExecutableCoverageNote(fpCat, { kind: "sub", id: "CASH2-S039" });
check("停用非最后一条不提示一级停监测", lastNote, null);
const onlyS006 = {
  ...fpCat,
  subscenarios: fpCat.subscenarios.map((s) =>
    s.parent_id === "CASH2-P03" && s.id !== "CASH2-S006" ? { ...s, enabled: false, status: "disabled" as const } : s,
  ),
  rules: fpCat.rules.map((r) =>
    r.primary_subscenario_id !== "CASH2-S006" && fpCat.subscenarios.find((s) => s.id === r.primary_subscenario_id)?.parent_id === "CASH2-P03"
      ? { ...r, enabled: false, status: "disabled" as const }
      : r,
  ),
};
check(
  "停用P03最后一条提示不再监测",
  Boolean(lastExecutableCoverageNote(onlyS006, { kind: "sub", id: "CASH2-S006" })?.includes("将不再开展后续监测")),
  true,
);
check("R32 未批量启用全部80条", fpCat.subscenarios.filter((s) => s.enabled && /^CASH2-S\d{3}$|^PTY2-S\d{3}$/.test(s.id) && !s.id.startsWith("CASH2-S9")).length < 80, true);

console.log("\n[监管场景详情业务化展示]");
const payEval = seed.rule_evaluations.find((e) => e.id === "EVAL-P-PAY001-APPROVAL")!;
const s039View = verificationFromEval(payEval, { riskStatus: "pending_review", scenarioIds: ["CASH2-S039"] });
check("S039 展示该笔有效批准800", s039View.facts.some((f) => f.label === "该笔有效批准金额" && f.value === "800万元"), true);
check("S039 展示实际支付1200", s039View.facts.some((f) => f.label === "实际支付金额" && f.value === "1200万元"), true);
check("S039 展示超出批准400", s039View.facts.some((f) => f.label === "超出批准金额" && f.value === "400万元"), true);
check("S039 业务授权上限2000单独展示", s039View.facts.some((f) => f.label === "业务授权上限" && f.value === "2000万元"), true);
check("S039 上限说明不与该笔批准混淆", s039View.facts.some((f) => f.label === "业务授权上限" && (f.note ?? "").includes("不得与该笔有效批准金额混淆")), true);
check("S039 容差0", s039View.facts.some((f) => f.label === "货币精度容差" && f.value === "0万元"), true);
check("S039 核验结果为命中待核查", s039View.resultLabel, "命中，待核查");
check("S039 结果不是已确认违规", s039View.resultLabel.includes("已确认违规"), false);
check("S039 保留原公式", Boolean(s039View.formula.includes("1200") && s039View.formula.includes("800")), true);
const s039Ok = seed.rule_evaluations.find((e) => e.id === "FP-EVAL-S039-OK")!;
const s039OkView = verificationFromEval(s039Ok, { riskStatus: "closed" });
check("S039 正常付款展示未命中", s039OkView.resultLabel.includes("未命中"), true);
check("S039 正常付款批准与实付一致", s039OkView.facts.some((f) => f.label === "该笔有效批准金额" && f.value === "4200万元") && s039OkView.facts.some((f) => f.label === "实际支付金额" && f.value === "4200万元"), true);
const s037p = seed.rule_evaluations.find((e) => e.id === "FP-EVAL-S037P-HIT")!;
const s037View = verificationFromEval(s037p, { riskStatus: "pending_review", scenarioIds: ["PTY2-S037"] });
check("S037 应收价款800", s037View.facts.some((f) => f.label === "应收价款" && f.value === "800万元"), true);
check("S037 已核实到账480", s037View.facts.some((f) => f.label === "已核实到账" && f.value === "480万元"), true);
check("S037 到期未收320", s037View.facts.some((f) => f.label === "到期未收" && f.value === "320万元"), true);
check("S037 结果命中待核查", s037View.resultLabel, "命中，待核查");
const s011Trial = trialPtyS011("PTY-M002");
const s011View = verificationFromEval(
  {
    rule_id: "PTY2-R011",
    subject_object_id: "PTY-M002",
    inputs: s011Trial.inputs,
    formula: s011Trial.formula,
    effective_result: "data_insufficient",
    result: "clear",
    rule_version: "FP-R32-1",
    window_start: "2026-01-01",
    window_end: "2026-06-30",
    evidence_ids: ["EVID-FP-011"],
    risk_ids: ["R-FP-011"],
    missing: s011Trial.missing,
  },
  { riskStatus: "pending_review", scenarioIds: ["PTY2-S011"] },
);
check("S011 专业核查标明不能视为已确认违规", s011View.resultLabel.includes("不能视为已确认违规"), true);
check("S011 结论为待专业核查", s011View.resultLabel.includes("待专业核查"), true);
check("S011 监测对象用事项名称", objectTitle("PTY-M002").includes("被投企业A部分股权协议转让"), true);
check("S032 法人名称优先于内部ID", objectTitle("LE-CTRL"), "海工控股装备公司");
const holds = holdingRowsFor("JV001");
check("产权持股仍为三条来源", holds.length, 3);
check("产权持股60/60/55分列", holds.map((h) => h.pct).sort((a, b) => b - a).join("/"), "60/60/55");
check("产权持股使用中文主体", holds.every((h) => h.investorName === "下属二级单位A" && h.investeeName === "被投企业A"), true);
check("产权持股含来源与基准日", holds.every((h) => h.source && h.asOf === "2026-06-30"), true);
check("产权持股差异待核实", Boolean(holdingDiffNote(holds)?.includes("待核实")), true);
check("监测说明去掉首批路径评估", monitoringNoteLabel("首批路径评估", "evaluated_hit"), "发现关注事项");
check("监测说明去掉R3.2覆盖文案", monitoringNoteLabel("R3.2 覆盖路径评估", "evaluated_clear"), "本次监测未发现异常");
check("英文字段 actual 映射为实际支付金额", inputFieldLabel("actual"), "实际支付金额");
const r011 = seed.risk_cases.find((r) => r.id === "R-FP-011");
const r032 = seed.risk_cases.find((r) => r.id === "R-FP-032");
check("S011 事项仍为待核查", r011?.status, "pending_review");
check("S032 事项仍为待核查", r032?.status, "pending_review");
check("S011证据入口去掉对象代码", evidenceTitle("EVID-FP-011").includes("PTY-M002"), false);
check("S011证据入口保留中文材料名", evidenceTitle("EVID-FP-011").includes("审计评估范围清单"), true);

console.log(`\n合计：${passed} 项通过，${failures.length} 项未通过。`);
if (failures.length) {
  console.log("\n未通过明细：");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log("全部验收断言通过。\n");
