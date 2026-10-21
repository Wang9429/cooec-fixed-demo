"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import {
  Button,
  DataTable,
  DescList,
  Drawer,
  Field,
  Notice,
  SeverityTag,
  SimulatedBadge,
  Tabs,
  Tag,
  inputClass,
  textareaClass,
} from "@/components/ui";
import {
  isMissingRectificationDeadline,
  isOverdueRectification,
  rectificationDueDate,
  severityLabel,
  statusLabel,
  taskTypeLabel,
} from "@/lib/risks";
import { DOMAIN_META, evidenceById, phaseName, scenarioName, seed, topicName } from "@/lib/seed";
import { isRetiredScenarioId, isRetiredSupervisionDomain, visibleSupervisionDomains } from "@/lib/supervision-scope";
import { orgPath } from "@/lib/org";
import { daysBetween, fmtDate } from "@/lib/format";
import { isIndependentReviewer, objectAllowed, riskVisible } from "@/lib/config";
import { isScenarioMonitoringActive, liveRule } from "@/lib/live-config";
import { draftsForRisk } from "@/lib/materials";
import { allRuleEvaluations } from "@/lib/evaluations";
import { useDemoStore, type ActionKind } from "@/lib/store";
import { trialRule } from "@/lib/fp-rules";
import type { CaseAction, RiskCase } from "@/lib/types";
import VerificationPanel from "@/components/fp/VerificationPanel";
import ProfessionalReviewPanel from "@/components/fp/ProfessionalReviewPanel";
import {
  dataNatureLabel,
  displayBusinessTitle,
  evidenceTitle,
  hitValidityLabel,
  inputFieldLabel,
  objectTitle,
  ruleDisplayName,
  verificationFromEval,
} from "@/lib/fp-display";

/**
 * 风险事项详情。所有领域、场景表、工作台共用本抽屉，
 * 办理写回同一份 store，因此同一 risk_id 在各页面状态一致。
 */

const ACTION_LABEL: Record<string, string> = {
  create: "监测形成",
  claim: "认领核查",
  confirm_rectification: "核查确认需整改",
  exclude: "核查排除",
  submit_rectification: "提交整改并申请复核",
  pass_verification: "复核通过",
  return_verification: "复核退回",
  reopen: "新证据重开",
  urge: "督办",
};

interface ActionOption {
  kind: ActionKind;
  label: string;
  needsMeasure?: boolean;
  primary?: boolean;
  hint: string;
}

function optionsFor(r: RiskCase): ActionOption[] {
  const professional = r.scenario_ids.includes("PTY2-S032") || r.scenario_ids.includes("PTY2-S011");
  const professionalHint = r.scenario_ids.includes("PTY2-S011")
    ? "打开资产账簿、权属及评估范围材料后认领。结论须人工记录，不能把数量差自动当成隐匿。"
    : "打开章程、任免与到任材料后认领。结论须人工记录，不能只看专业核查标签。";
  const professionalConfirm = r.scenario_ids.includes("PTY2-S011")
    ? "结论写入事项。范围疑似漏列且需整改时转入整改，填写整改措施、责任人与期限。"
    : "结论写入事项。权利行使受阻时转入整改，填写整改措施、责任人与期限。";
  const professionalExclude = r.scenario_ids.includes("PTY2-S011")
    ? "结论为范围一致、未见需整改问题，事项关闭为排除，不转入整改。"
    : "结论为未见实质阻碍，事项关闭为排除，不转入整改。";
  switch (r.status) {
    case "pending_review":
      return [
        { kind: "claim", label: professional ? "打开材料并认领专业核查" : "认领核查", primary: true, hint: professional ? professionalHint : "认领后事项进入核查中，责任人记为当前用户。" },
      ];
    case "investigating":
      return professional
        ? [
            {
              kind: "confirm_rectification",
              label: "记录专业核查结论并关联整改",
              primary: true,
              needsMeasure: true,
              hint: professionalConfirm,
            },
            { kind: "exclude", label: r.scenario_ids.includes("PTY2-S011") ? "记录专业核查结论：范围一致" : "记录专业核查结论：未见权利受阻", hint: professionalExclude },
          ]
        : [
            {
              kind: "confirm_rectification",
              label: "核查确认需整改",
              primary: true,
              needsMeasure: true,
              hint: "确认属实后进入整改中，需要填写整改措施、责任人与期限。",
            },
            { kind: "exclude", label: "核查排除", hint: "确认为误报或有有效例外，事项关闭并记录排除原因，不计入未关闭数。" },
          ];
    case "rectifying":
      return [
        {
          kind: "submit_rectification",
          label: "提交整改并申请复核",
          primary: true,
          hint: "提交后进入待复核；按本 Demo 口径，提交材料不自动停表，逾期提示保持。",
        },
      ];
    case "pending_verification":
      return [
        { kind: "pass_verification", label: "复核通过（闭环）", primary: true, hint: "复核通过后关闭，关闭原因为整改完成，计入本期已整改闭环。" },
        { kind: "return_verification", label: "复核退回", hint: "退回后回到整改中，原有效整改期限不变。" },
      ];
    case "closed":
    case "excluded":
      return [{ kind: "reopen", label: "新证据重开", hint: "重开后回到核查中，历史动作保留，并移出本期闭环数。" }];
    default:
      return [];
  }
}

function ActionTimeline({ actions }: { actions: CaseAction[] }) {
  if (actions.length === 0) {
    return <p className="text-[13px] text-textsub">暂无办理动作记录。</p>;
  }
  return (
    <ol className="relative pl-5">
      {actions.map((a) => (
        <li key={a.id} className="relative pb-4 last:pb-0">
          <span className="absolute -left-5 top-1.5 h-2 w-2 rounded-full bg-brand" />
          <span className="absolute -left-[17px] top-3.5 bottom-0 w-px bg-line last:hidden" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] text-textmain font-medium">
              {ACTION_LABEL[a.action] ?? a.action}
            </span>
            <span className="num text-[12px] text-textsub">业务生效日 {fmtDate(a.effective_date)}</span>
            {a.from_status && a.to_status && (
              <Tag tone="neutral">
                {statusLabel[a.from_status]} → {statusLabel[a.to_status]}
              </Tag>
            )}
            {a.local && <Tag tone="brand">本地办理</Tag>}
          </div>
          <p className="text-[13px] text-textsub mt-1 leading-5">{a.note}</p>
          <p className="text-[12px] text-textsub/80 mt-0.5">
            办理人：{a.actor}
            {a.recorded_at_nature ? `｜${a.recorded_at_nature}` : ""}
            {a.evidence_ids && a.evidence_ids.length > 0
              ? `｜证据：${a.evidence_ids.join("、")}`
              : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** 切换事项时以 key 重挂载本组件，办理表单与页签自然回到初始态。 */
export default function RiskCaseDrawer({
  riskId,
  onClose,
  sourceLabel,
}: {
  riskId: string | null;
  onClose: () => void;
  sourceLabel?: string;
}) {
  if (!riskId) return null;
  return <RiskCaseDrawerBody key={riskId} riskId={riskId} onClose={onClose} sourceLabel={sourceLabel} />;
}

function RiskCaseDrawerBody({
  riskId,
  onClose,
  sourceLabel,
}: {
  riskId: string;
  onClose: () => void;
  sourceLabel?: string;
}) {
  const { riskById, actionsFor, act, addUrge, urges, filters, user, canCase, materialsFor, adoptMaterial } = useDemoStore();
  const [tab, setTab] = useState("overview");
  const [pending, setPending] = useState<ActionOption | null>(null);
  const [note, setNote] = useState("");
  const [measure, setMeasure] = useState("");
  const [responsible, setResponsible] = useState("");
  const [due, setDue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [adoptedFlash, setAdoptedFlash] = useState<string | null>(null);

  const risk = riskById(riskId);
  const actions = useMemo(() => actionsFor(riskId), [riskId, actionsFor]);
  const adopted = useMemo(() => materialsFor(riskId), [riskId, materialsFor]);
  const drafts = useMemo(() => draftsForRisk(riskId), [riskId]);

  if (!risk) {
    return (
      <Drawer open onClose={onClose} title="风险事项不存在" width="60vw">
        <div className="p-6">
          <Notice tone="amber" title="未找到事项">
            事项 {riskId} 不在当前数据中，可能已被重置。请返回清单重新选择。
          </Notice>
        </div>
      </Drawer>
    );
  }

  if (!riskVisible(user, risk) || !objectAllowed(user, risk.owner_org_id, risk.primary_object_id)) {
    return (
      <Drawer open onClose={onClose} title="访问受限" width="60vw">
        <div className="p-6">
          <Notice tone="amber" title="超出当前授权范围">
            当前用户不能查看该事项的名称、金额或其他受限信息。请切换已获授权的身份。
          </Notice>
        </div>
      </Drawer>
    );
  }

  const links = seed.risk_context_links.filter(
    (l) => l.risk_id === risk.id && !isRetiredSupervisionDomain(l.domain),
  );
  const visibleDomains = visibleSupervisionDomains(risk.domains);
  const visibleScenarios = risk.scenario_ids.filter((id) => !isRetiredScenarioId(id));
  const evidences = risk.evidence_ids.map((id) => evidenceById(id)).filter(Boolean);
  const ruleEvals = allRuleEvaluations().filter(
    (e) => e.risk_ids.includes(risk.id) || (e.subject_object_id === risk.primary_object_id && e.rule_id === risk.rule_id),
  );
  const trialFallback =
    ruleEvals.length === 0
      ? trialRule(risk.scenario_ids[0] ?? risk.rule_id.replace("-R", "-S"), risk.primary_object_id)
      : null;
  const traces = seed.data_traces.filter((t) => t.risk_id === risk.id);
  const myUrges = urges.filter((u) => u.riskId === risk.id);
  const dueDate = rectificationDueDate(risk);
  const overdue = isOverdueRectification(risk, filters.asOf);
  const missingDue = isMissingRectificationDeadline(risk);
  const options = optionsFor(risk);
  const actorName = user?.name ?? "监管人员";
  const adoptedRect = adopted.some((m) => m.materialId === "MAT-R07-RECT");
  const adoptedVerify = adopted.some((m) => m.materialId === "MAT-R07-VERIFY");
  const selfReview = Boolean(risk.last_handler_user_id && user?.id && risk.last_handler_user_id === user.id);

  const submit = () => {
    if (!pending) return;
    if (note.trim().length < 4) {
      setFormError("请填写不少于 4 个字的办理说明，作为事项办理日志内容。");
      return;
    }
    if (pending.needsMeasure && measure.trim().length < 4) {
      setFormError("确认需整改必须填写整改措施。");
      return;
    }
    if (pending.kind === "submit_rectification" && risk.id === "R07" && !adoptedRect) {
      setFormError("提交整改前须先采用《付款审批控制核查及措施执行记录》，草稿不能自动当作已执行事实。");
      return;
    }
    if (pending.kind === "pass_verification" && risk.id === "R07" && !adoptedVerify) {
      setFormError("独立复核前须先采用《付款审批控制整改复核记录》。");
      return;
    }
    if ((pending.kind === "pass_verification" || pending.kind === "return_verification") && selfReview) {
      setFormError("不能由原办理人自行复核。请切换总部复核人员B后办理。");
      return;
    }
    act({
      riskId: risk.id,
      kind: pending.kind,
      actor: actorName,
      actorUserId: user?.id,
      note: note.trim(),
      measure: measure.trim() || undefined,
      responsible: responsible.trim() || undefined,
      dueDate: due || null,
      evidenceIds: risk.evidence_ids,
    });
    setFlash(
      pending.kind === "pass_verification"
        ? "复核通过，事项已闭环。相关领域首页、场景表、指标与综合总览已同步更新。"
        : `${pending.label}已完成，事项状态与各页面统计已同步。`,
    );
    setPending(null);
    setNote("");
    setMeasure("");
    setResponsible("");
    setDue("");
    setFormError(null);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="72vw"
      title={
        <span className="flex items-center gap-2 flex-wrap">
          {displayBusinessTitle(risk.title)}
          <span className="num text-textsub text-[13px]">事项编号 {risk.id}</span>
          <SeverityTag severity={risk.severity} />
          <Tag tone="neutral">{statusLabel[risk.status]}</Tag>
          {overdue && <Tag tone="red">整改逾期</Tag>}
        </span>
      }
      subtitle={
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <span>责任单位：{orgPath(risk.owner_org_id).map((o) => o.name).join(" / ")}</span>
          <span>
            涉及领域：
            {visibleDomains.map((d) => DOMAIN_META[d].label).join("、") || "—"}
          </span>
          {sourceLabel && <span>来源：{sourceLabel}</span>}
          <SimulatedBadge text={`数据性质：${dataNatureLabel(risk.data_nature)}`} />
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-textsub mr-auto">
            当前用户：{actorName}
            {isIndependentReviewer(user) ? "（独立复核，禁止自审）" : ""}
          </span>
          {options.map((o) => {
            let allowed = canCase(o.kind);
            let deny = allowed ? o.hint : `当前用户（${actorName}）不开放该办理动作`;
            if (allowed && (o.kind === "pass_verification" || o.kind === "return_verification") && selfReview) {
              allowed = false;
              deny = "不能由原办理人自行复核，请切换总部复核人员B";
            }
            if (allowed && o.kind === "pass_verification" && risk.id === "R07" && !adoptedVerify) {
              deny = "请先在材料页采用复核记录后再通过";
            }
            return (
              <Button
                key={o.kind}
                variant={o.primary ? "primary" : "secondary"}
                disabled={!allowed}
                title={deny}
                onClick={() => {
                  setPending(o);
                  setNote("");
                  setMeasure(risk.rectification_plan?.measure ?? "");
                  setResponsible(risk.rectification_plan?.responsible_display_name ?? actorName);
                  setDue(risk.rectification_plan?.due_date ?? risk.current_task_due_date ?? "");
                  setFormError(null);
                  setFlash(null);
                }}
              >
                {o.label}
              </Button>
            );
          })}
          {(risk.status === "rectifying" || risk.status === "pending_verification") && (
            <Button
              disabled={!canCase("urge")}
              title={canCase("urge") ? "写入督办记录" : `当前用户（${actorName}）不能督办`}
              onClick={() => {
                if (!canCase("urge")) return;
                addUrge(risk.id, `对 ${risk.id} 发起督办，要求说明整改进展。`);
                setFlash("督办记录已写入事项日志，并显示在整改跟踪清单。");
              }}
            >
              督办
            </Button>
          )}
        </div>
      }
    >
      <div className="h-full overflow-auto">
        <div className="px-6 pt-4">
          {flash && (
            <div className="mb-3">
              <Notice tone="green" title="办理结果">
                {flash}
              </Notice>
            </div>
          )}
          {overdue && (
            <div className="mb-3">
              <Notice tone="red" title="逾期整改">
                有效整改期限 {fmtDate(dueDate)}，截至日 {filters.asOf} 已逾期{" "}
                {dueDate ? daysBetween(dueDate, filters.asOf) : "—"} 天。按本 Demo 口径，提交复核材料不自动停表。
              </Notice>
            </div>
          )}
          {missingDue && (
            <div className="mb-3">
              <Notice tone="amber" title="缺少有效整改期限">
                该事项已进入整改责任范围但未记录有效期限，按“待人工核查/待确认期限”处理，不编造法定天数。
              </Notice>
            </div>
          )}
          <Tabs
            tabs={[
              { id: "overview", label: "事项概览" },
              { id: "evidence", label: `依据与规则（${evidences.length + ruleEvals.length}）` },
              { id: "materials", label: `整改材料（${drafts.length + adopted.length}）` },
              { id: "timeline", label: `办理日志（${actions.length + myUrges.length}）` },
              { id: "related", label: "关联与跨领域" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        <div className="px-6 py-4 space-y-5">
          {pending && (
            <div className="rounded-[8px] border border-brand bg-[#fafcff] p-4">
              <h4 className="text-[15px] font-semibold text-textmain mb-1">{pending.label}</h4>
              <p className="text-[12px] text-textsub mb-3">{pending.hint}</p>
              <Field label="办理说明" required hint="将写入事项办理日志，业务生效日期按截至日记录。">
                <textarea
                  className={textareaClass}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：已核对概算批复与成本构成，确认预计完工投资超出有效概算，需要编制调整方案。"
                />
              </Field>
              {pending.needsMeasure && (
                <div className="grid sm:grid-cols-3 gap-x-4">
                  <Field label="整改措施" required>
                    <input className={inputClass} value={measure} onChange={(e) => setMeasure(e.target.value)} />
                  </Field>
                  <Field label="责任人">
                    <input
                      className={inputClass}
                      value={responsible}
                      onChange={(e) => setResponsible(e.target.value)}
                    />
                  </Field>
                  <Field label="有效整改期限" hint="留空表示期限待确认，将标为待人工核查。">
                    <input
                      type="date"
                      className={inputClass}
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                    />
                  </Field>
                </div>
              )}
              {formError && (
                <div className="mb-3">
                  <Notice tone="red">{formError}</Notice>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="primary" onClick={submit}>
                  确认{pending.label}
                </Button>
                <Button onClick={() => setPending(null)}>取消</Button>
              </div>
            </div>
          )}

          {tab === "overview" && (
            <>
              <DescList
                cols={3}
                items={[
                  { label: "事项编号", value: <span className="num">{risk.id}</span> },
                  { label: "风险等级", value: severityLabel[risk.severity] },
                  { label: "办理状态", value: statusLabel[risk.status] },
                  { label: "当前办理节点", value: taskTypeLabel[risk.current_task_type] },
                  { label: "当前节点期限", value: <span className="num">{fmtDate(risk.current_task_due_date)}</span> },
                  { label: "责任角色", value: risk.responsible_role },
                  { label: "承办人", value: risk.assignee_display_name ?? "未认领" },
                  { label: "首次发现", value: <span className="num">{fmtDate(risk.first_seen_at)}</span> },
                  { label: "最近命中", value: <span className="num">{fmtDate(risk.last_seen_at)}</span> },
                  { label: "触发规则", value: <>{ruleDisplayName(risk.rule_id)}<span className="num text-[12px] text-textsub ml-2">规则编号 {risk.rule_id}</span></> },
                  {
                    label: "关联监管场景",
                    value: (
                      <span className="flex flex-wrap gap-1">
                        {visibleScenarios.length ? (
                          visibleScenarios.map((s) => (
                            <Tag key={s} tone={isScenarioMonitoringActive(s) ? "brand" : "neutral"}>
                              {scenarioName(s)}
                              <span className="num text-[11px] ml-1">场景编号 {s}</span>
                              {!isScenarioMonitoringActive(s) ? " · 已停用" : ""}
                            </Tag>
                          ))
                        ) : (
                          "—"
                        )}
                      </span>
                    ),
                  },
                  { label: "监测对象", value: <>{objectTitle(risk.primary_object_id)}<span className="num text-[12px] text-textsub ml-2">对象编号 {risk.primary_object_id}</span></> },
                ]}
              />
              {ruleEvals.length > 0 && (
                <div className="space-y-3">
                  {ruleEvals.map((e) => (
                    <VerificationPanel
                      key={e.id}
                      view={verificationFromEval(e, { riskStatus: risk.status, scenarioIds: risk.scenario_ids })}
                    />
                  ))}
                </div>
              )}
              {ruleEvals.length === 0 && trialFallback && trialFallback.result !== "not_applicable" && (
                <VerificationPanel
                  view={verificationFromEval(
                    {
                      rule_id: risk.rule_id,
                      subject_object_id: risk.primary_object_id,
                      inputs: trialFallback.inputs,
                      formula: trialFallback.formula,
                      effective_result:
                        trialFallback.result === "hit" ? "hit" : trialFallback.result === "clear" ? "clear" : "data_insufficient",
                      result: trialFallback.result === "hit" ? "hit" : "clear",
                      rule_version: liveRule(risk.rule_id)?.published?.version ?? liveRule(risk.rule_id)?.version_id ?? "现行",
                      window_start: risk.first_seen_at,
                      window_end: risk.last_seen_at,
                      evidence_ids: risk.evidence_ids,
                      risk_ids: [risk.id],
                      missing: trialFallback.missing,
                    },
                    { riskStatus: risk.status, scenarioIds: risk.scenario_ids },
                  )}
                />
              )}
              <ProfessionalReviewPanel risk={risk} />
              {risk.investigation_conclusion && (
                <Notice tone="brand" title="核查结论">
                  {risk.investigation_conclusion}
                </Notice>
              )}
              {risk.rectification_plan && (
                <div className="rounded-[8px] border border-line p-4">
                  <h4 className="text-[15px] font-semibold text-textmain mb-2">整改安排</h4>
                  <DescList
                    cols={2}
                    items={[
                      { label: "整改措施", value: risk.rectification_plan.measure },
                      { label: "整改责任人", value: risk.rectification_plan.responsible_display_name },
                      {
                        label: "有效整改期限",
                        value: (
                          <span className="num">
                            {risk.rectification_plan.due_date ? fmtDate(risk.rectification_plan.due_date) : "待确认"}
                          </span>
                        ),
                      },
                      { label: "进展说明", value: risk.rectification_plan.progress_note ?? "—" },
                    ]}
                  />
                </div>
              )}
              {risk.rectification_completion_note && (
                <Notice tone="brand" title="整改完成说明">
                  {risk.rectification_completion_note}
                </Notice>
              )}
              {risk.exclusion_reason && (
                <Notice tone="neutral" title="排除原因">
                  {risk.exclusion_reason}（已排除事项不计入未关闭数与当前逾期数，原记录保留）
                </Notice>
              )}
              {risk.status === "closed" && (
                <Notice tone="green" title="已关闭">
                  关闭日期 {fmtDate(risk.closed_at)}，关闭原因
                  {risk.close_reason === "rectified" ? "整改完成" : risk.close_reason ?? "—"}。
                  {risk.close_reason === "rectified" &&
                    "复核通过关闭日期落在所选期间内时计入“本期已整改闭环”。"}
                </Notice>
              )}
            </>
          )}

          {tab === "evidence" && (
            <>
              <h4 className="text-[15px] font-semibold text-textmain">规则评估记录</h4>
              {ruleEvals.length === 0 ? (
                trialFallback && trialFallback.result !== "not_applicable" ? (
                  <VerificationPanel
                    view={verificationFromEval(
                      {
                        rule_id: risk.rule_id,
                        subject_object_id: risk.primary_object_id,
                        inputs: trialFallback.inputs,
                        formula: trialFallback.formula,
                        effective_result:
                          trialFallback.result === "hit" ? "hit" : trialFallback.result === "clear" ? "clear" : "data_insufficient",
                        result: trialFallback.result === "hit" ? "hit" : "clear",
                        rule_version: liveRule(risk.rule_id)?.published?.version ?? liveRule(risk.rule_id)?.version_id ?? "现行",
                        window_start: risk.first_seen_at,
                        window_end: risk.last_seen_at,
                        evidence_ids: risk.evidence_ids,
                        risk_ids: [risk.id],
                        missing: trialFallback.missing,
                      },
                      { riskStatus: risk.status, scenarioIds: risk.scenario_ids },
                    )}
                  />
                ) : (
                  <p className="text-[13px] text-textsub">该事项没有对应的自动规则评估记录，属人工核查线索。</p>
                )
              ) : (
                <div className="space-y-3">
                  {ruleEvals.map((e) => (
                    <VerificationPanel
                      key={e.id}
                      view={verificationFromEval(e, { riskStatus: risk.status, scenarioIds: risk.scenario_ids })}
                    />
                  ))}
                </div>
              )}
              {ruleEvals.length > 0 && (
                <p className="text-[12px] text-textsub">
                  命中有效性：{ruleEvals.map((r) => hitValidityLabel(r.hit_validity)).join("；")}
                </p>
              )}

              <h4 className="text-[15px] font-semibold text-textmain">业务依据材料</h4>
              <div className="space-y-2">
                {evidences.length === 0 && (
                  <p className="text-[13px] text-textsub">尚未挂接依据材料，按“资料待补充”处理。</p>
                )}
                {evidences.map((e) => (
                  <div key={e!.id} className="rounded-[6px] border border-line p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] text-textmain">{evidenceTitle(e!.id)}</span>
                      <Tag tone="neutral">{e!.source_type}</Tag>
                      <SimulatedBadge text={dataNatureLabel(e!.data_nature)} />
                      <span className="num text-[12px] text-textsub ml-auto">记录时间 {e!.recorded_at}</span>
                    </div>
                    <p className="text-[13px] text-textsub mt-1.5 leading-5">
                      {String(e!.body ?? "")
                        .split("FA-A-1101").join("账簿在册生产设备")
                        .split("FA-A-1102").join("账簿在册配套设施")
                        .split("FA-A-EXCL").join("已合法剥离资产")
                        .split("DIR-A-03").join("已核实关联董事（受让方）")}
                    </p>
                  </div>
                ))}
              </div>

              {traces.length > 0 && (
                <>
                  <h4 className="text-[15px] font-semibold text-textmain">计算依据（四层追溯）</h4>
                  {traces.map((t) => (
                    <div key={t.id} className="rounded-[6px] border border-line p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] text-textmain">{t.name}</span>
                        <span className="num text-[12px] text-textsub">截至 {t.as_of}</span>
                        <SimulatedBadge />
                      </div>
                      <p className="text-[13px] text-textsub">{t.calculation.formula}</p>
                      <DataTable
                        dense
                        rows={t.calculation.inputs}
                        rowKey={(i) => i.field}
                        columns={[
                          { key: "f", title: "构成项", render: (i) => inputFieldLabel(i.field) },
                          { key: "v", title: "数值", align: "right", render: (i) => <span className="num">{i.value}</span> },
                          { key: "u", title: "单位", render: (i) => i.unit },
                        ]}
                      />
                      <p className="text-[12px] text-textsub">
                        来源业务记录：
                        {t.source_record_ids.length > 0 ? t.source_record_ids.join("、") : "—"}
                        ｜{t.detail_note}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {tab === "materials" && (
            <>
              <Notice tone="neutral" title="材料采用规则">
                下列文字是合成材料草稿，不是原始证据。须由办理人选择、阅读并明确采用后另建记录。未采用完整执行证明时，事项应保持待整改或待复核。独立复核材料须在单位提交后由另一位有权人员采用。
              </Notice>
              {adoptedFlash && <Notice tone="green">{adoptedFlash}</Notice>}
              {drafts.length === 0 && adopted.length === 0 && (
                <p className="text-[13px] text-textsub">该事项没有预置合成整改材料，可按现有依据办理。</p>
              )}
              {drafts.map((d) => {
                const already = adopted.some((m) => m.materialId === d.id);
                const canAdoptRect = d.kind === "rectification" && (risk.status === "rectifying" || risk.status === "investigating");
                const canAdoptVerify =
                  d.kind === "verification" &&
                  risk.status === "pending_verification" &&
                  isIndependentReviewer(user) &&
                  !selfReview;
                const canAdopt =
                  !already &&
                  (canAdoptRect || canAdoptVerify) &&
                  canCase(d.kind === "verification" ? "adopt_verification" : "adopt_rectification");
                return (
                  <div key={d.id} className="rounded-[8px] border border-line p-4 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-[15px] font-semibold">{d.title}</h4>
                      <Tag tone={d.kind === "rectification" ? "amber" : "brand"}>
                        {d.kind === "rectification" ? "整改材料草稿" : "复核材料草稿"}
                      </Tag>
                      <SimulatedBadge text={d.dataNature} />
                      {already && <Tag tone="green">已采用</Tag>}
                    </div>
                    {d.pages.map((p) => (
                      <div key={p.title}>
                        <div className="text-[13px] font-medium text-textmain">{p.title}</div>
                        <p className="text-[13px] text-textsub leading-6">{p.body}</p>
                      </div>
                    ))}
                    <Button
                      variant="primary"
                      disabled={!canAdopt}
                      title={
                        already
                          ? "已采用并保存为新记录"
                          : canAdopt
                            ? "采用后另建记录，不覆盖原始付款事实"
                            : !canCase(d.kind === "verification" ? "adopt_verification" : "adopt_rectification")
                              ? `当前用户（${actorName}）不能采用材料`
                            : d.kind === "verification"
                              ? "须由总部复核人员B在单位提交后独立采用"
                              : "须由单位办理人员在整改阶段采用"
                      }
                      onClick={() => {
                        adoptMaterial({
                          riskId: risk.id,
                          materialId: d.id,
                          title: d.title,
                          actorUserId: user?.id ?? "",
                          actorName,
                          note: `采用合成材料《${d.title}》，不改变原始付款、批准与可支付上限事实。`,
                        });
                        setAdoptedFlash(`已采用《${d.title}》。办理生效日期 ${filters.asOf}。`);
                      }}
                    >
                      采用并保存为新记录
                    </Button>
                  </div>
                );
              })}
              {adopted.length > 0 && (
                <div>
                  <h4 className="text-[15px] font-semibold text-textmain mb-2">已采用记录</h4>
                  <DataTable
                    dense
                    rows={adopted}
                    rowKey={(m) => m.id}
                    columns={[
                      { key: "title", title: "材料", render: (m) => m.title },
                      { key: "actor", title: "采用人", width: "140px", render: (m) => m.actorName },
                      { key: "date", title: "办理生效日", width: "120px", render: (m) => <span className="num">{m.effective_date}</span> },
                      { key: "note", title: "说明", render: (m) => m.note },
                    ]}
                  />
                </div>
              )}
            </>
          )}

          {tab === "timeline" && (
            <>
              <ActionTimeline actions={actions} />
              {myUrges.length > 0 && (
                <>
                  <h4 className="text-[15px] font-semibold text-textmain">督办记录</h4>
                  <ul className="space-y-1.5">
                    {myUrges.map((u) => (
                      <li key={u.id} className="text-[13px] text-textsub">
                        <span className="num">{u.effective_date}</span>｜{u.actor}｜{u.note}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {tab === "related" && (
            <>
              <h4 className="text-[15px] font-semibold text-textmain">领域与环节归属</h4>
              <DataTable
                rows={links}
                rowKey={(l) => `${l.risk_id}-${l.domain}`}
                empty="该事项没有配置领域环节关联。"
                columns={[
                  { key: "domain", title: "领域", render: (l) => DOMAIN_META[l.domain].label },
                  {
                    key: "phase",
                    title: "主归属环节",
                    render: (l) => (l.primary_phase_id ? phaseName(l.primary_phase_id) : "—"),
                  },
                  {
                    key: "assoc",
                    title: "实际关联环节",
                    render: (l) => l.phase_ids.map((p) => phaseName(p)).join("、") || "—",
                  },
                  { key: "topic", title: "专题", render: (l) => (l.topic_id ? topicName(l.topic_id) : "—") },
                  { key: "sub", title: "子主题", render: (l) => (l.subtopic_id ? topicName(l.subtopic_id) : "—") },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                {visibleDomains.map((d) => (
                  <Link
                    key={d}
                    href={DOMAIN_META[d].route}
                    className="h-8 px-3 inline-flex items-center rounded-[6px] border border-line text-[13px] text-brand hover:bg-tint transition-colors duration-150"
                  >
                    在{DOMAIN_META[d].label}中查看 ›
                  </Link>
                ))}
                <Link
                  href={`/object/${risk.primary_object_id}`}
                  className="h-8 px-3 inline-flex items-center rounded-[6px] border border-line text-[13px] text-brand hover:bg-tint transition-colors duration-150"
                >
                  打开监测对象档案 {objectTitle(risk.primary_object_id)} ›
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
