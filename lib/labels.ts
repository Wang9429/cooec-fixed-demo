/**
 * 配置与目录枚举的界面中文。底层仍保存英文/编码值，仅展示层转换。
 */

function pick(map: Record<string, string>, value: string | null | undefined, empty = "—"): string {
  if (value == null || value === "") return empty;
  return map[value] ?? value;
}

/** 发布/启用状态 */
export const CONFIG_STATUS_LABEL: Record<string, string> = {
  published: "已发布",
  draft: "草稿",
  enabled: "启用",
  disabled: "停用",
  retired: "已停用",
  unpublished: "未发布",
  active: "启用",
  inactive: "未启用",
};

/** 监管子场景执行方式 */
export const EXECUTION_MODE_LABEL: Record<string, string> = {
  structured_automatic: "自动监测",
  rule_ai_human: "规则辅助人工",
  professional_review_support: "专业核查支持",
};

/** 用户数据范围模式 */
export const DATA_SCOPE_MODE_LABEL: Record<string, string> = {
  org_subtree: "组织及下级",
  org_only: "仅本级组织",
  explicit_objects: "指定对象",
  none: "无业务数据",
};

/** 指标展示位置 */
export const DISPLAY_POSITION_LABEL: Record<string, string> = {
  homepage: "首页",
  metric_library: "指标目录",
  domain_page: "领域页",
};

/** 领域编码（配置表短码） */
export const DOMAIN_CODE_LABEL: Record<string, string> = {
  FA: "投资管理",
  EQ: "股权投资",
  INTL: "国际化",
  CASH: "资金",
  RIGHTS: "产权",
  ENG: "工程",
};

/** 规则/子场景运行能力（与执行方式分开） */
export const RUNTIME_CAPABILITY_LABEL: Record<string, string> = {
  structured_executable: "可结构化执行",
  assisted_review: "规则辅助人工",
  professional_review: "专业核查",
  definition_only: "仅维护定义",
};

export const configStatusLabel = (v?: string | null) => pick(CONFIG_STATUS_LABEL, v);
export const executionModeLabel = (v?: string | null) => pick(EXECUTION_MODE_LABEL, v);
export const runtimeCapabilityLabel = (v?: string | null) => pick(RUNTIME_CAPABILITY_LABEL, v, "仅维护定义");
export const dataScopeModeLabel = (v?: string | null) => pick(DATA_SCOPE_MODE_LABEL, v);
export const displayPositionLabel = (v?: string | null) => pick(DISPLAY_POSITION_LABEL, v);
export const domainCodeLabel = (v?: string | null) => pick(DOMAIN_CODE_LABEL, v);
