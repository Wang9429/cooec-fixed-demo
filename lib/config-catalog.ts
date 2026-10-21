import { config, type ConfigUser, type DataScope } from "./config";
import { buildFpCatalogSlice } from "./fp-catalog";
import { CASH_S039_TOLERANCE_MAX_WAN, CASH_S039_TOLERANCE_MAX_YUAN } from "./fp-tolerance";
import type { DomainId, RuleEvaluation } from "./types";
import { canonicalRightsStage, FIRST_BATCH_RUNTIME, MAIN_TOPIC_OVERRIDE, type RuntimeCapability } from "./fp-topics";
import { isRetiredSupervisionDomain, migrateSupervisionDomainIds } from "./supervision-scope";

const SEED_AS_OF = "2026-06-30";

/** 配置目录精简快照：写入 localStorage，不把规则绑定明细整包持久化。 */

export const DOMAIN_OPTIONS: { id: DomainId; label: string }[] = [
  { id: "FA", label: "投资管理" },
  { id: "INTL", label: "国际化" },
  { id: "CASH", label: "资金" },
  { id: "RIGHTS", label: "产权" },
  { id: "ENG", label: "工程" },
];

export function omitRetiredSupervisionCatalog(catalog: CatalogPersist): CatalogPersist {
  const retiredSubs = new Set(
    catalog.subscenarios.filter((s) => isRetiredSupervisionDomain(s.domain)).map((s) => s.id),
  );
  return {
    ...catalog,
    groups: catalog.groups.filter((g) => !isRetiredSupervisionDomain(g.domain)),
    subscenarios: catalog.subscenarios.filter((s) => !isRetiredSupervisionDomain(s.domain)),
    rules: catalog.rules.filter((r) => !retiredSubs.has(r.primary_subscenario_id)),
    indicators: catalog.indicators.filter((i) => !isRetiredSupervisionDomain(i.domain)),
    ai: {
      ...catalog.ai,
      allowed_domains: catalog.ai.allowed_domains.filter((d) => !isRetiredSupervisionDomain(d)),
    },
  };
}

export function migrateConfigUsers(users: ConfigUser[]): ConfigUser[] {
  return users.map((user) => ({
    ...user,
    domain_ids: migrateSupervisionDomainIds(user.domain_ids as string[]),
  }));
}

export const EXECUTION_MODE_OPTIONS = [
  { id: "structured_automatic", label: "自动监测" },
  { id: "rule_ai_human", label: "规则辅助人工" },
  { id: "professional_review_support", label: "专业核查支持" },
];

export const DATA_SCOPE_OPTIONS: { id: DataScope["mode"]; label: string }[] = [
  { id: "org_subtree", label: "组织及下级" },
  { id: "org_only", label: "仅本级组织" },
  { id: "explicit_objects", label: "指定对象" },
  { id: "none", label: "无业务数据" },
];

export type ParamMap = Record<string, string | number>;

export interface CatalogGroup {
  id: string;
  name: string;
  domain: string;
  status: string;
}

export interface CatalogSubscenario {
  id: string;
  parent_id: string;
  name: string;
  domain: string;
  execution_mode: string;
  primary_phase_id: string;
  status: string;
  enabled: boolean;
  /** pending=适用范围尚未确定；confirmed=已确定适用 */
  applicability: "pending" | "confirmed";
  required_fields: string[];
  object_types: string[];
  topic_id?: string;
  runtime_capability?: RuntimeCapability;
  description?: string;
  rule_text?: string;
  applicability_note?: string;
  associated_phase_ids?: string[];
  conditional_routes?: string[];
  business_type?: string;
  legacy_topic?: string;
  legacy_stage?: string;
}

export interface RuleVersion {
  version: string;
  at: string;
  operator: string;
  scope: string;
  effective_date: string;
  parameters: ParamMap;
}

export interface CatalogRule {
  id: string;
  name: string;
  primary_subscenario_id: string;
  condition_description: string;
  status: string;
  enabled: boolean;
  version_id: string;
  draft_parameters: ParamMap;
  published: RuleVersion | null;
  versions: RuleVersion[];
  runtime_capability?: RuntimeCapability;
  domain?: string;
}

export interface CatalogIndicator {
  id: string;
  domain: string;
  name: string;
  formula_display: string;
  definition_note: string;
  status: string;
  enabled: boolean;
  display_position: string;
  category_id?: string;
  time_type?: string;
  trend_applicability?: "conditional" | "never" | "always";
  trend_home_visible?: boolean;
  trend_detail_visible?: boolean;
  trend_frequency?: "month" | "quarter" | "half";
}

export interface CatalogAiTask {
  id: string;
  name: string;
  enabled: boolean;
}

export interface CatalogAi {
  enabled: boolean;
  mode_display: string;
  external_model_connected: boolean;
  tasks: CatalogAiTask[];
  allowed_domains: string[];
}

export interface CatalogDataSource {
  id: string;
  content: string;
  source: string;
  fallback: string;
  connection_state: string;
  notes: string;
}

export interface CatalogPersist {
  schema: 1;
  groups: CatalogGroup[];
  subscenarios: CatalogSubscenario[];
  rules: CatalogRule[];
  indicators: CatalogIndicator[];
  ai: CatalogAi;
  dataSources: CatalogDataSource[];
  runtime_evaluations?: RuleEvaluation[];
}

export const DEFAULT_DATA_SOURCES: CatalogDataSource[] = [
  {
    id: "SRC-PLAN",
    content: "投资计划、批复、概算及调整",
    source: "规划计划一体化平台或投资相关系统",
    fallback: "导入统一模板，保留批准文件和版本",
    connection_state: "拟来源，未接入",
    notes: "",
  },
  {
    id: "SRC-SAP",
    content: "投资完成、资产账面及会计收益",
    source: "SAP 及 WBS、财务核算记录",
    fallback: "财务确认的结构化文件，不用资金支付替代",
    connection_state: "拟来源，未接入",
    notes: "",
  },
  {
    id: "SRC-CASH",
    content: "资金计划及支付事实",
    source: "财务云及银行核对记录",
    fallback: "境外线下数据导入并核对完整性",
    connection_state: "拟来源，未接入",
    notes: "",
  },
  {
    id: "SRC-ASSET",
    content: "设备利用和运行状态",
    source: "设备完整性平台、船舶/设备运行记录",
    fallback: "按统一类别口径补充并复核",
    connection_state: "拟来源，未接入",
    notes: "",
  },
  {
    id: "SRC-PROGRESS",
    content: "总体进度和里程碑",
    source: "已批准计划、项目月报",
    fallback: "附件指出暂无统一进度系统，首版提供导入模板",
    connection_state: "无统一系统，首版导入",
    notes: "",
  },
  {
    id: "SRC-RIGHTS",
    content: "产权、被投企业及经营数据",
    source: "产权/投资资料和被投企业报表",
    fallback: "报送资料与法人、期间和报表范围匹配",
    connection_state: "拟来源，未接入",
    notes: "",
  },
  {
    id: "SRC-CONTRACT",
    content: "合同采购及运输",
    source: "对应业务系统、合同和物流记录",
    fallback: "统一 ID 导入，未接入范围标识",
    connection_state: "拟来源，未接入",
    notes: "",
  },
  {
    id: "SRC-MARKET",
    content: "地缘事件和行情",
    source: "公开公告、专业资料及适用行情来源",
    fallback: "Demo 用有标识的模拟曲线和真实来源的事件日期",
    connection_state: "事件日期真实，行情模拟",
    notes: "",
  },
  {
    id: "SRC-FS",
    content: "财务报表及核心业务分部利润",
    source: "经财务确认的报表/管理报表",
    fallback: "本轮使用合成报告样例，集中标注数据性质，不冒用公开公司实际报表",
    connection_state: "拟来源，未接入；Demo 为合成报告",
    notes: "资产＝负债＋权益；货币资金与账户余额差异有桥接说明",
  },
  {
    id: "SRC-TREASURY",
    content: "账户、收付、融资担保、专项资金",
    source: "财务云/资金台账/银行回单拟来源",
    fallback: "规范导入；不能声称真实银企直联已实现",
    connection_state: "拟来源，未接入",
    notes: "",
  },
  {
    id: "SRC-PTY-GOV",
    content: "产权登记、审计评估、治理履职",
    source: "产权系统/章程决议/股东名册/董事委派",
    fallback: "报送资料与法人、期间和有效时点匹配",
    connection_state: "拟来源，未接入",
    notes: "批准60%/登记60%/台账55%保留为来源差异，不直接计登记违规",
  },
];

function compactParams(raw: unknown): ParamMap {
  if (!raw || typeof raw !== "object") return {};
  const out: ParamMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "string") out[k] = v;
  }
  return out;
}

export type RuleRuntimeKind = "executable" | "manual_review" | "definition_only";

export function ruleRuntimeKind(r: CatalogRule, sub?: CatalogSubscenario | null): RuleRuntimeKind {
  const cap = r.runtime_capability ?? sub?.runtime_capability;
  if (cap === "structured_executable") return "executable";
  if (cap === "assisted_review" || cap === "professional_review") return "manual_review";
  if (cap === "definition_only") return "definition_only";
  if (sub?.execution_mode === "professional_review_support") return "manual_review";
  if (r.id === config.rule_editor.new_rule_example.id) return "executable";
  if (typeof r.draft_parameters.deviation_gt_pct === "number" || typeof r.published?.parameters.deviation_gt_pct === "number") {
    return "executable";
  }
  return "definition_only";
}

export const RULE_RUNTIME_LABEL: Record<RuleRuntimeKind, string> = {
  executable: "可执行",
  manual_review: "人工核查",
  definition_only: "仅维护定义",
};

function exampleRule(): CatalogRule {
  const ex = config.rule_editor.new_rule_example;
  const draft = compactParams(ex.parameters);
  return {
    id: ex.id,
    name: ex.name,
    primary_subscenario_id: ex.primary_subscenario_id,
    condition_description: ex.note,
    status: "draft",
    enabled: false,
    version_id: ex.version_id,
    draft_parameters: draft,
    published: null,
    versions: [],
  };
}

export function extractCatalog(): CatalogPersist {
  const groups: CatalogGroup[] = config.scenario_groups.map((g) => ({
    id: g.id,
    name: g.name,
    domain: g.domain,
    status: g.status,
  }));
  const subscenarios: CatalogSubscenario[] = config.subscenarios.map((s) => ({
    id: s.id,
    parent_id: s.parent_id ?? s.group_id ?? "",
    name: s.name,
    domain: s.domain,
    execution_mode: s.execution_mode ?? "structured_automatic",
    primary_phase_id: s.primary_phase_id ?? "",
    status: s.status,
    enabled: s.enabled !== false,
    applicability: s.applicability_status === "pending" ? "pending" : "confirmed",
    required_fields: [],
    object_types: s.object_types ?? [],
  }));
  const rules: CatalogRule[] = config.rule_definitions.map((r) => {
    const params = compactParams(r.parameters);
    const published: RuleVersion = {
      version: r.version_id ?? "RULE-BASE-1.4",
      at: r.effective_from ?? SEED_AS_OF,
      operator: "种子发布",
      scope: "种子适用范围",
      effective_date: r.effective_from ?? SEED_AS_OF,
      parameters: params,
    };
    return {
      id: r.id,
      name: r.name,
      primary_subscenario_id: r.primary_subscenario_id ?? "",
      condition_description: r.condition_description ?? "",
      status: r.status,
      enabled: r.enabled !== false,
      version_id: r.version_id ?? "RULE-BASE-1.4",
      draft_parameters: { ...params },
      published,
      versions: [published],
    };
  });
  if (!rules.some((r) => r.id === config.rule_editor.new_rule_example.id)) {
    rules.push(exampleRule());
  }
  const indicators: CatalogIndicator[] = config.indicator_definitions.map((i) => ({
    id: i.id,
    domain: i.domain,
    name: i.name,
    formula_display: i.formula_display,
    definition_note: i.definition_note,
    status: i.status,
    enabled: i.enabled !== false,
    display_position: i.display_position ?? "metric_library",
  }));
  const ai: CatalogAi = {
    enabled: config.ai.enabled !== false,
    mode_display: config.ai.mode_display,
    external_model_connected: Boolean(config.ai.external_model_connected),
    tasks: config.ai.tasks.map((t) => ({ id: t.id, name: t.name, enabled: true })),
    allowed_domains: DOMAIN_OPTIONS.map((d) => d.id),
  };
  const fp = buildFpCatalogSlice();
  const stamped = stampLegacyTopics(mergeById(subscenarios, fp.subscenarios));
  return omitRetiredSupervisionCatalog({
    schema: 1,
    groups: mergeById(groups, fp.groups),
    subscenarios: stamped,
    rules: mergeById(rules, fp.rules),
    indicators: fillIndicatorDefaults(mergeById(indicators, fp.indicators), fp.indicators),
    ai: {
      ...ai,
      tasks: mergeById(ai.tasks, fp.ai.tasks),
      allowed_domains: fp.ai.allowed_domains.filter((d) => !isRetiredSupervisionDomain(d)),
    },
    dataSources: DEFAULT_DATA_SOURCES.map((d) => ({ ...d })),
    runtime_evaluations: [],
  });
}

function stampLegacyTopics(subs: CatalogSubscenario[]): CatalogSubscenario[] {
  return subs.map((s) => {
    let next = { ...s };
    if (s.id === "CASH-S01") next.topic_id = s.topic_id ?? "CASH2-T-PAYMENT";
    if (s.id === "PTY-S01") next.topic_id = s.topic_id ?? "PTY2-T-REG";
    if (MAIN_TOPIC_OVERRIDE[s.id]) next.topic_id = MAIN_TOPIC_OVERRIDE[s.id];
    const runtime = FIRST_BATCH_RUNTIME[s.id];
    if (runtime && s.status === "draft") {
      next = {
        ...next,
        enabled: true,
        status: "published",
        applicability: "confirmed",
        runtime_capability: runtime,
      };
    }
    return next;
  });
}

function fillIndicatorDefaults(indicators: CatalogIndicator[], seed: CatalogIndicator[]): CatalogIndicator[] {
  const byId = new Map(seed.map((i) => [i.id, i]));
  return indicators.map((i) => {
    const src = byId.get(i.id);
    if (!src) return i;
    return {
      ...src,
      ...i,
      category_id: i.category_id ?? src.category_id,
      time_type: i.time_type ?? src.time_type,
      trend_applicability: i.trend_applicability ?? src.trend_applicability,
      trend_home_visible: i.trend_home_visible ?? src.trend_home_visible,
      trend_detail_visible: i.trend_detail_visible ?? src.trend_detail_visible,
      trend_frequency: i.trend_frequency ?? src.trend_frequency,
    };
  }).map((i) =>
    /^PTY2-I0[1-4]$/.test(i.id)
      ? { ...i, trend_applicability: "never" as const, trend_home_visible: false, trend_detail_visible: false }
      : i,
  );
}

function mergeById<T extends { id: string }>(base: T[], extra?: T[] | null): T[] {
  if (!extra?.length) return base.map((x) => ({ ...x }));
  const map = new Map(base.map((x) => [x.id, { ...x }]));
  for (const item of extra) {
    const prev = map.get(item.id);
    map.set(item.id, prev ? { ...prev, ...item } : { ...item });
  }
  return [...map.values()];
}

export function hydrateCatalog(raw: unknown): CatalogPersist {
  const base = extractCatalog();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<CatalogPersist>;
  const aiTasks = mergeById(base.ai.tasks, r.ai?.tasks);
  const merged: CatalogPersist = {
    schema: 1,
    groups: mergeById(base.groups, r.groups),
    subscenarios: stampLegacyTopics(
      mergeById(base.subscenarios, r.subscenarios).map((s) => {
        const seedSub = base.subscenarios.find((x) => x.id === s.id);
        const upgraded =
          seedSub && FIRST_BATCH_RUNTIME[s.id] && s.status === "draft" && seedSub.enabled
            ? {
                ...s,
                ...seedSub,
                enabled: true,
                status: "published" as const,
                applicability: "confirmed" as const,
                runtime_capability: seedSub.runtime_capability,
              }
            : s;
        return {
          ...upgraded,
          applicability: upgraded.applicability === "pending" || upgraded.applicability === "confirmed" ? upgraded.applicability : "pending",
          required_fields: Array.isArray(upgraded.required_fields) ? upgraded.required_fields : [],
          object_types: Array.isArray(upgraded.object_types) ? upgraded.object_types : [],
        };
      }),
    ),
    rules: mergeById(base.rules, r.rules).map((rule) => {
      const seedRule = base.rules.find((x) => x.id === rule.id);
      const subId = rule.primary_subscenario_id;
      const upgraded =
        seedRule &&
        FIRST_BATCH_RUNTIME[subId] &&
        rule.status === "draft"
          ? { ...rule, ...seedRule, draft_parameters: { ...(seedRule.draft_parameters ?? {}), ...(rule.draft_parameters ?? {}) } }
          : rule;
      return {
        ...upgraded,
        draft_parameters: { ...(upgraded.draft_parameters ?? {}) },
        versions: Array.isArray(upgraded.versions) ? upgraded.versions : [],
        published: upgraded.published ?? null,
      };
    }),
    indicators: fillIndicatorDefaults(mergeById(base.indicators, r.indicators), base.indicators),
    ai: {
      ...base.ai,
      ...(r.ai ?? {}),
      tasks: aiTasks,
      allowed_domains: r.ai?.allowed_domains?.length ? r.ai.allowed_domains : base.ai.allowed_domains,
    },
    dataSources: mergeById(base.dataSources, r.dataSources),
    runtime_evaluations: Array.isArray((r as CatalogPersist).runtime_evaluations)
      ? (r as CatalogPersist).runtime_evaluations
      : [],
  };
  return omitRetiredSupervisionCatalog(merged);
}

export function trialPctFromCatalog(catalog: CatalogPersist, fallback: number): number {
  const rule = catalog.rules.find((r) => r.id === config.rule_editor.new_rule_example.id);
  const n = rule?.draft_parameters?.deviation_gt_pct;
  return typeof n === "number" ? n : fallback;
}

export function isTrialRulePublished(catalog: CatalogPersist): boolean {
  const rule = catalog.rules.find((r) => r.id === config.rule_editor.new_rule_example.id);
  return Boolean(rule?.published && rule.status === "published" && rule.enabled);
}

export function nextPrefixedId(prefix: string, ids: string[]): string {
  let max = 0;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(\\d+)$`);
  for (const id of ids) {
    const m = id.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const width = prefix.includes("RULE") ? 3 : 2;
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

export function nextGroupId(domain: string, groups: CatalogGroup[]): string {
  return nextPrefixedId(`${domain}-L1-`, groups.map((g) => g.id));
}

export function nextSubId(domain: string, subs: CatalogSubscenario[]): string {
  return nextPrefixedId(`${domain}-S`, subs.map((s) => s.id));
}

export function nextRuleId(domain: string, rules: CatalogRule[]): string {
  return nextPrefixedId(`NEW-${domain}-RULE-`, rules.map((r) => r.id));
}

export function nextIndicatorId(domain: string, indicators: CatalogIndicator[]): string {
  return nextPrefixedId(`${domain}-I`, indicators.map((i) => i.id));
}

export function nextUserId(users: ConfigUser[]): string {
  return nextPrefixedId("USER-LOCAL-", users.map((u) => u.id));
}

export function nextRuleVersion(versions: RuleVersion[]): string {
  return `V${versions.length + 1}`;
}


export type FieldErrors = Record<string, string>;

export function validateUser(
  user: ConfigUser,
  opts: { actor?: ConfigUser; allUsers: ConfigUser[]; isNew?: boolean },
): FieldErrors {
  const errors: FieldErrors = {};
  if (!user.name.trim()) errors.name = "请填写用户名称";
  if (!user.org_id) errors.org_id = "请选择所属组织";
  if (!user.role_ids.length) errors.role_ids = "请至少选择一个角色";
  if (!user.data_scope) errors.data_scope_mode = "请选择数据范围";
  const mode = user.data_scope.mode;
  if (mode === "org_subtree" || mode === "org_only") {
    if (!user.data_scope.root_org_ids.length) errors.root_org_ids = "请选择授权组织";
  }
  if (mode === "explicit_objects") {
    if (!user.data_scope.object_ids.length) errors.object_ids = "请填写至少一个对象编号";
  }
  const actor = opts.actor;
  if (actor && user.id === actor.id) {
    const actorHasBusiness = actor.role_ids.some((id) => id !== "ROLE-SYSTEM-ADMIN") && actor.data_scope.mode !== "none";
    const nextHasBusinessRole = user.role_ids.some((id) => id !== "ROLE-SYSTEM-ADMIN");
    if (!actorHasBusiness && actor.role_ids.includes("ROLE-SYSTEM-ADMIN")) {
      if (user.data_scope.root_org_ids.includes("ORG-HQ") || user.data_scope.mode !== "none" || nextHasBusinessRole) {
        errors.data_scope_mode = "配置管理员不能通过修改本人范围或角色获得业务数据";
      }
    }
  }
  if (user.id === "USER-CONFIG" && user.data_scope.root_org_ids.includes("ORG-HQ")) {
    errors.root_org_ids = "配置管理员不能把本人范围改为含总部业务数据";
  }
  if (opts.isNew && opts.allUsers.some((u) => u.id === user.id)) errors.id = "用户编号已存在";
  return errors;
}

export function validateGroup(g: CatalogGroup, all: CatalogGroup[], isNew: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!g.name.trim()) errors.name = "请填写一级监管场景名称";
  if (!g.domain) errors.domain = "请选择领域";
  if (isNew && all.some((x) => x.id === g.id)) errors.id = "编号已存在";
  return errors;
}

export function validateSub(s: CatalogSubscenario, groups: CatalogGroup[], all: CatalogSubscenario[], isNew: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!s.name.trim()) errors.name = "请填写监管子场景名称";
  if (!s.parent_id) errors.parent_id = "请选择所属一级监管场景";
  if (!s.domain) errors.domain = "请选择领域";
  if (!s.execution_mode) errors.execution_mode = "请选择执行方式";
  const parent = groups.find((g) => g.id === s.parent_id);
  if (s.parent_id && !parent) errors.parent_id = "所属一级监管场景不存在";
  if (parent && s.domain && parent.domain !== s.domain) errors.domain = "子场景领域须与一级场景一致";
  if (s.domain === "CASH" && s.topic_id && !s.topic_id.startsWith("CASH2-T-")) {
    errors.topic_id = "资金子场景不能使用产权专题";
  }
  if (s.domain === "RIGHTS" && s.topic_id && !s.topic_id.startsWith("PTY2-T-")) {
    errors.topic_id = "产权子场景不能使用资金专题";
  }
  if (s.domain === "CASH" && s.primary_phase_id) {
    errors.primary_phase_id = "资金子场景不使用产权交易环节作为主环节";
  }
  if (s.domain === "RIGHTS" && s.topic_id && s.topic_id !== "PTY2-T-TRADE") {
    const stage = canonicalRightsStage(s.primary_phase_id) ?? s.primary_phase_id;
    const tradeOnly = new Set(["PTY2-ST-SCHEME", "PTY2-ST-DECISION", "PTY2-ST-AUDIT", "PTY2-ST-TRADE", "PTY2-ST-SETTLE"]);
    if (stage && tradeOnly.has(stage)) {
      errors.primary_phase_id = "非产权交易专题不能把交易环节设为主环节";
    }
  }
  if (isNew && all.some((x) => x.id === s.id)) errors.id = "编号已存在";
  return errors;
}

export function validateRule(r: CatalogRule, subs: CatalogSubscenario[], all: CatalogRule[], isNew: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!r.name.trim()) errors.name = "请填写规则名称";
  if (!r.primary_subscenario_id) errors.primary_subscenario_id = "请选择适用监管子场景";
  if (r.primary_subscenario_id && !subs.some((s) => s.id === r.primary_subscenario_id)) {
    errors.primary_subscenario_id = "适用监管子场景不存在";
  }
  const pct = r.draft_parameters.deviation_gt_pct;
  if (pct !== undefined) {
    if (typeof pct !== "number" || Number.isNaN(pct)) errors.deviation_gt_pct = "请填写数字阈值";
    else if (pct < 0 || pct > 100) errors.deviation_gt_pct = "偏差率阈值应在 0–100 之间";
  }
  if (r.primary_subscenario_id === "CASH2-S039") {
    const raw = r.draft_parameters.amount_tolerance_wan;
    const n = Number(raw ?? 0);
    if (!Number.isFinite(n) || n < 0) {
      errors.amount_tolerance_wan = "货币精度容差须为非负数字，单位万元";
    } else if (n > CASH_S039_TOLERANCE_MAX_WAN) {
      errors.amount_tolerance_wan = `货币精度容差上限 ${CASH_S039_TOLERANCE_MAX_WAN} 万元（${CASH_S039_TOLERANCE_MAX_YUAN} 元），不能把业务差额当容差`;
    }
  }
  if (isNew && all.some((x) => x.id === r.id)) errors.id = "编号已存在";
  return errors;
}

export function validateIndicator(i: CatalogIndicator, all: CatalogIndicator[], isNew: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!i.name.trim()) errors.name = "请填写指标名称";
  if (!i.domain) errors.domain = "请选择领域";
  if (!i.formula_display.trim()) errors.formula_display = "请填写口径/计算公式";
  if (
    i.category_id &&
    i.category_id !== "profitability" &&
    i.category_id !== "balance_sheet" &&
    i.category_id !== "liquidity" &&
    i.category_id !== "property_census"
  ) {
    errors.category_id = "指标分类须为盈利能力、资产负债状况、资金流动性或法人及股权统计";
  }
  if (i.trend_applicability && i.trend_applicability !== "conditional" && i.trend_applicability !== "never" && i.trend_applicability !== "always") {
    errors.trend_applicability = "趋势适用性只能是按历史条件、从不显示或始终尝试";
  }
  if (isNew && all.some((x) => x.id === i.id)) errors.id = "编号已存在";
  return errors;
}

export function validateDataSource(d: CatalogDataSource): FieldErrors {
  const errors: FieldErrors = {};
  if (!d.content.trim()) errors.content = "请填写数据内容";
  if (!d.source.trim()) errors.source = "请填写拟来源系统";
  return errors;
}

export function validateAi(ai: CatalogAi): FieldErrors {
  const errors: FieldErrors = {};
  if (ai.enabled && !ai.allowed_domains.length) errors.allowed_domains = "开启后请至少选择一个使用范围";
  if (ai.enabled && !ai.tasks.some((t) => t.enabled)) errors.tasks = "开启后请至少启用一项任务";
  return errors;
}

export function firstError(errors: FieldErrors): string | undefined {
  return Object.values(errors)[0];
}

export function blankUser(id: string): ConfigUser {
  return {
    id,
    name: "",
    org_id: "ORG-HQ",
    role_ids: ["ROLE-HQ-VIEW"],
    domain_ids: DOMAIN_OPTIONS.map((d) => d.id),
    data_scope: { mode: "none", root_org_ids: [], object_ids: [] },
    status: "enabled",
    config_domain_ids: [],
  };
}

export function blankGroup(id: string, domain = "FA"): CatalogGroup {
  return { id, name: "", domain, status: "published" };
}

export function blankSub(id: string, parent: CatalogGroup | undefined): CatalogSubscenario {
  return {
    id,
    parent_id: parent?.id ?? "",
    name: "",
    domain: parent?.domain ?? "FA",
    execution_mode: "structured_automatic",
    primary_phase_id: "",
    status: "published",
    enabled: true,
    applicability: "pending",
    required_fields: [],
    object_types: [],
    topic_id: parent?.domain === "CASH" ? "CASH2-T-PAYMENT" : parent?.domain === "RIGHTS" ? "PTY2-T-TRADE" : undefined,
    runtime_capability: "definition_only",
  };
}

export function blankRule(id: string, sub: CatalogSubscenario | undefined): CatalogRule {
  return {
    id,
    name: "",
    primary_subscenario_id: sub?.id ?? "",
    condition_description: "",
    status: "draft",
    enabled: false,
    version_id: "DRAFT-1",
    draft_parameters: { deviation_gt_pct: 10 },
    published: null,
    versions: [],
  };
}

export function blankIndicator(id: string, domain = "FA"): CatalogIndicator {
  return {
    id,
    domain,
    name: "",
    formula_display: "",
    definition_note: "",
    status: "draft",
    enabled: false,
    display_position: "metric_library",
  };
}
