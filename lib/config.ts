import configJson from "@/data/configuration_seed.json";
import { descendantOrgIds, orgScope } from "./org";
import { caseRemainsInSupervisionScope, isRetiredSupervisionDomain } from "./supervision-scope";
import type { DomainId } from "./types";

/** V1.6 配置种子：与业务种子分开装载，供权限、配置页、覆盖迁移与 AI 使用。 */
export const config = configJson as ConfigRoot;

export interface DataScope {
  mode: "org_subtree" | "org_only" | "explicit_objects" | "none";
  root_org_ids: string[];
  object_ids: string[];
}

export interface ConfigUser {
  id: string;
  name: string;
  org_id: string;
  role_ids: string[];
  domain_ids: DomainId[] | string[];
  data_scope: DataScope;
  status: string;
  config_domain_ids: string[];
}

export interface ConfigRole {
  id: string;
  name: string;
  actions: string[];
}

export interface CoverageProjection {
  legacy_record_id: string;
  scenario_id: string;
  object_id: string;
  phase_id: string;
  record_kind: string;
  include_in_monitored_count: boolean;
  include_in_hit_count: boolean;
  include_in_required_denominator: boolean;
  include_in_default_monitoring_table: boolean;
}

export interface ConfigRoot {
  version: string;
  product_name: string;
  initial_user_id: string;
  data_notice: { entry_label: string; text: string };
  ui: { sidebar_width: number; brand_lines: string[] };
  roles: ConfigRole[];
  users: ConfigUser[];
  settings: { id: string; route: string; label: string; tabs: { id: string; label: string }[] };
  scenario_groups: { id: string; domain: string; name: string; status: string; version: number }[];
  subscenarios: {
    id: string;
    name: string;
    domain: string;
    parent_id?: string;
    group_id?: string;
    status: string;
    enabled?: boolean;
    execution_mode?: string;
    primary_phase_id?: string;
    object_types?: string[];
    applicability_status?: string;
  }[];
  rule_definitions: {
    id: string;
    name: string;
    status: string;
    enabled: boolean;
    primary_subscenario_id?: string;
    condition_description?: string;
    parameters?: Record<string, unknown>;
    version_id?: string;
    effective_from?: string;
  }[];
  indicator_definitions: {
    id: string;
    domain: string;
    name: string;
    formula_display: string;
    definition_note: string;
    status: string;
    enabled: boolean;
    display_position?: string;
  }[];
  rule_editor: {
    new_rule_example: {
      id: string;
      name: string;
      primary_subscenario_id: string;
      parameters: { deviation_gt_pct: number };
      note: string;
      version_id: string;
    };
  };
  ai: {
    enabled?: boolean;
    label: string;
    mode_display: string;
    external_model_connected: boolean;
    unrecognized_question: string;
    tasks: { id: string; name: string }[];
  };
  coverage_migration: { projection: CoverageProjection[] };
}

export const coverageById = new Map(
  config.coverage_migration.projection.map((p) => [p.legacy_record_id, p]),
);

export const users = config.users as ConfigUser[];
export const roles = config.roles as ConfigRole[];
export const initialUserId = config.initial_user_id;

export const userById = (id: string) => users.find((u) => u.id === id);

export function actionsFor(user: ConfigUser): Set<string> {
  const set = new Set<string>();
  for (const rid of user.role_ids) {
    const role = roles.find((r) => r.id === rid);
    role?.actions.forEach((a) => set.add(a));
  }
  return set;
}

export function can(user: ConfigUser | undefined, action: string): boolean {
  if (!user) return false;
  if (user.status === "disabled" || user.status === "retired") return false;
  return actionsFor(user).has(action);
}

/** 授权组织集合。系统管理员默认无业务组织，不能因配置权限看到全树。 */
export function authorizedOrgIds(user: ConfigUser | undefined): Set<string> {
  const empty = new Set<string>();
  if (!user || user.data_scope.mode === "none") return empty;
  const ids = new Set<string>();
  if (user.data_scope.mode === "org_only") {
    user.data_scope.root_org_ids.forEach((id) => ids.add(id));
    return ids;
  }
  if (user.data_scope.mode === "explicit_objects") {
    user.data_scope.root_org_ids.forEach((id) => ids.add(id));
    return ids;
  }
  for (const root of user.data_scope.root_org_ids) {
    orgScope(root, true).forEach((id) => ids.add(id));
  }
  return ids;
}

export function authorizedObjectIds(user: ConfigUser | undefined): string[] | null {
  if (!user) return [];
  if (user.data_scope.mode === "explicit_objects") return user.data_scope.object_ids;
  if (user.data_scope.mode === "none") return [];
  return null; // null = 组织范围内全部对象
}

export function intersectOrgScope(filterOrg: string, includeChildren: boolean, user: ConfigUser | undefined): Set<string> {
  const wanted = orgScope(filterOrg, includeChildren);
  const allowed = authorizedOrgIds(user);
  const out = new Set<string>();
  wanted.forEach((id) => {
    if (allowed.has(id)) out.add(id);
  });
  return out;
}

export function defaultOrgFor(user: ConfigUser | undefined): { orgId: string; includeChildren: boolean } {
  if (!user || user.data_scope.mode === "none") return { orgId: "ORG-HQ", includeChildren: false };
  const root = user.data_scope.root_org_ids[0] ?? user.org_id;
  return {
    orgId: root,
    includeChildren: user.data_scope.mode === "org_subtree",
  };
}

export function objectAllowed(user: ConfigUser | undefined, orgId: string, objectId?: string): boolean {
  if (!user) return false;
  if (!authorizedOrgIds(user).has(orgId)) return false;
  const objs = authorizedObjectIds(user);
  if (objs === null) return true;
  if (!objectId) return objs.length > 0;
  return objs.includes(objectId);
}

export function canDomain(user: ConfigUser | undefined, domain: DomainId | null): boolean {
  if (!user || !can(user, "business.read")) return false;
  if (domain === null) return true;
  if (isRetiredSupervisionDomain(domain)) return false;
  if (!user.domain_ids.length) return false;
  return user.domain_ids.includes(domain);
}

export function riskVisible(
  user: ConfigUser | undefined,
  r: {
    owner_org_id: string;
    primary_object_id: string;
    domains: string[];
    rule_id?: string | null;
    scenario_ids?: readonly string[] | null;
  },
): boolean {
  if (!can(user, "business.read")) return false;
  if (!caseRemainsInSupervisionScope(r)) return false;
  if (!objectAllowed(user, r.owner_org_id, r.primary_object_id)) return false;
  if (user?.domain_ids.length && !r.domains.some((d) => (user.domain_ids as string[]).includes(d) && !isRetiredSupervisionDomain(d))) return false;
  return true;
}

const ACTION_MAP: Record<string, string[]> = {
  claim: ["case.claim"],
  confirm_rectification: ["case.investigate"],
  exclude: ["case.exclude"],
  submit_rectification: ["case.rectify.submit", "case.investigate"],
  pass_verification: ["case.verify"],
  return_verification: ["case.verify"],
  reopen: ["case.reopen"],
  urge: ["case.assign"],
  adopt_rectification: ["case.rectify.submit", "case.investigate"],
  adopt_verification: ["case.verify"],
};

export function canUrge(user: ConfigUser | undefined): boolean {
  return canCaseAction(user, "urge");
}

export function canCaseAction(user: ConfigUser | undefined, kind: string): boolean {
  if (!user) return false;
  if (user.id === "USER-HQ-REVIEW" && kind !== "pass_verification" && kind !== "return_verification") {
    return false;
  }
  const needed = ACTION_MAP[kind] ?? [];
  return needed.some((a) => can(user, a));
}

export function isIndependentReviewer(user: ConfigUser | undefined): boolean {
  return user?.id === "USER-HQ-REVIEW";
}

void descendantOrgIds;
