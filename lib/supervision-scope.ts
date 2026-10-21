import type { DomainId } from "./types";

/** 本轮退出监管范围的领域。按领域标识判断，不按名称包含“股权”删除。 */
export const RETIRED_SUPERVISION_DOMAIN: DomainId = "EQ";

export function isRetiredSupervisionDomain(domain: string | null | undefined): boolean {
  return domain === RETIRED_SUPERVISION_DOMAIN;
}

/** 仅股权投资领域的事项退出；仍关联资金、产权等保留领域的共享事项继续纳入。 */
export function remainsInSupervisionScope(domains: readonly string[]): boolean {
  return domains.some((domain) => !isRetiredSupervisionDomain(domain));
}

/**
 * 旧配置里的股权投资领域权限迁到投资管理（FA）。
 * 只去掉已退出领域，不清空其余授权。
 */
export function migrateSupervisionDomainIds(ids: readonly string[]): string[] {
  const hadRetired = ids.includes(RETIRED_SUPERVISION_DOMAIN);
  const next = ids.filter((id) => id !== RETIRED_SUPERVISION_DOMAIN);
  if (hadRetired && !next.includes("FA")) next.push("FA");
  return next;
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
