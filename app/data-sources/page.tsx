"use client";

import React, { useMemo, useState } from "react";
import {
  Button,
  Card,
  DataTable,
  DescList,
  EmptyState,
  Field,
  Modal,
  Notice,
  SimulatedBadge,
  Tabs,
  Tag,
  textareaClass,
} from "@/components/ui";
import { AS_OF, DOMAIN_META, coverageRows, monitoringStatusLabel, seed } from "@/lib/seed";
import { isRetiredSupervisionDomain } from "@/lib/supervision-scope";
import { useDemoStore } from "@/lib/store";
import { can } from "@/lib/config";

/**
 * P76 数据依据：数据情况、拟来源边界、规则版本、导入与演示重置。
 * “拟来源”不表示接口已打通；未接入范围明确标识。
 */

const SOURCE_ROWS = [
  { content: "投资计划、批复、概算及调整", source: "规划计划一体化平台或投资相关系统", fallback: "导入统一模板，保留批准文件和版本", state: "拟来源，未接入" },
  { content: "投资完成、资产账面及会计收益", source: "SAP 及 WBS、财务核算记录", fallback: "财务确认的结构化文件，不用资金支付替代", state: "拟来源，未接入" },
  { content: "资金计划及支付事实", source: "财务云及银行核对记录", fallback: "境外线下数据导入并核对完整性", state: "拟来源，未接入" },
  { content: "设备利用和运行状态", source: "设备完整性平台、船舶/设备运行记录", fallback: "按统一类别口径补充并复核", state: "拟来源，未接入" },
  { content: "总体进度和里程碑", source: "已批准计划、项目月报", fallback: "附件指出暂无统一进度系统，首版提供导入模板", state: "无统一系统，首版导入" },
  { content: "产权、被投企业及经营数据", source: "产权/投资资料和被投企业报表", fallback: "报送资料与法人、期间和报表范围匹配", state: "拟来源，未接入" },
  { content: "合同采购及运输", source: "对应业务系统、合同和物流记录", fallback: "统一 ID 导入，未接入范围标识", state: "拟来源，未接入" },
  { content: "地缘事件和行情", source: "公开公告、专业资料及适用行情来源", fallback: "Demo 用有标识的模拟曲线和真实来源的事件日期", state: "事件日期真实，行情模拟" },
];

const IMPORT_TEMPLATES = [
  {
    id: "progress",
    name: "进度导入模板",
    fields: "object_id、期间、总体进度%、关键里程碑ID、计划日期、实际日期、预计日期、计划版本、依据编号",
    implemented: true,
  },
  { id: "eac", name: "预测补充模板", fields: "object_id、成本来源类型、金额、单位、预计发生时间、是否已含其他项、测算依据", implemented: false },
  { id: "overseas_payment", name: "境外付款模板", fields: "payment_id、项目、合同、金额、币种、付款日期、账户、收款方、银行回单号、核对状态", implemented: false },
  { id: "asset_run", name: "资产运行模板", fields: "asset_id、监测期、可利用量、实际使用量、计量单位、数据来源、复核结论", implemented: false },
  { id: "investee", name: "被投企业经营数据模板", fields: "legal_entity_id、期间、收入、利润、资产、负债、经营现金流、报表口径、报送时间", implemented: false },
];

const SAMPLE_ROWS = [
  { row: 2, objectId: "FA-P001", period: "2026-06", value: "51", unit: "%", basis: "DEMO-PLAN-V1.2", valid: true, error: "" },
  { row: 3, objectId: "FA-P003", period: "2026-06", value: "72", unit: "%", basis: "DEMO-PLAN-V1.2", valid: true, error: "" },
  { row: 4, objectId: "FA-P999", period: "2026-06", value: "40", unit: "%", basis: "DEMO-PLAN-V1.2", valid: false, error: "对象ID不存在于当前演示数据" },
  { row: 5, objectId: "FA-P002", period: "2026-06", value: "0.8", unit: "比例", valid: false, basis: "", error: "单位不一致：期望百分比；缺少计划版本依据" },
  { row: 6, objectId: "FA-P001", period: "2026-06", value: "55", unit: "%", basis: "DEMO-PLAN-V1.1", valid: false, error: "重复键：同一对象与期间已存在有效行；且计划版本冲突" },
];

export default function DataSourcesPage() {
  const { imports, addImportBatch, resetBusiness, dirty, filters, user, canAct } = useDemoStore();
  const [tab, setTab] = useState("coverage");
  const [importOpen, setImportOpen] = useState(false);
  const [note, setNote] = useState("演示进度补录批次");
  const [flash, setFlash] = useState<string | null>(null);

  const canData = canAct("config.data.read") || can(user, "business.read");
  const canSeeCounts = can(user, "business.read");
  const canImport = canAct("config.import") || canAct("config.data.validate");
  const canResetBusiness = canAct("config.reset") || canAct("config.data.rerun");

  const statusBreakdown = useMemo(() => {
    const m: Record<string, number> = {};
    coverageRows.forEach((r) => {
      m[r.status] = (m[r.status] ?? 0) + 1;
    });
    return m;
  }, []);

  const domainBreakdown = useMemo(() => {
    return Object.values(DOMAIN_META)
      .filter((meta) => !isRetiredSupervisionDomain(meta.id))
      .map((meta) => {
      const rows = coverageRows.filter((r) => r.domain === meta.id);
      const required = rows.filter((r) => r.required && r.status !== "not_applicable" && r.status !== "reference_only");
      const evaluated = required.filter((r) => r.status === "evaluated_hit" || r.status === "evaluated_clear");
      return {
        domain: meta.id,
        label: meta.label,
        rows: rows.length,
        required: required.length,
        evaluated: evaluated.length,
        pct: required.length ? (evaluated.length / required.length) * 100 : null,
        insufficient: rows.filter((r) => r.status === "data_insufficient").length,
        missing: [...new Set(rows.flatMap((r) => r.missing_data))],
      };
    });
  }, []);

  const validRows = SAMPLE_ROWS.filter((r) => r.valid).length;
  const errorRows = SAMPLE_ROWS.length - validRows;

  return (
    <div className="space-y-4">
      {!canData && (
        <Notice tone="amber" title="访问受限">
          当前身份不能打开数据依据。请切换配置管理员或具备业务/配置数据权限的账号。
        </Notice>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-[24px] font-semibold text-textmain leading-[34px]">数据依据</h1>
        <div className="flex items-center gap-2">
          <Tag tone="brand">种子版本 {seed.version}</Tag>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "coverage", label: "数据情况与覆盖" },
          { id: "sources", label: "拟来源与边界" },
          { id: "import", label: `导入（${imports.length}）` },
          { id: "version", label: "版本与待确认参数" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "coverage" && (
        <>
          <Card title="按领域的可判定覆盖">
            <DataTable
              rows={domainBreakdown}
              rowKey={(d) => d.domain}
              columns={[
                { key: "name", title: "领域", width: "170px", render: (d) => d.label },
                { key: "rows", title: "覆盖候选行", align: "right", width: "120px", render: (d) => <span className="num">{d.rows}</span> },
                { key: "req", title: "应评估实例", align: "right", width: "120px", render: (d) => <span className="num">{d.required}</span> },
                { key: "eval", title: "已完成评估", align: "right", width: "120px", render: (d) => <span className="num">{d.evaluated}</span> },
                {
                  key: "pct",
                  title: "可判定覆盖率",
                  align: "right",
                  width: "130px",
                  render: (d) => (
                    <span className="num" style={{ color: d.pct !== null && d.pct < 100 ? "var(--risk-amber-fg)" : undefined }}>
                      {d.pct === null ? "无应评估实例" : `${d.pct.toFixed(1)}%`}
                    </span>
                  ),
                },
                {
                  key: "gap",
                  title: "数据缺口",
                  render: (d) =>
                    d.insufficient === 0 ? (
                      <span className="text-textsub">无</span>
                    ) : (
                      <span className="text-[13px]">
                        {d.insufficient} 条数据不足：{d.missing.join("、") || "未列明字段"}
                      </span>
                    ),
                },
              ]}
            />
          </Card>

          <Card title="监测状态分布">
            <DescList
              cols={3}
              items={Object.entries(statusBreakdown).map(([k, v]) => ({
                label: monitoringStatusLabel[k] ?? k,
                value: <span className="num">{v} 条</span>,
              }))}
            />
          </Card>

          <Card title="样例数据范围">
            {canSeeCounts ? (
            <DescList
              cols={4}
              items={[
                { label: "业务截至日", value: <span className="num">{AS_OF}</span> },
                { label: "默认统计期间", value: <span className="num">2026-01-01 ~ 2026-06-30</span> },
                { label: "组织管理节点", value: <span className="num">{seed.organizations.length} 个</span> },
                { label: "法律主体", value: <span className="num">{seed.legal_entities.length} 个</span> },
                { label: "投资项目", value: <span className="num">{seed.fixed_asset_projects.length} 个</span> },
                { label: "工程项目", value: <span className="num">{seed.engineering_projects.length} 个</span> },
                { label: "已转固资产", value: <span className="num">{seed.assets.length} 项</span> },
                { label: "银行账户", value: <span className="num">{seed.accounts.length} 个</span> },
                { label: "产权事项", value: <span className="num">{seed.property_matters.length} 件</span> },
                { label: "监管事项", value: <span className="num">{seed.risk_cases.length} 件</span> },
                { label: "证据材料", value: <span className="num">{seed.evidence.length} 份</span> },
              ]}
            />
            ) : (
              <Notice tone="neutral">
                当前身份无业务数据权限，不展示项目、账户与事项的全量计数。覆盖规划候选见上方“按领域的可判定覆盖”。
              </Notice>
            )}
            <div className="mt-3 flex items-center gap-2">
              <SimulatedBadge text="合成样例" />
              <span className="text-[12px] text-textsub">{seed.data_nature}｜{seed.display_notice}</span>
            </div>
          </Card>
        </>
      )}

      {tab === "sources" && (
        <Card title="拟来源与无接口时的处理">
          <DataTable
            rows={SOURCE_ROWS}
            rowKey={(r) => r.content}
            columns={[
              { key: "c", title: "数据内容", width: "230px", render: (r) => r.content },
              { key: "s", title: "按附件拟采用的来源", render: (r) => r.source },
              { key: "f", title: "无接口时的处理", render: (r) => r.fallback },
              {
                key: "st",
                title: "当前状态",
                width: "160px",
                render: (r) => <Tag tone={r.state.includes("真实") ? "brand" : "amber"}>{r.state}</Tag>,
              },
            ]}
          />
        </Card>
      )}

      {tab === "import" && (
        <>
          <Card
            title="导入模板"
            right={
              <Button variant="primary" disabled={!canImport} title={canImport ? "预览进度模板" : "当前身份不能导入"} onClick={() => setImportOpen(true)}>
                预览并导入进度模板
              </Button>
            }
          >
            <DataTable
              rows={IMPORT_TEMPLATES}
              rowKey={(t) => t.id}
              columns={[
                { key: "name", title: "模板", width: "200px", render: (t) => t.name },
                { key: "fields", title: "字段定义", render: (t) => <span className="text-[13px] text-textsub">{t.fields}</span> },
                {
                  key: "state",
                  title: "本 Demo 状态",
                  width: "200px",
                  render: (t) =>
                    t.implemented ? (
                      <Tag tone="green">已实现预览与确认导入</Tag>
                    ) : (
                      <Tag tone="neutral">仅提供字段定义与样例</Tag>
                    ),
                },
              ]}
            />
          </Card>

          <Card title="导入批次记录">
            {imports.length === 0 ? (
              <EmptyState title="尚无导入批次" />
            ) : (
              <DataTable
                rows={imports}
                rowKey={(b) => b.id}
                columns={[
                  { key: "id", title: "批次", width: "180px", render: (b) => <span className="num">{b.id}</span> },
                  { key: "tpl", title: "模板", width: "150px", render: (b) => b.template },
                  { key: "eff", title: "业务生效日", width: "120px", render: (b) => <span className="num">{b.effective_date}</span> },
                  { key: "valid", title: "有效行", align: "right", width: "90px", render: (b) => <span className="num">{b.validRows}</span> },
                  {
                    key: "err",
                    title: "错误行",
                    align: "right",
                    width: "90px",
                    render: (b) => (
                      <span className="num" style={{ color: b.errorRows ? "var(--risk-amber-fg)" : undefined }}>
                        {b.errorRows}
                      </span>
                    ),
                  },
                  { key: "note", title: "说明", render: (b) => b.note },
                ]}
              />
            )}
          </Card>
        </>
      )}

      {tab === "version" && (
        <>
          <Card title="版本信息">
            <DescList
              cols={3}
              items={[
                { label: "种子版本", value: seed.version },
                { label: "规则参数版本", value: String(seed.demo_rule_parameters.version) },
                { label: "业务截至日", value: <span className="num">{AS_OF}</span> },
                { label: "场景目录版本", value: `investment_catalog ${seed.version}` },
                { label: "阶段模板版本", value: "V1.2 命名" },
                { label: "当前会话状态", value: dirty ? "含本地办理修改" : "与种子一致" },
              ]}
            />
          </Card>

          <Card title="正式落地前需确认的参数">
            <DataTable
              rows={[
                { k: "组织层级与法人关系", v: "虚构组织树；支持缺级、分支及同法人下多个管理单位", who: "组织管理及相关业务部门" },
                { k: "“46号文”正式名称及条款映射", v: "预置国资委令第46号；场景原文与出处保留，逐条条号待核对", who: "制度管理/合规及投资管理" },
                { k: "授权、报批备案类别与例外", v: "使用有来源和版本的演示条件；不默认所有项目审批链相同", who: "投资及相关领域管理" },
                { k: "95%/100%、延期60天、±5% 等阈值", v: "按适配对照配置；标注底稿参数及待确认项", who: "固定资产投资管理" },
                { k: "设备低利用率阈值及连续周期", v: "种子以 50% 与人工确认作演示；不宣称通用于所有船舶设备", who: "资产及设备管理" },
                { k: "EAC 构成、含税口径与抵销", v: "明确示例构成与管理范围，重复成本排除", who: "投资/工程及财务" },
                { k: "后评价起算日期及应评价对象", v: "投资项目按实际投产或达到可使用状态起算", who: "投资管理" },
                { k: "事件来源、钢材规格、船型航线与转嫁条款", v: "使用明确标识的模拟事件与价格；真实历史事件仅作日期锚点", who: "国际业务、采购、物流及工程" },
                { k: "工作日、数据刷新与接口字段", v: "演示日历与批次；拟来源不显示为实际已接入", who: "业务部门及信息化" },
                { k: "核查责任、整改复核分工与办理期限", v: "虚构角色、本地状态，不冒充生产审批", who: "监管牵头及各领域管理" },
              ]}
              rowKey={(r) => r.k}
              columns={[
                { key: "k", title: "确认项", width: "270px", render: (r) => r.k },
                { key: "v", title: "本 Demo 已采用的处理", render: (r) => r.v },
                { key: "who", title: "后续确认责任", width: "220px", render: (r) => r.who },
              ]}
            />
          </Card>

          <Card title="业务办理状态">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                disabled={!canResetBusiness}
                title={
                  canResetBusiness
                    ? "清除本地核查、整改、复核、采用材料与导入批次，恢复种子业务办理状态；配置保留。"
                    : "当前身份不能重置业务办理状态"
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "业务重置将清除本地核查、整改、复核、采用材料与导入批次，恢复种子业务办理状态。用户权限与规则草稿保留。确认？",
                    )
                  ) {
                    resetBusiness();
                    setFlash("已重置业务办理状态：未关闭 8 件（红 4、黄 4），待核查 5、整改中 3、当前逾期整改 1，R09 保持已排除。");
                  }
                }}
              >
                重置业务办理状态
              </Button>
              <span className="text-[12px] text-textsub">
                当前会话{dirty ? "存在本地办理修改" : "没有本地办理修改"}；截至日固定为 {filters.asOf}。
              </span>
            </div>
            {flash && (
              <div className="mt-3">
                <Notice tone="green" title="已重置">
                  {flash}
                </Notice>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        width={880}
        title="进度导入模板 · 导入前预览"
        footer={
          <div className="flex items-center gap-2 justify-end">
            <Button onClick={() => setImportOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={!canImport}
              onClick={() => {
                if (!canImport) return;
                addImportBatch({
                  template: "进度导入模板",
                  validRows,
                  errorRows,
                  note: note.trim() || "演示进度补录批次",
                });
                setImportOpen(false);
                setTab("import");
                setFlash(null);
              }}
            >
              确认导入 {validRows} 行有效数据
            </Button>
          </div>
        }
      >
        <DataTable
          dense
          rows={SAMPLE_ROWS}
          rowKey={(r) => String(r.row)}
          columns={[
            { key: "row", title: "行号", width: "64px", render: (r) => <span className="num">{r.row}</span> },
            { key: "obj", title: "对象ID", width: "110px", render: (r) => <span className="num">{r.objectId}</span> },
            { key: "period", title: "期间", width: "90px", render: (r) => <span className="num">{r.period}</span> },
            { key: "v", title: "数值", align: "right", width: "80px", render: (r) => <span className="num">{r.value}</span> },
            { key: "u", title: "单位", width: "80px", render: (r) => r.unit },
            { key: "basis", title: "依据/计划版本", width: "150px", render: (r) => r.basis || <span className="text-textsub">缺失</span> },
            {
              key: "state",
              title: "校验结果",
              render: (r) =>
                r.valid ? <Tag tone="green">有效</Tag> : <span className="text-[13px]" style={{ color: "var(--risk-red-fg)" }}>{r.error}</span>,
            },
          ]}
        />
        <div className="mt-3">
          <Field label="批次说明">
            <textarea className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Notice tone="amber" title="预览结果">
            有效 {validRows} 行，错误 {errorRows} 行（缺字段、重复键、单位不一致、版本冲突各有具体提示）。
            确认导入只写入有效行并保留批次记录，不覆盖已批准基准。
          </Notice>
        </div>
      </Modal>
    </div>
  );
}
