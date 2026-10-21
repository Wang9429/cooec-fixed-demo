import type { CatalogPersist, CatalogSubscenario, CatalogRule } from "./config-catalog";
import { extractCatalog, ruleRuntimeKind } from "./config-catalog";
import { isExecutableCapability } from "./fp-topics";
import { setLiveScenarioNames } from "./scenario-names-live";
import { isRetiredScenarioId } from "./supervision-scope";
import type { RuleEvaluation } from "./types";

export interface LiveExtraScenario {
  id: string;
  domain: string;
  name: string;
  primary_phase_id: string;
  applicability: "pending" | "confirmed";
  required_fields: string[];
  object_types: string[];
  execution_mode: string;
  enabled: boolean;
}

export interface LiveWatchRule {
  ruleId: string;
  version: string;
  pct: number;
  scope: string;
  effective_date: string;
}

export interface LiveIndicatorMeta {
  id: string;
  enabled: boolean;
  status: string;
  display_position: string;
  name: string;
  domain: string;
  category_id?: string;
  trend_applicability?: "conditional" | "never" | "always";
  trend_home_visible?: boolean;
  trend_detail_visible?: boolean;
  trend_frequency?: "month" | "quarter" | "half";
}

interface LiveState {
  disabledScenarioIds: Set<string>;
  extraScenarios: LiveExtraScenario[];
  scenarioNames: Map<string, string>;
  subs: Map<string, CatalogSubscenario>;
  indicators: Map<string, LiveIndicatorMeta>;
  publishedWatch: LiveWatchRule | null;
  rules: CatalogRule[];
  aiEnabled: boolean;
  aiTasks: Set<string>;
  aiDomains: Set<string>;
  aiExternalConnected: boolean;
  aiModeDisplay: string;
  runtimeEvaluations: RuleEvaluation[];
}

let seedIds = new Set<string>();
let booted = false;

function bootFromCatalog(): void {
  if (booted) return;
  booted = true;
  const catalog = extractCatalog();
  seedIds = new Set(catalog.subscenarios.map((s) => s.id));
  syncLiveFromCatalog(catalog);
}

function emptyLive(): LiveState {
  return {
    disabledScenarioIds: new Set(),
    extraScenarios: [],
    scenarioNames: new Map(),
    subs: new Map(),
    indicators: new Map(),
    publishedWatch: null,
    rules: [],
    aiEnabled: true,
    aiTasks: new Set(),
    aiDomains: new Set(["FA", "INTL", "CASH", "RIGHTS", "ENG"]),
    aiExternalConnected: false,
    aiModeDisplay: "",
    runtimeEvaluations: [],
  };
}

let current: LiveState = emptyLive();

function isSubActive(s: CatalogSubscenario, parentDisabled: boolean): boolean {
  if (parentDisabled) return false;
  if (s.enabled === false) return false;
  return s.status !== "disabled" && s.status !== "retired";
}

export function syncLiveFromCatalog(catalog: CatalogPersist | null | undefined): void {
  booted = true;
  if (seedIds.size === 0 && catalog) {
    seedIds = new Set(catalog.subscenarios.map((s) => s.id));
  }
  if (!catalog) {
    current = emptyLive();
    setLiveScenarioNames(current.scenarioNames);
    return;
  }
  const disabledGroups = new Set(
    catalog.groups.filter((g) => g.status === "disabled" || g.status === "retired").map((g) => g.id),
  );
  const disabledScenarioIds = new Set<string>();
  const extraScenarios: LiveExtraScenario[] = [];
  const scenarioNames = new Map<string, string>();
  for (const g of catalog.groups) scenarioNames.set(g.id, g.name);
  for (const s of catalog.subscenarios) {
    scenarioNames.set(s.id, s.name);
    const parentDisabled = disabledGroups.has(s.parent_id);
    if (!isSubActive(s, parentDisabled)) disabledScenarioIds.add(s.id);
    if (!seedIds.has(s.id)) {
      extraScenarios.push({
        id: s.id,
        domain: s.domain,
        name: s.name,
        primary_phase_id: s.primary_phase_id,
        applicability: s.applicability,
        required_fields: s.required_fields ?? [],
        object_types: s.object_types ?? [],
        execution_mode: s.execution_mode,
        enabled: isSubActive(s, parentDisabled),
      });
    }
  }
  const indicators = new Map<string, LiveIndicatorMeta>();
  for (const i of catalog.indicators) {
    indicators.set(i.id, {
      id: i.id,
      enabled: i.enabled !== false && i.status !== "disabled" && i.status !== "retired",
      status: i.status,
      display_position: i.display_position,
      name: i.name,
      domain: i.domain,
      category_id: i.category_id,
      trend_applicability: i.trend_applicability,
      trend_home_visible: i.trend_home_visible,
      trend_detail_visible: i.trend_detail_visible,
      trend_frequency: i.trend_frequency,
    });
  }
  const subs = new Map(catalog.subscenarios.map((s) => [s.id, s]));
  let publishedWatch: LiveWatchRule | null = null;
  for (const r of catalog.rules) {
    if (!r.published || r.status !== "published" || r.enabled === false) continue;
    const kind = ruleRuntimeKind(r, subs.get(r.primary_subscenario_id));
    if (kind !== "executable") continue;
    const n = r.published.parameters.deviation_gt_pct;
    if (typeof n !== "number") continue;
    if (!publishedWatch || r.published.effective_date >= publishedWatch.effective_date) {
      publishedWatch = {
        ruleId: r.id,
        version: r.published.version,
        pct: n,
        scope: r.published.scope,
        effective_date: r.published.effective_date,
      };
    }
  }
  current = {
    disabledScenarioIds,
    extraScenarios,
    scenarioNames,
    subs,
    indicators,
    publishedWatch,
    rules: catalog.rules,
    aiEnabled: catalog.ai.enabled !== false,
    aiTasks: new Set(catalog.ai.tasks.filter((t) => t.enabled !== false).map((t) => t.id)),
    aiDomains: new Set(catalog.ai.allowed_domains),
    aiExternalConnected: Boolean(catalog.ai.external_model_connected),
    aiModeDisplay: catalog.ai.mode_display,
    runtimeEvaluations: catalog.runtime_evaluations ?? [],
  };
  setLiveScenarioNames(scenarioNames);
}

export function getLiveConfig(): LiveState {
  bootFromCatalog();
  return current;
}

export function isScenarioMonitoringActive(id: string): boolean {
  bootFromCatalog();
  return !current.disabledScenarioIds.has(id);
}

/** 业务执行区：已启用、已发布、具备自动/辅助/专业核查路径，且当前时点有有效版本。 */
export function hasEffectiveExecutableRule(subId: string, asOf = "2026-06-30"): boolean {
  bootFromCatalog();
  const sub = current.subs.get(subId);
  if (!sub) return false;
  if (current.disabledScenarioIds.has(subId)) return false;
  if (sub.status === "draft" || sub.status === "disabled" || sub.status === "retired") return false;
  if (!isExecutableCapability(sub.runtime_capability)) return false;
  return current.rules.some(
    (r) =>
      r.primary_subscenario_id === subId &&
      r.enabled !== false &&
      r.status === "published" &&
      Boolean(r.published) &&
      (r.published?.effective_date ?? "9999-12-31") <= asOf,
  );
}

export function liveSub(id: string): CatalogSubscenario | undefined {
  bootFromCatalog();
  return current.subs.get(id);
}

export function publishedWatchRule(): LiveWatchRule | null {
  bootFromCatalog();
  return current.publishedWatch;
}

export function liveRules(): CatalogRule[] {
  bootFromCatalog();
  return current.rules;
}

export function liveRule(id: string): CatalogRule | undefined {
  bootFromCatalog();
  return current.rules.find((r) => r.id === id);
}

export function liveRuleLabel(id: string): string {
  const r = liveRule(id);
  return r ? `${r.id} ${r.name}` : id;
}

export function catalogIndicatorMeta(id: string): LiveIndicatorMeta | undefined {
  bootFromCatalog();
  return current.indicators.get(id);
}

export function catalogIndicatorVisible(id: string): boolean {
  if (isRetiredScenarioId(id)) return false;
  bootFromCatalog();
  const meta = current.indicators.get(id);
  if (!meta) return true;
  return meta.enabled;
}

export function catalogIndicatorOnHomepage(id: string): boolean {
  if (isRetiredScenarioId(id)) return false;
  bootFromCatalog();
  const meta = current.indicators.get(id);
  if (!meta) return true;
  return meta.enabled && meta.display_position === "homepage";
}

/** 领域页可展示的指标：首页或领域页位置，且已启用。停用不留空卡。 */
export function catalogIndicatorOnDomainPage(id: string): boolean {
  if (isRetiredScenarioId(id)) return false;
  bootFromCatalog();
  const meta = current.indicators.get(id);
  if (!meta) return true;
  if (!meta.enabled || meta.status === "disabled" || meta.status === "retired") return false;
  return meta.display_position === "homepage" || meta.display_position === "domain_page";
}

/** 停用或仅目录（无首页展示）的指标不能作为业务抽屉运行入口。 */
export function catalogIndicatorRunnableOnEntry(id: string): boolean {
  return catalogIndicatorVisible(id) && catalogIndicatorOnHomepage(id);
}

export function homepageCatalogIndicatorIds(domain?: string): string[] {
  bootFromCatalog();
  return [...current.indicators.values()]
    .filter((m) => m.enabled && m.display_position === "homepage" && (!domain || m.domain === domain))
    .map((m) => m.id);
}

export function publishedDeviationPct(): number | null {
  bootFromCatalog();
  return current.publishedWatch?.pct ?? null;
}

export function liveAi() {
  bootFromCatalog();
  return {
    enabled: current.aiEnabled,
    tasks: current.aiTasks,
    domains: current.aiDomains,
    externalConnected: current.aiExternalConnected,
    modeDisplay: current.aiModeDisplay,
  };
}
