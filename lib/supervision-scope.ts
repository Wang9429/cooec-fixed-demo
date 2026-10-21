import type { DomainId } from "./types";

/** 本轮退出监管范围的领域。按领域标识判断，不按名称包含“股权”删除。 */
export const RETIRED_SUPERVISION_DOMAIN: DomainId = "EQ";

export function isRetiredSupervisionDomain(domain: string | null | undefined): boolean {
  return domain === RETIRED_SUPERVISION_DOMAIN;
}

/** 领域数组里还有资金、产权等保留领域。单凭这一标记不能把股权投资内容留在统计里。 */
export function remainsInSupervisionScope(domains: readonly string[]): boolean {
  return domains.some((domain) => !isRetiredSupervisionDomain(domain));
}

/**
 * 已保存配置只处理「可访问领域」这一个字段：去掉股权投资领域标识。
 * 不补固定资产投资权限，也不改写项目、指标、场景、规则或其领域归属。
 */
export function migrateSupervisionDomainIds(ids: readonly string[]): string[] {
  return ids.filter((id) => id !== RETIRED_SUPERVISION_DOMAIN);
}

/**
 * 规则和场景编号都仍属于股权投资时，事项只属于股权投资。
 * 领域数组里另写了资金，但没有资金子场景、资金规则时，不据此保留。
 */
export function isEquityInvestmentOnlyCase(risk: {
  rule_id?: string | null;
  scenario_ids?: readonly string[] | null;
}): boolean {
  const scenarios = risk.scenario_ids ?? [];
  if (scenarios.some((id) => !isRetiredScenarioId(id))) return false;
  if (risk.rule_id && !isRetiredSupervisionRuleId(risk.rule_id)) return false;
  return scenarios.length > 0 || Boolean(risk.rule_id && isRetiredSupervisionRuleId(risk.rule_id));
}

export function caseRemainsInSupervisionScope(risk: {
  domains: readonly string[];
  rule_id?: string | null;
  scenario_ids?: readonly string[] | null;
}): boolean {
  if (isEquityInvestmentOnlyCase(risk)) return false;
  return remainsInSupervisionScope(risk.domains);
}

/** 场景、规则编号以领域标识开头。产权、资金里的股权关系不使用该前缀。 */
export function isRetiredScenarioId(id: string): boolean {
  return id.startsWith(`${RETIRED_SUPERVISION_DOMAIN}-`);
}

export function isRetiredSupervisionRuleId(id: string): boolean {
  return id.startsWith(`${RETIRED_SUPERVISION_DOMAIN}-`);
}

export function visibleSupervisionDomains<T extends string>(domains: readonly T[]): T[] {
  return domains.filter((domain) => !isRetiredSupervisionDomain(domain));
}
