"use client";

import React, { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card, DataTable, DescList, Drawer, EmptyState, Notice, SeverityTag, SimulatedBadge, Tabs, Tag } from "@/components/ui";
import { findObject } from "@/lib/objects";
import { DOMAIN_META, evidenceById, phaseName, scenarioName, seed, templateById } from "@/lib/seed";
import { visibleSupervisionDomains } from "@/lib/supervision-scope";
import { orgName, orgPath } from "@/lib/org";
import { fmtAmount, fmtDate, fmtPct } from "@/lib/format";
import { objectAllowed } from "@/lib/config";
import { isScenarioMonitoringActive } from "@/lib/live-config";
import { isOpen, statusLabel } from "@/lib/risks";
import { useDemoStore } from "@/lib/store";
import type { LifecycleInstance } from "@/lib/types";
import { FP_CONTROLS, FP_GUARANTEES, FP_LENDS, FP_LOANS, FP_SME, FP_SPECIALS, FP_GOVERNANCE } from "@/lib/fp-seed";
import { FP_ACCOUNT_OPENINGS, FP_NAME_LICENSES } from "@/lib/fp-history-seed";
import HoldingsTable from "@/components/fp/HoldingsTable";
import {
  dataNatureLabel,
  entityName,
  evidenceTitle,
  monitoringNoteLabel,
  objectTitle,
  relationTypeLabel,
  riskTitleOf,
} from "@/lib/fp-display";

/**
 * P74 对象档案 + P79 横向业务关系 + P75 详细环节核查。
 * 同一对象在任何入口只有一个档案，不因切换 Tab 或领域重建。
 */

const BUSINESS_STATUS_LABEL: Record<string, string> = {
  not_started: "未开始",
  preparing: "准备中",
  in_progress: "进行中",
  completed: "已完成",
  not_applicable: "不适用",
};

function StageTable({ instances }: { instances: LifecycleInstance[] }) {
  return (
    <DataTable
      rows={instances}
      rowKey={(i) => i.id}
      empty="该对象没有环节实例记录。"
      pageSize={8}
      compactEmpty
      columns={[
        { key: "phase", title: "环节", width: "130px", minWidth: "120px", nowrap: true, render: (i) => phaseName(i.phase_id) },
        {
          key: "status",
          title: "业务状态",
          width: "100px",
          render: (i) => (
            <Tag tone={i.business_status === "completed" ? "green" : i.business_status === "in_progress" ? "brand" : "neutral"}>
              {BUSINESS_STATUS_LABEL[i.business_status] ?? i.business_status}
            </Tag>
          ),
        },
        {
          key: "plan",
          title: "现有效计划",
          width: "190px",
          render: (i) => (
            <span className="num text-[12px]">
              {fmtDate(i.approved_plan_start)} ~ {fmtDate(i.approved_plan_end)}
            </span>
          ),
        },
        {
          key: "actual",
          title: "实际开始/完成",
          width: "190px",
          render: (i) => (
            <span className="num text-[12px]">
              {fmtDate(i.actual_start)} ~ {fmtDate(i.actual_end)}
            </span>
          ),
        },
        { key: "forecast", title: "预计完成", width: "110px", render: (i) => <span className="num text-[12px]">{fmtDate(i.forecast_end)}</span> },
        { key: "ver", title: "计划版本", width: "140px", render: (i) => <span className="num text-[12px]">{i.plan_version}</span> },
        {
          key: "evid",
          title: "依据",
          render: (i) =>
            i.evidence_ids.length === 0 ? (
              <span className="text-textsub">—</span>
            ) : (
              <span className="text-[12px] text-textsub" title={i.evidence_ids.map((e) => evidenceById(e)?.body ?? e).join("\n")}>
                {i.evidence_ids.map((e) => evidenceTitle(e)).join("、")}
              </span>
            ),
        },
      ]}
    />
  );
}

/** 切换对象时以 key 重挂载，页签回到入口指定的初始页签。 */
export default function ObjectDrawer({
  objectId,
  onClose,
  onOpenRisk,
  onOpenObject,
  initialTab = "profile",
  variant = "drawer",
}: {
  objectId: string | null;
  onClose: () => void;
  onOpenRisk?: (id: string) => void;
  onOpenObject?: (id: string) => void;
  initialTab?: string;
  variant?: "drawer" | "page";
}) {
  if (!objectId) return null;
  return (
    <ObjectDrawerBody
      key={`${objectId}:${initialTab}:${variant}`}
      objectId={objectId}
      onClose={onClose}
      onOpenRisk={onOpenRisk}
      onOpenObject={onOpenObject}
      initialTab={initialTab}
      variant={variant}
    />
  );
}

function ObjectDrawerBody({
  objectId,
  onClose,
  onOpenRisk,
  onOpenObject,
  initialTab,
  variant,
}: {
  objectId: string;
  onClose: () => void;
  onOpenRisk?: (id: string) => void;
  onOpenObject?: (id: string) => void;
  initialTab: string;
  variant: "drawer" | "page";
}) {
  const { risks, filters, user } = useDemoStore();
  const [tab, setTab] = useState(initialTab);

  const obj = findObject(objectId);

  const related = useMemo(
    () => seed.business_links.filter((l) => l.from_id === objectId || l.to_id === objectId),
    [objectId],
  );

  const objRisks = useMemo(
    () => risks.filter((r) => r.primary_object_id === objectId),
    [risks, objectId],
  );

  const stages = useMemo(
    () => seed.lifecycle_instances.filter((i) => i.object_id === objectId),
    [objectId],
  );

  const monitoring = useMemo(
    () => seed.scenario_monitoring_coverage.filter((r) => r.monitoring_object_id === objectId),
    [objectId],
  );

  if (obj && !objectAllowed(user, obj.orgId, obj.id)) {
    const notice = (
      <Notice tone="amber" title="超出当前授权范围">
        当前用户不能查看该对象的名称、金额或其他受限信息。
      </Notice>
    );
    if (variant === "page") {
      return (
        <Card title="访问受限">
          {notice}
        </Card>
      );
    }
    return (
      <Drawer open onClose={onClose} title="访问受限" width="60vw">
        <div className="p-6">{notice}</div>
      </Drawer>
    );
  }

  if (!obj) {
    const notice = (
      <Notice tone="amber" title="对象不在当前数据范围">
        {objectId} 在当前样例中没有档案记录。可能属于来源待核实的对象，按“来源待核实”处理，不创建虚假档案。
      </Notice>
    );
    if (variant === "page") {
      return (
        <Card title={`对象 ${objectId}`}>
          {notice}
        </Card>
      );
    }
    return (
      <Drawer open onClose={onClose} title={`对象 ${objectId}`} width="60vw">
        <div className="p-6">{notice}</div>
      </Drawer>
    );
  }

  const fa = seed.fixed_asset_projects.find((p) => p.id === objectId);
  const asset = seed.assets.find((a) => a.id === objectId);
  const eq = seed.equity_projects.find((p) => p.id === objectId);
  const eng = seed.engineering_projects.find((p) => p.id === objectId);
  const account = seed.accounts.find((a) => a.id === objectId);
  const matter = seed.property_matters.find((m) => m.id === objectId);
  const tx = seed.cash_transactions.find((t) => t.id === objectId);

  const titleNode = (
    <span className="flex items-center gap-2 flex-wrap">
      {obj.name}
      <span className="num text-[13px] text-textsub">对象编号 {obj.id}</span>
      <Tag tone="neutral">{obj.typeLabel}</Tag>
    </span>
  );
  const subtitleNode = (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      <span>管理归属：{orgPath(obj.orgId).map((o) => o.name).join(" / ")}</span>
      <span>截至日：{filters.asOf}</span>
      <SimulatedBadge text="合成样例" />
    </span>
  );

  const archive = (
      <div className={variant === "page" ? "space-y-4" : "h-full overflow-auto px-6 py-4 space-y-4"}>
        <Tabs
          tabs={[
            { id: "profile", label: "对象全景" },
            { id: "stages", label: `环节核查（${stages.length}）` },
            { id: "relations", label: `业务关系（${related.length}）` },
            { id: "monitoring", label: `监管执行（${monitoring.length}）` },
            { id: "cases", label: `监管事项（${objRisks.length}）` },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "profile" && (
          <>
            {fa && (
              <>
                <DescList
                  cols={4}
                  items={[
                    { label: "项目类型", value: fa.project_type },
                    { label: "当前业务阶段", value: fa.phase },
                    { label: "法律主体", value: entityName(fa.legal_entity_id) },
                    { label: "金额口径", value: `${fa.amount_unit}｜${fa.tax_basis ?? "—"}` },
                    { label: "可研批准估算", value: <span className="num">{fmtAmount(fa.feasibility_approved_estimate)}</span> },
                    { label: "原初设批准概算", value: <span className="num">{fmtAmount(fa.original_approved_budget)}</span> },
                    { label: "当前有效概算", value: <span className="num">{fmtAmount(fa.effective_approved_budget)}</span> },
                    { label: "预计完工投资 EAC", value: <span className="num">{fmtAmount(fa.eac)}</span>, hint: fa.eac_complete ? "构成完整" : "构成不完整，显示为已知下限" },
                    { label: "年度投资计划", value: <span className="num">{fmtAmount(fa.annual_plan)}</span> },
                    { label: "同期累计计划", value: <span className="num">{fmtAmount(fa.ytd_plan)}</span> },
                    { label: "同期完成投资", value: <span className="num">{fmtAmount(fa.ytd_completed_investment)}</span> },
                    { label: "累计完成投资", value: <span className="num">{fmtAmount(fa.cumulative_completed_investment)}</span> },
                    { label: "资金计划（同期）", value: <span className="num">{fmtAmount(fa.funds_plan_ytd)}</span> },
                    { label: "实际支付（同期）", value: <span className="num">{fmtAmount(fa.cash_paid_ytd)}</span> },
                    { label: "总体进度（计划/实际）", value: <span className="num">{fmtPct(fa.planned_progress_pct)} / {fmtPct(fa.actual_progress_pct)}</span> },
                    { label: "批准/预计完工", value: <span className="num">{fmtDate(fa.approved_completion)} / {fmtDate(fa.forecast_completion)}</span> },
                  ]}
                />
                {fa.eac_complete === false && (
                  <Notice tone="amber" title="预计完工投资数据不完整">
                    当前仅显示“已知预计投资下限”，缺失构成项已列示；不把删除缺失项后的结果标为完整 EAC。
                  </Notice>
                )}
              </>
            )}

            {asset && (
              <>
                <DescList
                  cols={4}
                  items={[
                    { label: "资产类别", value: asset.asset_type },
                    { label: "重大资产", value: asset.is_major ? "是" : "否" },
                    { label: "来源投资项目", value: <span className="num">{asset.source_project_id}</span> },
                    { label: "运行状态", value: asset.status },
                    { label: "原值", value: <span className="num">{fmtAmount(asset.gross_value)}</span> },
                    { label: "累计折旧", value: <span className="num">{fmtAmount(asset.accumulated_depreciation)}</span> },
                    { label: "减值准备", value: <span className="num">{fmtAmount(asset.impairment_allowance)}</span> },
                    { label: "账面净值", value: <span className="num">{fmtAmount(asset.net_book_value)}</span> },
                    { label: "监测频率", value: asset.monitoring_frequency === "quarterly" ? "季度" : asset.monitoring_frequency },
                    { label: "利用率目标", value: <span className="num">{fmtPct(asset.utilization_threshold_pct)}</span>, hint: asset.threshold_nature },
                    {
                      label: "低利用率确认",
                      value: asset.low_utilization_confirmed ? `已确认（${fmtDate(asset.confirmation_date)}）` : "未确认",
                    },
                    { label: "是否正式低效闲置", value: asset.formally_idle ? "是" : "否，低利用率不自动认定闲置" },
                  ]}
                />
                <div>
                  <h4 className="text-[15px] font-semibold text-textmain mb-2">季度利用率（触发依据）</h4>
                  <DataTable
                    dense
                    rows={asset.quarterly_utilization_history}
                    rowKey={(p) => p.period}
                    columns={[
                      { key: "p", title: "监测期", render: (p) => p.period },
                      { key: "v", title: "实际利用率", align: "right", render: (p) => <span className="num">{fmtPct(p.actual_pct)}</span> },
                      { key: "t", title: "目标", align: "right", render: () => <span className="num">{fmtPct(asset.utilization_threshold_pct)}</span> },
                      {
                        key: "r",
                        title: "结论",
                        render: (p) =>
                          p.actual_pct < asset.utilization_threshold_pct ? (
                            <Tag tone="amber">低于目标</Tag>
                          ) : (
                            <Tag tone="green">达标</Tag>
                          ),
                      },
                    ]}
                  />
                  <p className="text-[12px] text-textsub mt-2">{asset.monthly_trend_note}</p>
                </div>
              </>
            )}

            {eq && (
              <DescList
                cols={4}
                items={[
                  { label: "投资类型", value: eq.investment_type },
                  { label: "被投企业", value: entityName(eq.investee_id) },
                  { label: "持股比例", value: <span className="num">{fmtPct(eq.holding_pct)}</span> },
                  { label: "核算方法", value: eq.accounting_method_demo },
                  { label: "批准投资总额", value: <span className="num">{fmtAmount(eq.approved_total_investment)}</span> },
                  { label: "年度投资计划", value: <span className="num">{fmtAmount(eq.annual_investment_plan)}</span> },
                  { label: "同期出资", value: <span className="num">{fmtAmount(eq.ytd_contribution)}</span> },
                  { label: "累计出资", value: <span className="num">{fmtAmount(eq.cumulative_contribution)}</span> },
                  { label: "已到期应出资", value: <span className="num">{fmtAmount(eq.contribution_due_to_date)}</span>, hint: `到期日 ${eq.contribution_due_date}` },
                  { label: "期初账面余额", value: <span className="num">{fmtAmount(eq.opening_book_balance)}</span> },
                  { label: "期末账面余额（减值前）", value: <span className="num">{fmtAmount(eq.closing_book_balance_before_impairment)}</span> },
                  { label: "减值准备", value: <span className="num">{fmtAmount(eq.impairment_allowance)}</span> },
                  { label: "会计口径投资收益", value: <span className="num">{fmtAmount(eq.accounting_investment_income_ytd)}</span>, hint: eq.accounting_income_includes_declared_dividends ? "含已宣告股利" : "不含已宣告股利" },
                  { label: "应收分红", value: <span className="num">{fmtAmount(eq.dividend_due)}</span>, hint: `到期日 ${eq.dividend_due_date}` },
                  { label: "实收现金分红", value: <span className="num">{fmtAmount(eq.cash_dividend_received)}</span> },
                  { label: "现金回报目标", value: <span className="num">{fmtAmount(eq.cash_return_target_ytd)}</span> },
                ]}
              />
            )}

            {eng && (
              <DescList
                cols={4}
                items={[
                  { label: "国别", value: eng.country },
                  { label: "客户", value: <span className="num">{eng.customer_id}</span> },
                  { label: "主合同", value: <span className="num">{eng.contract_id}</span> },
                  { label: "当前阶段", value: eng.phase },
                  { label: "合同收入（不含税）", value: <span className="num">{fmtAmount(eng.contract_revenue_ex_vat)}</span> },
                  { label: "预计完工成本", value: <span className="num">{fmtAmount(eng.forecast_completion_cost)}</span>, hint: eng.cost_forecast_complete ? "构成完整" : "构成不完整" },
                  { label: "目标毛利率", value: <span className="num">{fmtPct(eng.target_margin_pct)}</span> },
                  { label: "批准成本目标", value: <span className="num">{fmtAmount(eng.approved_cost_target)}</span> },
                  { label: "同期收款", value: <span className="num">{fmtAmount(eng.cash_received_ytd)}</span> },
                  { label: "同期付款", value: <span className="num">{fmtAmount(eng.cash_paid_ytd)}</span> },
                  { label: "已到期应收", value: <span className="num">{fmtAmount(eng.receivable_due)}</span> },
                  { label: "未到期应收", value: <span className="num">{fmtAmount(eng.receivable_not_yet_due)}</span> },
                  { label: "并行工作包", value: eng.parallel_work.join("、") || "—" },
                  { label: "航线", value: eng.route_ids.join("、") || "—" },
                ]}
              />
            )}

            {account && (
              <DescList
                cols={4}
                items={[
                  { label: "开户主体", value: entityName(account.legal_entity_id) },
                  { label: "币种", value: account.currency },
                  { label: "期初余额（原币）", value: <span className="num">{fmtAmount(account.opening_balance_native)}</span>, hint: `期初日 ${account.opening_balance_date}` },
                  { label: "期末余额（原币）", value: <span className="num">{fmtAmount(account.closing_balance_native)}</span>, hint: `余额日 ${account.balance_as_of}` },
                  { label: "受限余额（原币）", value: <span className="num">{fmtAmount(account.restricted_balance_native)}</span>, hint: account.restriction_basis },
                  { label: "折人民币汇率", value: <span className="num">{account.fx_to_cny}</span>, hint: account.fx_nature },
                  { label: "折人民币期末余额", value: <span className="num">{fmtAmount(account.closing_balance_native * account.fx_to_cny)}</span> },
                  { label: "可动用余额（折人民币）", value: <span className="num">{fmtAmount((account.closing_balance_native - account.restricted_balance_native) * account.fx_to_cny)}</span> },
                ]}
              />
            )}

            {matter && (
              <DescList
                cols={3}
                items={[
                  { label: "事项类型", value: matter.matter_type },
                  { label: "流程模板", value: templateById(matter.template_id)?.matter_type_name ?? matter.template_id },
                  { label: "当前环节", value: phaseName(matter.current_phase_id) },
                  { label: "投资方", value: entityName(matter.investor_id) },
                  { label: "被投企业", value: entityName(matter.investee_id) },
                  { label: "关联投资项目", value: objectTitle(matter.related_project_id) },
                  { label: "说明", value: matter.note },
                  { label: "数据性质", value: dataNatureLabel(matter.data_nature) },
                ]}
              />
            )}
            {tx && (
              <DescList
                cols={4}
                items={[
                  { label: "方向", value: tx.direction === "outflow" ? "支出" : "收入" },
                  { label: "业务日期", value: <span className="num">{tx.date}</span> },
                  { label: "本次实付/实收", value: <span className="num">{fmtAmount(tx.amount_wan_cny)}</span> },
                  { label: "该笔有效批准", value: <span className="num">{tx.approved_amount === undefined ? "—" : fmtAmount(tx.approved_amount)}</span> },
                  { label: "合同可支付上限", value: <span className="num">{tx.certified_payable_amount === undefined ? "—" : fmtAmount(tx.certified_payable_amount)}</span> },
                  { label: "付款账户", value: objectTitle(tx.account_id) },
                  { label: "合同", value: tx.contract_id ? objectTitle(tx.contract_id) : "—" },
                  { label: "义务", value: tx.obligation_id ? objectTitle(tx.obligation_id) : "—" },
                ]}
              />
            )}
            <FpObjectFacts objectId={objectId} onOpenObject={onOpenObject} />
            {seed.ownership_snapshots.some((s) => s.investee_id === objectId || s.investor_id === objectId || matter?.snapshot_ids?.includes(s.id)) && (
              <HoldingsTable
                investeeId={matter?.investee_id && matter.snapshot_ids?.length ? matter.investee_id : seed.ownership_snapshots.some((s) => s.investee_id === objectId) ? objectId : undefined}
                investorId={seed.ownership_snapshots.some((s) => s.investor_id === objectId) && !seed.ownership_snapshots.some((s) => s.investee_id === objectId) ? objectId : undefined}
              />
            )}
            <FpCrossFacts objectId={objectId} onOpenObject={onOpenObject} />
          </>
        )}

        {tab === "stages" && (
          <>
            <StageTable instances={stages} />
          </>
        )}

        {tab === "relations" && (
          <>
            <DataTable
              rows={related}
              rowKey={(l) => l.id}
              empty="该对象暂无已登记的业务关系。"
              pageSize={8}
              compactEmpty
              columns={[
                { key: "from", title: "来源对象", minWidth: "120px", nowrap: true, render: (l) => (
                  <button type="button" className="text-brand hover:underline" onClick={() => onOpenObject?.(l.from_id)}>
                    {objectTitle(l.from_id)}
                  </button>
                ) },
                { key: "rel", title: "业务关系", width: "160px", nowrap: true, render: (l) => <Tag tone="brand">{relationTypeLabel(l.relation_type)}</Tag> },
                { key: "to", title: "关联对象", minWidth: "120px", nowrap: true, render: (l) => (
                  <button type="button" className="text-brand hover:underline" onClick={() => onOpenObject?.(l.to_id)}>
                    {objectTitle(l.to_id)}
                  </button>
                ) },
                {
                  key: "domains",
                  title: "可进入的关联监管",
                  render: (l) => {
                    const domains = visibleSupervisionDomains(l.domains);
                    return domains.length ? domains.map((d) => DOMAIN_META[d].label).join("、") : "—";
                  },
                },
                { key: "asof", title: "关系有效期", width: "110px", render: (l) => <span className="num text-[12px]">{l.as_of}</span> },
                { key: "evid", title: "依据", render: (l) => <span className="text-[12px] text-textsub">{l.evidence_ids?.map((e) => evidenceTitle(e)).join("、") || "—"}</span> },
              ]}
            />
          </>
        )}

        {tab === "monitoring" && (
          <DataTable
            rows={monitoring}
            rowKey={(r) => r.id}
            empty="该对象当前没有监测实例。"
            pageSize={8}
            compactEmpty
            columns={[
              { key: "sc", title: "监管场景", minWidth: "200px", render: (r) => (
                <span>
                  {scenarioName(r.scenario_id)}
                  <span className="num text-[12px] text-textsub ml-2">场景编号 {r.scenario_id}</span>
                  {!isScenarioMonitoringActive(r.scenario_id) ? (
                    <Tag tone="neutral">已停用</Tag>
                  ) : null}
                </span>
              ) },
              { key: "phase", title: "关联环节", width: "130px", render: (r) => (r.phase_id ? phaseName(r.phase_id) : "—") },
              {
                key: "win",
                title: "归属窗口",
                width: "180px",
                render: (r) => (
                  <span className="num text-[12px]">
                    {r.window_start} ~ {r.window_end}
                  </span>
                ),
              },
              { key: "status", title: "监测状态", width: "160px", render: (r) => monitoringNoteLabel(r.note, r.status) },
              {
                key: "risk",
                title: "事项",
                width: "120px",
                render: (r) =>
                  r.risk_ids.length === 0 ? (
                    <span className="text-textsub">—</span>
                  ) : (
                    r.risk_ids.map((id) => (
                      <button key={id} className="text-brand hover:underline mr-1" onClick={() => onOpenRisk?.(id)}>
                        {riskTitleOf(id)}
                      </button>
                    ))
                  ),
              },
            ]}
          />
        )}

        {tab === "cases" && (
          <>
            {objRisks.length === 0 ? (
              <EmptyState title="该对象没有监管事项" detail="监测完整且没有命中时显示 0；尚缺资料时会显示数据缺口而不是 0。" />
            ) : (
              <DataTable
                rows={objRisks}
                rowKey={(r) => r.id}
                onRowClick={(r) => onOpenRisk?.(r.id)}
                pageSize={8}
                compactEmpty
                columns={[
                  { key: "id", title: "事项", width: "240px", nowrap: true, render: (r) => (
                    <span>
                      {r.title}
                      <span className="num text-[12px] text-textsub ml-1">事项编号 {r.id}</span>
                    </span>
                  ) },
                  { key: "sev", title: "等级", width: "88px", render: (r) => <SeverityTag severity={r.severity} /> },
                  { key: "status", title: "办理状态", width: "110px", render: (r) => statusLabel[r.status] },
                  { key: "open", title: "是否未关闭", width: "110px", render: (r) => (isOpen(r) ? "是" : "否") },
                  { key: "org", title: "责任单位", width: "140px", render: (r) => orgName(r.owner_org_id) },
                ]}
              />
            )}
          </>
        )}
      </div>
  );

  if (variant === "page") {
    return (
      <div className="space-y-4">
        <PageHeader title={obj.name}>
          <span className="flex items-center gap-2 flex-wrap">
            <span className="num text-[13px] text-textsub">对象编号 {obj.id}</span>
            <Tag tone="neutral">{obj.typeLabel}</Tag>
          </span>
        </PageHeader>
        <p className="text-[12px] text-textsub -mt-2">{subtitleNode}</p>
        {archive}
      </div>
    );
  }

  return (
    <Drawer open onClose={onClose} width="76vw" title={titleNode} subtitle={subtitleNode}>
      {archive}
    </Drawer>
  );
}

function FpObjectFacts({ objectId, onOpenObject }: { objectId: string; onOpenObject?: (id: string) => void }) {
  const loan = FP_LOANS.find((x) => x.id === objectId);
  const guar = FP_GUARANTEES.find((x) => x.id === objectId);
  const lend = FP_LENDS.find((x) => x.id === objectId);
  const spec = FP_SPECIALS.find((x) => x.id === objectId);
  const sme =
    FP_SME.find((x) => x.id === objectId) ??
    FP_SME.find((x) => x.contract_id === objectId) ??
    FP_SME.find((x) => seed.obligations.find((o) => o.id === objectId)?.contract_id === x.contract_id);
  const gov = FP_GOVERNANCE.find((x) => x.legal_entity_id === objectId || x.id === objectId);
  const ctrl = FP_CONTROLS.find((x) => x.legal_entity_id === objectId);
  const le = seed.legal_entities.find((e) => e.id === objectId);
  const opening = FP_ACCOUNT_OPENINGS.find((x) => x.account_id === objectId);
  const nameLic = FP_NAME_LICENSES.find((x) => x.matter_id === objectId);
  const idBtn = (id: string) => (
    <button type="button" className="text-brand hover:underline" onClick={() => onOpenObject?.(id)}>
      {objectTitle(id)}
    </button>
  );
  if (opening) {
    return (
      <DescList
        cols={3}
        items={[
          { label: "开户日", value: <span className="num">{opening.opened_on}</span> },
          { label: "是否需事前审批", value: opening.approval_required ? "是" : "否" },
          { label: "有效批准日", value: <span className="num">{opening.approval_on ?? "缺失"}</span> },
          { label: "检索是否完整", value: opening.evidence_complete ? "完整" : "不完整，未评估" },
          { label: "检索说明", value: opening.search_note },
        ]}
      />
    );
  }
  if (loan) {
    return (
      <DescList
        cols={3}
        items={[
          { label: "方向", value: loan.direction === "internal_borrow" ? "内部借入" : "外部融资" },
          { label: "未偿本金", value: <span className="num">{fmtAmount(loan.outstanding_wan)}</span> },
          { label: "未使用授信", value: <span className="num">{fmtAmount(loan.unused_credit_wan)}</span> },
          { label: "到期日", value: <span className="num">{loan.due_date}</span> },
          { label: "主体", value: idBtn(loan.legal_entity_id) },
        ]}
      />
    );
  }
  if (guar) {
    const occupancy = FP_GUARANTEES.filter(
      (x) => x.guarantor_id === guar.guarantor_id && x.beneficiary_id === guar.beneficiary_id && !x.released,
    ).reduce((s, x) => s + x.amount_wan, 0);
    return (
      <DescList
        cols={3}
        items={[
          { label: "类型", value: guar.kind === "performance_bond" ? "保函" : "借款担保" },
          { label: "金额", value: <span className="num">{fmtAmount(guar.amount_wan)}</span> },
          { label: "有效占用", value: <span className="num">{fmtAmount(occupancy)}</span>, hint: guar.occupancy_basis },
          { label: "批准额度", value: <span className="num">{fmtAmount(guar.approved_limit_wan)}</span> },
          { label: "有效期", value: <span className="num">{guar.start_date}～{guar.end_date}</span> },
          { label: "担保人", value: idBtn(guar.guarantor_id) },
          { label: "被担保/受益", value: idBtn(guar.beneficiary_id) },
          { label: "是否解除", value: guar.released ? "已解除" : "有效" },
        ]}
      />
    );
  }
  if (lend) {
    const unrecovered = Math.max(0, lend.outstanding_wan - lend.recovered_wan);
    return (
      <DescList
        cols={3}
        items={[
          { label: "出借人", value: idBtn(lend.lender_id) },
          { label: "借入人", value: idBtn(lend.borrower_id) },
          { label: "本金", value: <span className="num">{fmtAmount(lend.principal_wan)}</span> },
          { label: "未偿本金", value: <span className="num">{fmtAmount(lend.outstanding_wan)}</span> },
          { label: "已回收", value: <span className="num">{fmtAmount(lend.recovered_wan)}</span> },
          { label: "未收回", value: <span className="num">{fmtAmount(unrecovered)}</span> },
          { label: "到期日", value: <span className="num">{lend.due_date}</span> },
        ]}
      />
    );
  }
  if (spec) {
    return (
      <DescList
        cols={3}
        items={[
          { label: "专户", value: idBtn(spec.designated_account_id) },
          { label: "确认结余", value: <span className="num">{fmtAmount(spec.confirmed_balance_wan)}</span> },
          { label: "批准用途", value: spec.purpose_catalog.join("、") },
        ]}
      />
    );
  }
  if (sme) {
    const unpaid = Math.max(0, sme.undisputed_wan - sme.paid_wan);
    const ob = seed.obligations.find((o) => o.contract_id === sme.contract_id);
    return (
      <DescList
        cols={3}
        items={[
          { label: "订立时中小企业", value: sme.sme_at_contract == null ? "缺数，未评估" : sme.sme_at_contract ? "是" : "否" },
          { label: "付款义务", value: idBtn(ob?.id ?? sme.id) },
          { label: "合同", value: idBtn(sme.contract_id) },
          { label: "起算事件", value: `${sme.start_event} ${sme.start_date}` },
          { label: "合同约定期限", value: <span className="num">{sme.contracted_days}日</span> },
          { label: "到期日", value: <span className="num">{sme.due_date}</span> },
          { label: "无争议应付", value: <span className="num">{fmtAmount(sme.undisputed_wan)}</span> },
          { label: "已付", value: <span className="num">{fmtAmount(sme.paid_wan)}</span> },
          { label: "未付余额", value: <span className="num">{fmtAmount(unpaid)}</span> },
          { label: "到期依据", value: `按${sme.start_event}日起合同${sme.contracted_days}日，不以发票日加60日` },
        ]}
      />
    );
  }
  if (nameLic) {
    return (
      <DescList
        cols={3}
        items={[
          { label: "使用主体", value: idBtn(nameLic.entity_id) },
          { label: "登记名称", value: nameLic.registered_name },
          { label: "使用字号", value: nameLic.trade_name },
          { label: "授权文件", value: nameLic.auth_file ?? "缺文件" },
          { label: "授权截止", value: <span className="num">{nameLic.auth_until ?? "缺期限"}</span> },
          { label: "退出/解约", value: <span className="num">{nameLic.exit_event_on ?? "无"}</span> },
          { label: "说明", value: nameLic.note },
        ]}
      />
    );
  }
  if (le || gov || ctrl) {
    return (
      <DescList
        cols={3}
        items={[
          { label: "法人", value: le?.name ?? objectId },
          { label: "控制依据", value: ctrl?.control_basis || gov?.note || "—" },
          { label: "口径", value: ctrl ? { body: "海工本体", controlled: "控股及实控", participating: "参股", unverified: "控制待核实", external: "外部" }[ctrl.class] : "—" },
          { label: "全资", value: ctrl?.wholly_owned ? "是" : ctrl ? "否" : "—" },
          ...(gov
            ? [
                { label: "章程董事会席位", value: String(gov.charter_board_seats) },
                { label: "控股应派席位", value: "3" },
                { label: "实际委派到任", value: String(gov.appointed_seats) },
                { label: "表决是否受阻", value: gov.blocked ? "待专业核查" : "未见受阻记录" },
                { label: "治理依据", value: gov.evidence_ids.map((e) => evidenceTitle(e)).join("、") },
                { label: "核查要点", value: gov.note },
              ]
            : []),
        ]}
      />
    );
  }
  return null;
}

function FpCrossFacts({ objectId, onOpenObject }: { objectId: string; onOpenObject?: (id: string) => void }) {
  const links = seed.business_links.filter((l) => l.from_id === objectId || l.to_id === objectId);
  const cash = links.filter((l) => l.domains.includes("CASH"));
  const rights = links.filter((l) => l.domains.includes("RIGHTS"));
  if (cash.length + rights.length === 0) return null;
  const btn = (id: string) => (
    <button key={id} type="button" className="text-brand hover:underline mr-2" onClick={() => onOpenObject?.(id)}>
      {objectTitle(id)}
    </button>
  );
  return (
    <div className="space-y-2">
      {cash.length > 0 && (
        <Notice tone="brand" title="关联资金">
          {cash.map((l) => (
            <span key={l.id} className="mr-3">
              {relationTypeLabel(l.relation_type)} {btn(l.from_id === objectId ? l.to_id : l.from_id)}
            </span>
          ))}
        </Notice>
      )}
      {rights.length > 0 && (
        <Notice tone="brand" title="关联产权">
          {rights.map((l) => (
            <span key={l.id} className="mr-3">
              {relationTypeLabel(l.relation_type)} {btn(l.from_id === objectId ? l.to_id : l.from_id)}
            </span>
          ))}
        </Notice>
      )}
    </div>
  );
}
