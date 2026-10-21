"use client";

import React, { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { AS_OF, DEFAULT_PERIOD, seed } from "./seed";
import { nextSequence } from "./risks";
import type { CaseAction, RiskCase, RiskStatus } from "./types";
import { can, canCaseAction, config, defaultOrgFor, initialUserId, userById, type ConfigUser } from "./config";
import {
  extractCatalog,
  hydrateCatalog,
  isTrialRulePublished,
  migrateConfigUsers,
  trialPctFromCatalog,
  type CatalogPersist,
} from "./config-catalog";
import { syncLiveFromCatalog } from "./live-config";

/**
 * 本地业务与配置状态：首次从种子复制，刷新保留修改。
 * 重置业务办理状态与重置配置分开；办理后各领域与总览同步。
 */

const STORAGE_KEY = "cnooc-supervision-business-v16";
const CONFIG_KEY = "cnooc-supervision-config-v16";

export type RoleId = string;

export const ROLES: { id: RoleId; name: string; scopeNote: string; canHandle: boolean; canVerify: boolean }[] = [
  { id: "ROLE-HQ-VIEW", name: "总部查看人员", scopeNote: "总部授权范围只读", canHandle: false, canVerify: false },
  { id: "ROLE-HQ-SUPERVISE", name: "总部监管人员", scopeNote: "总部授权范围；可核查与复核", canHandle: true, canVerify: true },
  { id: "ROLE-UNIT", name: "单位管理人员", scopeNote: "本单位授权范围；可核查并提交整改", canHandle: true, canVerify: false },
  { id: "ROLE-PROJECT", name: "项目经办人员", scopeNote: "授权对象；可补充整改进展", canHandle: true, canVerify: false },
  { id: "ROLE-SYSTEM-ADMIN", name: "系统配置管理员", scopeNote: "配置维护，不自动拥有业务数据", canHandle: false, canVerify: false },
];

export interface GlobalFilters {
  orgId: string;
  includeChildren: boolean;
  periodStart: string;
  periodEnd: string;
  asOf: string;
}

export interface UrgeRecord {
  id: string;
  riskId: string;
  actor: string;
  note: string;
  effective_date: string;
  recorded_at: string;
}

export interface ImportBatch {
  id: string;
  template: string;
  recorded_at: string;
  effective_date: string;
  validRows: number;
  errorRows: number;
  note: string;
}

export interface AdoptedMaterial {
  id: string;
  riskId: string;
  materialId: string;
  title: string;
  actorUserId: string;
  actorName: string;
  note: string;
  effective_date: string;
  recorded_at: string;
}

interface PersistedState {
  risks: RiskCase[];
  actions: CaseAction[];
  urges: UrgeRecord[];
  imports: ImportBatch[];
  adoptedMaterials: AdoptedMaterial[];
  role: RoleId;
  userId: string;
}

interface ConfigPersist {
  users: ConfigUser[];
  eacTrialPct: number;
  publishedTrial: boolean;
  catalog: CatalogPersist;
}

interface StoreValue extends PersistedState {
  filters: GlobalFilters;
  setFilters: (f: Partial<GlobalFilters>) => void;
  setRole: (r: RoleId) => void;
  setUserId: (id: string) => void;
  user: ConfigUser | undefined;
  saveError: string | null;
  dirty: boolean;
  resetDemo: () => void;
  resetBusiness: () => void;
  resetConfig: () => void;
  act: (input: ActionInput) => void;
  addUrge: (riskId: string, note: string) => void;
  addImportBatch: (b: Omit<ImportBatch, "id" | "recorded_at" | "effective_date">) => void;
  adoptMaterial: (input: Omit<AdoptedMaterial, "id" | "recorded_at" | "effective_date">) => void;
  riskById: (id: string) => RiskCase | undefined;
  actionsFor: (id: string) => CaseAction[];
  materialsFor: (riskId: string) => AdoptedMaterial[];
  canAct: (action: string) => boolean;
  canCase: (kind: string) => boolean;
  eacTrialPct: number;
  setEacTrialPct: (n: number) => void;
  publishedTrial: boolean;
  publishTrial: () => void;
  configUsers: ConfigUser[];
  saveConfigUsers: (users: ConfigUser[]) => void;
  catalog: CatalogPersist;
  saveCatalog: (catalog: CatalogPersist, action: string) => boolean;
}

export type ActionKind =
  | "claim"
  | "confirm_rectification"
  | "exclude"
  | "submit_rectification"
  | "pass_verification"
  | "return_verification"
  | "reopen";

export interface ActionInput {
  riskId: string;
  kind: ActionKind;
  actor: string;
  actorUserId?: string;
  note: string;
  evidenceIds?: string[];
  measure?: string;
  responsible?: string;
  dueDate?: string | null;
}

const StoreContext = createContext<StoreValue | null>(null);

function initialState(): PersistedState {
  return {
    risks: JSON.parse(JSON.stringify(seed.risk_cases)) as RiskCase[],
    actions: JSON.parse(JSON.stringify(seed.case_actions)) as CaseAction[],
    urges: [],
    imports: [],
    adoptedMaterials: [],
    role: "ROLE-HQ-SUPERVISE",
    userId: initialUserId,
  };
}

function initialConfig(): ConfigPersist {
  const catalog = extractCatalog();
  return {
    users: migrateConfigUsers(JSON.parse(JSON.stringify(config.users)) as ConfigUser[]),
    eacTrialPct: trialPctFromCatalog(catalog, config.rule_editor.new_rule_example.parameters.deviation_gt_pct),
    publishedTrial: false,
    catalog,
  };
}

const ACTION_LABEL: Record<ActionKind, string> = {
  claim: "认领核查",
  confirm_rectification: "核查确认需整改",
  exclude: "核查排除",
  submit_rectification: "提交整改并申请复核",
  pass_verification: "复核通过",
  return_verification: "复核退回",
  reopen: "新证据重开",
};

function applyAction(
  risks: RiskCase[],
  actions: CaseAction[],
  input: ActionInput,
  asOf: string,
): { risks: RiskCase[]; actions: CaseAction[] } {
  const idx = risks.findIndex((r) => r.id === input.riskId);
  if (idx < 0) return { risks, actions };
  const prev = risks[idx];
  const next: RiskCase = { ...prev };
  let to: RiskStatus = prev.status;

  switch (input.kind) {
    case "claim":
      to = "investigating";
      next.assignee_display_name = input.actor;
      next.current_task_type = "investigation";
      break;
    case "confirm_rectification":
      to = "rectifying";
      next.current_task_type = "rectification";
      next.investigation_conclusion = input.note;
      next.rectification_plan = {
        measure: input.measure ?? input.note,
        responsible_display_name: input.responsible ?? input.actor,
        due_date: input.dueDate ?? null,
        progress_note: "措施执行中。",
      };
      next.current_task_due_date = input.dueDate ?? null;
      break;
    case "exclude":
      to = "excluded";
      next.exclusion_reason = input.note;
      next.close_reason = "excluded";
      next.closed_at = asOf;
      break;
    case "submit_rectification":
      to = "pending_verification";
      next.current_task_type = "verification";
      next.rectification_completion_note = input.note;
      // 待复核不自动停表：有效整改期限保持不变
      break;
    case "pass_verification":
      to = "closed";
      next.verification_result = "passed";
      next.verified_at = asOf;
      next.closed_at = asOf;
      next.verified_closed_at = asOf;
      next.close_reason = "rectified";
      break;
    case "return_verification":
      to = "rectifying";
      next.verification_result = "returned";
      next.current_task_type = "rectification";
      next.verified_at = null;
      next.closed_at = null;
      next.verified_closed_at = null;
      next.close_reason = null;
      break;
    case "reopen":
      to = "investigating";
      next.current_task_type = "investigation";
      next.closed_at = null;
      next.verified_closed_at = null;
      next.close_reason = null;
      next.verification_result = null;
      next.reopened_count = (prev.reopened_count ?? 0) + 1;
      break;
  }
  next.status = to;
  if (input.kind === "claim" || input.kind === "confirm_rectification" || input.kind === "submit_rectification") {
    next.last_handler_user_id = input.actorUserId ?? prev.last_handler_user_id ?? null;
  }

  const action: CaseAction = {
    id: `ACT-LOCAL-${input.riskId}-${nextSequence(actions)}`,
    risk_id: input.riskId,
    action: input.kind,
    date: asOf,
    actor: input.actor,
    from_status: prev.status,
    to_status: to,
    note: `${ACTION_LABEL[input.kind]}：${input.note}`,
    evidence_ids: input.evidenceIds ?? [],
    effective_date: asOf,
    sequence: nextSequence(actions),
    recorded_at: new Date().toISOString(),
    recorded_at_nature: "本地操作实际时间，不替代业务生效日期",
    local: true,
  };

  const newRisks = [...risks];
  newRisks[idx] = next;
  return { risks: newRisks, actions: [...actions, action] };
}

/**
 * 业务状态放在模块级外部存储中，通过 useSyncExternalStore 订阅：
 * 服务端渲染与客户端首帧都使用种子快照，读取 localStorage 在订阅时完成，
 * 因此既不会产生水合不一致，也不需要在 effect 里同步 setState。
 */
interface Snapshot {
  state: PersistedState;
  config: ConfigPersist;
  dirty: boolean;
  saveError: string | null;
}

const SERVER_SNAPSHOT: Snapshot = { state: initialState(), config: initialConfig(), dirty: false, saveError: null };
let snapshot: Snapshot = SERVER_SNAPSHOT;
let storageChecked = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function update(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function readStorage() {
  if (storageChecked) return;
  storageChecked = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed?.risks?.length) {
        if (!parsed.userId) parsed.userId = initialUserId;
        if (!parsed.role) parsed.role = "ROLE-HQ-SUPERVISE";
        if (!parsed.adoptedMaterials) parsed.adoptedMaterials = [];
        const known = new Set(parsed.risks.map((r) => r.id));
        for (const r of seed.risk_cases) {
          if (!known.has(r.id)) parsed.risks.push(JSON.parse(JSON.stringify(r)) as RiskCase);
        }
        const r07 = parsed.risks.find((r) => r.id === "R07");
        if (r07 && !r07.scenario_ids.includes("CASH2-S039")) r07.scenario_ids = [...r07.scenario_ids, "CASH2-S039"];
        const knownAct = new Set(parsed.actions.map((a) => a.id));
        for (const a of seed.case_actions) {
          if (!knownAct.has(a.id)) parsed.actions.push(JSON.parse(JSON.stringify(a)) as CaseAction);
        }
        update({ state: parsed, dirty: true });
      }
    }
    const cfg = window.localStorage.getItem(CONFIG_KEY);
    if (cfg) {
      const parsed = JSON.parse(cfg) as Partial<ConfigPersist> & { users?: ConfigUser[] };
      if (parsed?.users?.length) {
        const catalog = hydrateCatalog(parsed.catalog);
        const trialId = config.rule_editor.new_rule_example.id;
        const trial = catalog.rules.find((r) => r.id === trialId);
        if (parsed.publishedTrial && trial && !trial.published) {
          const published = {
            version: "V1",
            at: new Date().toISOString(),
            operator: "历史发布记录",
            scope: "授权范围内固定资产投资项目",
            effective_date: "2026-06-30",
            parameters: { deviation_gt_pct: parsed.eacTrialPct ?? 10 },
          };
          trial.published = published;
          trial.versions = [published];
          trial.status = "published";
          trial.enabled = true;
          trial.version_id = published.version;
        }
        const next: ConfigPersist = {
          users: migrateConfigUsers(parsed.users),
          eacTrialPct: trialPctFromCatalog(catalog, parsed.eacTrialPct ?? 10),
          publishedTrial: isTrialRulePublished(catalog) || Boolean(parsed.publishedTrial),
          catalog,
        };
        syncLiveFromCatalog(catalog);
        update({ config: next });
        try {
          const serialized = JSON.stringify(next);
          if (serialized !== cfg) window.localStorage.setItem(CONFIG_KEY, serialized);
        } catch {
          update({ saveError: "配置迁移后保存失败，本次刷新仍按已迁移结果展示。" });
        }
      }
    }
  } catch {
    update({ saveError: "本地状态读取失败，已使用种子数据。" });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  readStorage();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => SERVER_SNAPSHOT;

function writeState(next: PersistedState, dirty = true) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    update({ state: next, dirty, saveError: null });
  } catch {
    update({ state: next, dirty, saveError: "业务办理状态保存失败，本次修改仅在当前页面有效。" });
  }
}

function writeConfig(next: ConfigPersist) {
  const catalog = hydrateCatalog(next.catalog);
  const normalized: ConfigPersist = {
    ...next,
    catalog,
    eacTrialPct: trialPctFromCatalog(catalog, next.eacTrialPct),
    publishedTrial: isTrialRulePublished(catalog),
  };
  syncLiveFromCatalog(catalog);
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
    update({ config: normalized, saveError: null });
  } catch {
    update({ config: normalized, saveError: "配置保存失败，本次修改仅在当前页面有效。" });
  }
}

function clearBusiness() {
  storageChecked = true;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    update({ state: initialState(), dirty: false, saveError: null });
  } catch {
    update({ state: initialState(), dirty: false, saveError: "业务办理状态清除失败。" });
  }
}

function clearConfig() {
  try {
    window.localStorage.removeItem(CONFIG_KEY);
    const next = initialConfig();
    syncLiveFromCatalog(next.catalog);
    update({ config: next, saveError: null });
  } catch {
    const next = initialConfig();
    syncLiveFromCatalog(next.catalog);
    update({ config: next, saveError: "配置清除失败。" });
  }
}

const DEFAULT_FILTERS: GlobalFilters = {
  orgId: "ORG-HQ",
  includeChildren: true,
  periodStart: DEFAULT_PERIOD.start,
  periodEnd: DEFAULT_PERIOD.end,
  asOf: AS_OF,
};

export function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [filters, setFiltersState] = useState<GlobalFilters>(DEFAULT_FILTERS);

  const user = snap.config.users.find((u) => u.id === snap.state.userId) ?? userById(snap.state.userId);

  const act = useCallback(
    (input: ActionInput) => {
      if (!canCaseAction(user, input.kind)) return;
      const cur = snapshot.state;
      const res = applyAction(cur.risks, cur.actions, input, filters.asOf);
      writeState({ ...cur, ...res });
    },
    [filters.asOf, user],
  );

  const addUrge = useCallback(
    (riskId: string, note: string) => {
      if (!canCaseAction(user, "urge")) return;
      const rec: UrgeRecord = {
        id: `URGE-${riskId}-${Date.now()}`,
        riskId,
        actor: user?.name ?? "监管人员",
        note,
        effective_date: filters.asOf,
        recorded_at: new Date().toISOString(),
      };
      writeState({ ...snapshot.state, urges: [...snapshot.state.urges, rec] });
    },
    [filters.asOf, user],
  );

  const addImportBatch = useCallback(
    (b: Omit<ImportBatch, "id" | "recorded_at" | "effective_date">) => {
      if (!can(user, "config.import") && !can(user, "config.data.validate")) return;
      const rec: ImportBatch = {
        ...b,
        id: `IMP-${Date.now()}`,
        recorded_at: new Date().toISOString(),
        effective_date: filters.asOf,
      };
      writeState({ ...snapshot.state, imports: [...snapshot.state.imports, rec] });
    },
    [filters.asOf, user],
  );

  const adoptMaterial = useCallback(
    (input: Omit<AdoptedMaterial, "id" | "recorded_at" | "effective_date">) => {
      const verify = /VERIFY|复核/.test(input.materialId + input.title);
      if (!canCaseAction(user, verify ? "adopt_verification" : "adopt_rectification")) return;
      const rec: AdoptedMaterial = {
        ...input,
        id: `MAT-ADOPT-${input.materialId}-${Date.now()}`,
        effective_date: filters.asOf,
        recorded_at: new Date().toISOString(),
      };
      writeState({ ...snapshot.state, adoptedMaterials: [...(snapshot.state.adoptedMaterials ?? []), rec] });
    },
    [filters.asOf, user],
  );

  const resetBusiness = useCallback(() => {
    if (!can(user, "config.reset") && !can(user, "config.data.rerun")) return;
    const uid = snapshot.state.userId;
    clearBusiness();
    writeState({ ...initialState(), userId: uid }, false);
    const u = snapshot.config.users.find((x) => x.id === uid);
    setFiltersState({ ...DEFAULT_FILTERS, ...defaultOrgFor(u) });
  }, [user]);

  const resetConfig = useCallback(() => {
    if (!can(user, "config.reset")) return;
    clearConfig();
  }, [user]);

  const resetDemo = useCallback(() => {
    resetBusiness();
  }, [resetBusiness]);

  const setFilters = useCallback((f: Partial<GlobalFilters>) => {
    setFiltersState((cur) => ({ ...cur, ...f }));
  }, []);

  const setRole = useCallback((r: RoleId) => {
    writeState({ ...snapshot.state, role: r }, snapshot.dirty);
  }, []);

  const setUserId = useCallback((id: string) => {
    const u = snapshot.config.users.find((x) => x.id === id) ?? userById(id);
    writeState({ ...snapshot.state, userId: id, role: u?.role_ids[0] ?? snapshot.state.role }, snapshot.dirty);
    setFiltersState({ ...DEFAULT_FILTERS, ...defaultOrgFor(u) });
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ...snap.state,
      filters,
      setFilters,
      setRole,
      setUserId,
      user,
      saveError: snap.saveError,
      dirty: snap.dirty,
      resetDemo,
      resetBusiness,
      resetConfig,
      act,
      addUrge,
      addImportBatch,
      adoptMaterial,
      riskById: (id: string) => snap.state.risks.find((r) => r.id === id),
      actionsFor: (id: string) =>
        snap.state.actions.filter((a) => a.risk_id === id).sort((a, b) => a.sequence - b.sequence),
      materialsFor: (id: string) => snap.state.adoptedMaterials.filter((m) => m.riskId === id),
      canAct: (action: string) => can(user, action),
      canCase: (kind: string) => canCaseAction(user, kind),
      eacTrialPct: snap.config.eacTrialPct,
      setEacTrialPct: (n: number) => {
        if (!can(user, "config.rules.edit") && !can(user, "config.test")) return;
        const catalog = structuredClone(snapshot.config.catalog);
        const trialId = config.rule_editor.new_rule_example.id;
        const rule = catalog.rules.find((r) => r.id === trialId);
        if (rule) rule.draft_parameters = { ...rule.draft_parameters, deviation_gt_pct: n };
        writeConfig({ ...snapshot.config, catalog, eacTrialPct: n });
      },
      publishedTrial: snap.config.publishedTrial,
      publishTrial: () => {
        if (!can(user, "config.rules.publish")) return;
        const catalog = structuredClone(snapshot.config.catalog);
        const trialId = config.rule_editor.new_rule_example.id;
        const rule = catalog.rules.find((r) => r.id === trialId);
        if (rule) {
          const version = {
            version: `V${rule.versions.length + 1}`,
            at: new Date().toISOString(),
            operator: user?.name ?? "监管人员",
            scope: "授权范围内固定资产投资项目",
            effective_date: filters.asOf,
            parameters: { ...rule.draft_parameters },
          };
          rule.published = version;
          rule.versions = [...rule.versions, version];
          rule.status = "published";
          rule.enabled = true;
          rule.version_id = version.version;
        }
        writeConfig({ ...snapshot.config, catalog, publishedTrial: true });
      },
      configUsers: snap.config.users,
      saveConfigUsers: (next) => {
        if (!can(user, "config.users.edit")) return;
        writeConfig({ ...snapshot.config, users: migrateConfigUsers(next) });
      },
      catalog: snap.config.catalog,
      saveCatalog: (next, action) => {
        if (!can(user, action)) return false;
        writeConfig({ ...snapshot.config, catalog: next });
        return true;
      },
    }),
    [snap, filters, setFilters, setRole, setUserId, resetDemo, resetBusiness, resetConfig, act, addUrge, addImportBatch, adoptMaterial, user],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useDemoStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useDemoStore 必须在 DemoStoreProvider 内使用");
  return ctx;
}
