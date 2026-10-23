"use client";

import React from "react";
import { Drawer, LinkButton, Tag } from "@/components/ui";
import type { FaScenarioMonitor, MonitorRule } from "@/lib/investment-focus";
import { monitorSummaryText } from "@/lib/investment-focus";

function statusTone(label: string): "red" | "amber" | "green" | "neutral" {
  if (label.includes("命中") && !label.includes("未命中") && !label.includes("未形成")) return "red";
  if (label.includes("未命中")) return "green";
  if (label.includes("未形成") || label.includes("未执行") || label.includes("草稿") || label.includes("未启用")) return "amber";
  return "neutral";
}

function RuleBlock({
  rule,
  onOpenObject,
  onOpenRisk,
}: {
  rule: MonitorRule;
  onOpenObject?: (id: string) => void;
  onOpenRisk?: (id: string) => void;
}) {
  return (
    <article className="rounded-[8px] border border-line bg-white px-3 py-3" data-testid={`fa-rule-${rule.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-[13px] text-textmain">{rule.id}</span>
        <span className="text-[14px] font-medium text-textmain">{rule.name}</span>
        <Tag tone={statusTone(rule.statusLabel)}>{rule.statusLabel}</Tag>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] leading-5 sm:grid-cols-2">
        <div>
          <dt className="text-textsub">执行时间</dt>
          <dd className="num text-textmain">{rule.evaluatedAt ?? "未执行"}</dd>
        </div>
        <div>
          <dt className="text-textsub">应评估 / 已评估</dt>
          <dd className="num text-textmain">
            {rule.requiredCount === null ? "—" : rule.requiredCount} / {rule.evaluatedCount === null ? "—" : rule.evaluatedCount}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[13px] leading-5 text-textmain">
        <span className="text-textsub">监控口径 </span>
        {rule.condition}
      </p>
      <p className="mt-1 text-[13px] leading-5 text-textmain">
        <span className="text-textsub">生效参数 </span>
        {rule.parameters.length === 0 ? "无已发布参数" : rule.parameters.map((item) => `${item.label} ${item.value}`).join("；")}
      </p>
      {rule.parameterNote ? <p className="mt-1 text-[12px] leading-5 text-textsub">{rule.parameterNote}</p> : null}
      {rule.executions.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-left text-textsub">
                <th className="px-2 py-1.5 font-medium">对象</th>
                <th className="px-2 py-1.5 font-medium">执行时间</th>
                <th className="px-2 py-1.5 font-medium">结果</th>
                <th className="px-2 py-1.5 font-medium">触发数据</th>
                <th className="px-2 py-1.5 font-medium">计算过程</th>
                <th className="px-2 py-1.5 font-medium">事项</th>
              </tr>
            </thead>
            <tbody>
              {rule.executions.map((item) => (
                <tr key={`${rule.id}-${item.objectId}`} className="border-t border-line align-top" data-testid={`fa-exec-${rule.id}-${item.objectId}`}>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <button type="button" className="text-left text-brand hover:underline whitespace-nowrap" onClick={() => onOpenObject?.(item.objectId)}>
                      {item.objectName}
                    </button>
                  </td>
                  <td className="px-2 py-2 num whitespace-nowrap">{item.evaluatedAt}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <Tag tone={statusTone(item.resultLabel)}>{item.resultLabel}</Tag>
                  </td>
                  <td className="px-2 py-2 leading-5">{item.inputs.length ? item.inputs.map((input) => `${input.label} ${input.value}`).join("；") : "—"}</td>
                  <td className="px-2 py-2 leading-5">{item.formula}</td>
                  <td className="px-2 py-2">
                    {item.riskIds.length === 0 ? (
                      <span className="text-textsub">—</span>
                    ) : (
                      item.riskIds.map((id) => (
                        <button key={id} type="button" className="block text-left text-brand hover:underline" onClick={() => onOpenRisk?.(id)}>
                          {id}
                        </button>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-textsub">本期没有执行记录。</p>
      )}
    </article>
  );
}

export default function FaScenarioDetail({
  open,
  title,
  monitor,
  focus,
  onClose,
  onOpenObject,
  onOpenRisk,
}: {
  open: boolean;
  title: string;
  monitor: FaScenarioMonitor | null;
  focus: "overview" | "rules";
  onClose: () => void;
  onOpenObject?: (id: string) => void;
  onOpenRisk?: (id: string) => void;
}) {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const root = bodyRef.current;
    const target = root?.querySelector(focus === "rules" ? "#fa-detail-rules" : "#fa-detail-overview");
    target?.scrollIntoView({ block: "start" });
  }, [open, focus, monitor?.scenarioId]);

  const labels = monitor?.objects[0]?.cells.map((cell) => cell.label) ?? [];
  const aligned = Boolean(
    monitor &&
      monitor.objects.length > 0 &&
      monitor.objects.every((object) => object.cells.length === labels.length && object.cells.every((cell, index) => cell.label === labels[index])),
  );

  return (
    <Drawer
      open={open && Boolean(monitor)}
      onClose={onClose}
      width="min(1120px, 94vw)"
      title={title}
      subtitle={monitor ? `${monitor.phaseLabel} · ${monitorSummaryText(monitor)}` : undefined}
    >
      {monitor ? (
        <div ref={bodyRef} className="h-full overflow-y-auto px-6 py-4 space-y-5" data-testid="fa-scenario-detail">
          <section id="fa-detail-overview" data-testid="fa-detail-overview">
            <h3 className="text-[15px] font-semibold text-textmain">场景监控概览</h3>
            <dl className="mt-2 grid gap-x-6 gap-y-2 text-[13px] leading-5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-textsub">业务环节</dt>
                <dd>{monitor.phaseLabel}</dd>
              </div>
              <div>
                <dt className="text-textsub">监管对象类型</dt>
                <dd>{monitor.objectTypeLabel}</dd>
              </div>
              <div>
                <dt className="text-textsub">适用对象</dt>
                <dd className="num">{monitor.applicableCount}</dd>
              </div>
              <div>
                <dt className="text-textsub">数据覆盖</dt>
                <dd>{monitor.coverageLabel}</dd>
              </div>
              <div>
                <dt className="text-textsub">规则执行</dt>
                <dd>
                  <Tag tone={statusTone(monitor.ruleStatusLabel)}>{monitor.ruleStatusLabel}</Tag>
                </dd>
              </div>
              <div>
                <dt className="text-textsub">最近数据日期</dt>
                <dd className="num">{monitor.latestDataDate ?? "未记录"}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] leading-5 text-textsub">
              目录能力：{monitor.capabilityLabel}。{monitor.capabilityNote}
            </p>
          </section>

          <section id="fa-detail-objects" data-testid="fa-detail-objects">
            <h3 className="text-[15px] font-semibold text-textmain">业务对象监控明细</h3>
            {monitor.objects.length === 0 ? (
              <p className="mt-2 text-[13px] leading-5 text-textsub">当前筛选范围内没有关联的项目或资产。下面仍保留规则状态和数据缺口。</p>
            ) : aligned ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[1080px] text-[13px]">
                  <thead>
                    <tr className="text-left text-textsub">
                      <th className="px-2 py-1.5 font-medium">对象</th>
                      <th className="px-2 py-1.5 font-medium">所属单位</th>
                      {labels.map((label) => (
                        <th key={label} className="px-2 py-1.5 font-medium whitespace-nowrap">
                          {label}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 font-medium">说明</th>
                      <th className="px-2 py-1.5 font-medium">事项</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monitor.objects.map((object) => (
                      <tr key={object.id} className={`border-t border-line align-top ${object.hit ? "bg-[#f7f9fd]" : ""}`} data-testid={`fa-object-${object.id}`}>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <button type="button" className="text-left text-brand hover:underline whitespace-nowrap" onClick={() => onOpenObject?.(object.id)}>
                            {object.name}
                          </button>
                          {object.excluded ? <span className="mt-1 block text-[12px] text-textsub">不适用</span> : null}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{object.orgName}</td>
                        {object.cells.map((item) => (
                          <td key={item.label} className={`px-2 py-2 whitespace-nowrap ${item.missing ? "text-textsub" : "num"}`}>
                            {item.value}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-[12px] leading-5 text-textsub min-w-[180px]">{object.note ?? "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {object.riskIds.length === 0 ? (
                            <span className="text-textsub">—</span>
                          ) : (
                            object.riskIds.map((id) => (
                              <button key={id} type="button" className="block text-left text-brand hover:underline" onClick={() => onOpenRisk?.(id)}>
                                {id}
                              </button>
                            ))
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {monitor.objects.map((object) => (
                  <li key={object.id} className="rounded-[8px] border border-line px-3 py-2" data-testid={`fa-object-${object.id}`}>
                    <button type="button" className="text-[14px] text-brand hover:underline" onClick={() => onOpenObject?.(object.id)}>
                      {object.name}
                    </button>
                    <span className="ml-2 text-[12px] text-textsub">{object.orgName}</span>
                    <p className="mt-1 text-[13px] leading-5">{object.cells.map((item) => `${item.label} ${item.value}`).join(" · ")}</p>
                    {object.note ? <p className="text-[12px] leading-5 text-textsub">{object.note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section id="fa-detail-rules" data-testid="fa-detail-rules">
            <h3 className="text-[15px] font-semibold text-textmain">监管规则及执行情况</h3>
            {monitor.rules.length === 0 ? (
              <p className="mt-2 text-[13px] leading-5 text-textmain">{monitor.emptyRuleNote}</p>
            ) : (
              <div className="mt-2 space-y-3">
                {monitor.rules.map((rule) => (
                  <RuleBlock key={rule.id} rule={rule} onOpenObject={onOpenObject} onOpenRisk={onOpenRisk} />
                ))}
              </div>
            )}
            <CaseList title="规则直接关联事项" ids={monitor.directCaseIds} cases={monitor.cases} onOpenRisk={onOpenRisk} testId="fa-direct-cases" />
            <CaseList title="同场景其他事项" ids={monitor.otherCaseIds} cases={monitor.cases} onOpenRisk={onOpenRisk} testId="fa-other-cases" />
          </section>

          <section id="fa-detail-sources" data-testid="fa-detail-sources">
            <h3 className="text-[15px] font-semibold text-textmain">数据依据及业务穿透</h3>
            <dl className="mt-2 space-y-1.5 text-[13px] leading-5">
              {monitor.sources.map((item) => (
                <div key={item.label}>
                  <dt className="text-textsub">{item.label}</dt>
                  <dd className="text-textmain">{item.value}</dd>
                </div>
              ))}
            </dl>
            {monitor.objects.length > 0 ? (
              <p className="mt-2 text-[13px] leading-5">
                <span className="text-textsub">项目或资产档案 </span>
                {monitor.objects.map((object, index) => (
                  <React.Fragment key={object.id}>
                    {index > 0 ? "、" : null}
                    <LinkButton onClick={() => onOpenObject?.(object.id)}>{object.name}</LinkButton>
                  </React.Fragment>
                ))}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function CaseList({
  title,
  ids,
  cases,
  onOpenRisk,
  testId,
}: {
  title: string;
  ids: string[];
  cases: FaScenarioMonitor["cases"];
  onOpenRisk?: (id: string) => void;
  testId: string;
}) {
  return (
    <div className="mt-3" data-testid={testId}>
      <h4 className="text-[13px] font-medium text-textmain">{title}</h4>
      {ids.length === 0 ? (
        <p className="mt-1 text-[13px] text-textsub">无</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {ids.map((id) => {
            const item = cases.find((row) => row.id === id);
            return (
              <li key={id}>
                <button type="button" className="text-left text-[13px] text-brand hover:underline" onClick={() => onOpenRisk?.(id)}>
                  {id} {item?.title ?? ""}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
