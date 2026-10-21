"use client";

import React, { useMemo, useState, useCallback, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Button, Tag, useOverlay, useOverlayCount } from "@/components/ui";
import { config, intersectOrgScope, objectAllowed, riskVisible } from "@/lib/config";
import { liveAi } from "@/lib/live-config";
import { findObject } from "@/lib/objects";
import { useDemoStore } from "@/lib/store";
import { INDICATORS, computeIndicator } from "@/lib/metrics";
import { seed } from "@/lib/seed";
import { fmtAmount } from "@/lib/format";
import { orgName } from "@/lib/org";
import type { DomainId } from "@/lib/types";

function domainFromPath(pathname: string): DomainId | "OVERVIEW" | null {
  if (pathname.startsWith("/funds")) return "CASH";
  if (pathname.startsWith("/property-rights")) return "RIGHTS";
  if (pathname.startsWith("/fixed-asset-investment") || pathname.startsWith("/equity-investment")) return "FA";
  if (pathname.startsWith("/international-business")) return "INTL";
  if (pathname.startsWith("/engineering-projects")) return "ENG";
  if (pathname.startsWith("/overview")) return "OVERVIEW";
  return null;
}

const DOMAIN_TASKS: Record<string, string[]> = {
  CASH: ["CASH-EXPLAIN-PL", "CASH-PAY-EVIDENCE", "CASH-DEBT-LIQ", "CASH-SME-CLUE", "explain_hit"],
  RIGHTS: ["PTY-EQUITY-CHANGE", "PTY-SOURCE-DIFF", "PTY-TRADE-DOCS", "PTY-GOVERNANCE"],
  FA: ["explain_metric", "compare_materials"],
  INTL: ["suggest_check"],
  ENG: ["suggest_check"],
  OVERVIEW: ["explain_metric", "explain_hit", "compare_materials", "suggest_check"],
};

const AiUiContext = React.createContext<{
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
} | null>(null);

export function AiUiProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <AiUiContext.Provider value={value}>{children}</AiUiContext.Provider>;
}

function useAiUi() {
  const ctx = React.useContext(AiUiContext);
  if (!ctx) throw new Error("AiUiProvider missing");
  return ctx;
}

/** 顶栏入口：页面内容不再被右下角悬浮按钮挡住。 */
export function AiToolbarButton() {
  const { open, setOpen } = useAiUi();
  const { catalog } = useDemoStore();
  const ai = liveAi();
  void catalog;
  if (open) return null;
  return (
    <button
      type="button"
      disabled={!ai.enabled}
      onClick={() => ai.enabled && setOpen(true)}
      className="h-9 px-3 rounded-[8px] border border-brand bg-brand text-white text-[13px] font-medium hover:bg-brandstrong disabled:opacity-45 disabled:cursor-not-allowed"
      title={ai.enabled ? "AI分析" : "AI分析已关闭"}
    >
      AI分析
    </button>
  );
}

/**
 * 右下 AI 分析入口。未连接真实模型时标注预置分析，
 * 只对已有样例事实的任务给出可点击依据。
 */
export default function AiPanel() {
  const { filters, risks, user, canAct, catalog } = useDemoStore();
  const { open, setOpen } = useAiUi();
  const pathname = usePathname();
  const pageDomain = domainFromPath(pathname ?? "");
  const [task, setTask] = useState<string>("explain_metric");
  const [scopeNote, setScopeNote] = useState(false);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const overlayCount = useOverlayCount();
  const { zIndex, containerRef } = useOverlay(open, close, { isolateFocus: true });
  const fabZ = 40 + (overlayCount + 1) * 10;
  const showFab = !open && overlayCount > 0;
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!showFab) {
      setHeaderHost(null);
      return;
    }
    const nodes = [...document.querySelectorAll<HTMLElement>("[data-overlay-header-actions]")];
    setHeaderHost(nodes.at(-1) ?? null);
  }, [showFab, overlayCount]);

  const orgIds = useMemo(
    () => intersectOrgScope(filters.orgId, filters.includeChildren, user),
    [filters.orgId, filters.includeChildren, user],
  );

  const ai = liveAi();
  const enabledTasks = useMemo(
    () =>
      (catalog.ai.tasks.length ? catalog.ai.tasks : config.ai.tasks.map((t) => ({ ...t, enabled: true }))).filter(
        (t) => t.enabled !== false && ai.tasks.has(t.id),
      ),
    [catalog.ai.tasks, ai.tasks],
  );
  const visibleTasks = useMemo(() => {
    const allow = pageDomain ? DOMAIN_TASKS[pageDomain] : null;
    const scoped = allow ? enabledTasks.filter((t) => allow.includes(t.id)) : enabledTasks;
    return scoped.length ? scoped : enabledTasks;
  }, [enabledTasks, pageDomain]);

  useEffect(() => {
    if (!visibleTasks.some((t) => t.id === task) && visibleTasks[0]) setTask(visibleTasks[0].id);
  }, [pageDomain]); // eslint-disable-line react-hooks/exhaustive-deps

  const content = useMemo(() => {
    if (!ai.enabled) {
      return {
        title: "AI分析已关闭",
        sections: [{ h: "说明", p: "请在系统配置 · AI分析设置中开启后再使用。" }],
      };
    }
    if (!visibleTasks.some((t) => t.id === task)) {
      return {
        title: "当前任务未纳入可用范围",
        sections: [{ h: "说明", p: "请在系统配置 · AI分析设置中启用对应任务，或选择其他已开放任务。" }],
      };
    }
    if (user && !user.domain_ids.some((d) => ai.domains.has(d))) {
      return {
        title: "当前使用范围未覆盖",
        sections: [{ h: "说明", p: "AI 使用范围未包含当前用户业务领域。请在系统配置中调整使用范围。" }],
      };
    }
    if (!canAct("ai.use")) {
      return {
        title: "当前身份不能使用 AI 分析",
        sections: [{ h: "说明", p: "只读或配置维护身份不能读取业务分析。请切换已获授权的监管身份后再分析。" }],
      };
    }
    if (user && user.data_scope.mode === "none") {
      return {
        title: "当前身份不能读取业务分析",
        sections: [{ h: "说明", p: "系统配置管理员不自动获得业务数据。请切换总部或单位监管身份后再分析。" }],
      };
    }

    const objectInScope = (objectId: string) => {
      const obj = findObject(objectId);
      if (!obj) return false;
      return orgIds.has(obj.orgId) && objectAllowed(user, obj.orgId, objectId);
    };
    const riskInScope = (id: string) => {
      const r = risks.find((x) => x.id === id);
      return Boolean(r && orgIds.has(r.owner_org_id) && riskVisible(user, r));
    };

    if (task === "CASH-EXPLAIN-PL") {
      const def = INDICATORS.find((i) => i.id === "CASH2-I02");
      const m = def ? computeIndicator(def, orgIds, { ...filters, risks }) : null;
      return {
        title: "资金经营变化解释",
        sections: [
          {
            h: "分析结论摘要",
            p: `当前主体 ${orgName(filters.orgId)}${filters.includeChildren ? "（含下级）" : "（仅本级）"}，期间 ${filters.periodStart}～${filters.periodEnd}。营业利润 ${m?.value == null ? "—" : fmtAmount(m.value)} 万元。总部仅本级不等于总部整体。`,
          },
          { h: "关键事实与依据", p: "取合成财务报表；上级有合并报表时用合并口径，不把下级金额直接加总冒称合并。" },
          { h: "待核查问题", p: "利润变化不能直接等同现金缺口或资金违规。" },
          { h: "建议采取的动作", p: "在资金管理打开主体经营指标抽屉，再进入对应专题核对账户与收付。" },
        ],
      };
    }
    if (task === "CASH-PAY-EVIDENCE") {
      if (!objectInScope("P-PAY001") && !objectInScope("P-FA001")) {
        return { title: "超出当前授权范围", sections: [{ h: "说明", p: "当前范围没有可核对的付款对象。" }] };
      }
      const hit = objectInScope("P-PAY001");
      return {
        title: "付款依据核对",
        sections: [
          {
            h: "分析结论摘要",
            p: hit
              ? "P-PAY001 实付 1200 万元，该笔有效批准 800 万元，业务可支付上限 2000 万元。差额 400 万元形成核查线索，未超过业务上限。"
              : "当前可见付款未超过该笔有效批准。",
          },
          { h: "关键事实与依据", p: "规则比较实付与该笔有效批准，不以合同总额或授信占用替代。正常付款同样可打开明细。" },
          { h: "待核查问题", p: "是否存在可覆盖差额的当时有效批准版本？" },
          { h: "建议采取的动作", p: hit ? "打开 P-PAY001 与 R07，按核查→整改→独立复核办理。" : "打开付款对象核对批准版本。" },
        ],
      };
    }
    if (task === "CASH-DEBT-LIQ") {
      return {
        title: "债务期限与流动性分析",
        sections: [
          { h: "分析结论摘要", p: `范围 ${orgName(filters.orgId)}。未使用授信不计入借款本金；内部借入与外部融资分列。` },
          { h: "关键事实与依据", p: "融资与担保专题列示未偿本金、担保和保函责任。可用资金来自账户余额扣受限。" },
          { h: "待核查问题", p: "未来30日现金缺口本轮未启用，不显示空卡。" },
          { h: "建议采取的动作", p: "打开融资对象与账户档案核到期安排，不在本平台发起融资审批。" },
        ],
      };
    }
    if (task === "CASH-SME-CLUE") {
      return {
        title: "账款拖欠线索梳理",
        sections: [
          { h: "分析结论摘要", p: "中小企业账款按合同订立时规模及约定起算，不按发票日统一加 60 日。" },
          { h: "关键事实与依据", p: "SME-01 订立时为中小企业且到期未清偿；SME-02 缺订立时规模，显示未评估。" },
          { h: "待核查问题", p: "无争议金额、起算事件与合同期限是否完整。" },
          { h: "建议采取的动作", p: "打开资金收付专题中的账款义务，核对合同与支付。" },
        ],
      };
    }
    if (task === "PTY-EQUITY-CHANGE") {
      return {
        title: "股权变动梳理",
        sections: [
          { h: "分析结论摘要", p: `当前组织 ${orgName(filters.orgId)}。同一法人多父持股只计一户；直接股比、穿透权益与控制依据分列。` },
          { h: "关键事实与依据", p: "PTY-M007 拟转让 15 个百分点超过授权 10 个百分点。无偿划转无价款，不生成价款逾期。" },
          { h: "待核查问题", p: "变动是否完成登记、评估报告是否仍在有效使用期限。" },
          { h: "建议采取的动作", p: "打开法人档案与产权事项，按经济行为切换流程节点。" },
        ],
      };
    }
    if (task === "PTY-SOURCE-DIFF") {
      if (!objectInScope("JV001") && !riskInScope("R08")) {
        return { title: "超出当前授权范围", sections: [{ h: "说明", p: "产权来源差异样例不在当前授权范围。" }] };
      }
      return {
        title: "产权来源差异核查",
        sections: [
          { h: "分析结论摘要", p: "批准 60% / 登记 60% / 台账 55% 为来源差异，不直接计登记违规。" },
          { h: "关键事实与依据", p: "PTY-M001 对 PTY2-S028 为不适用（有依据）。应登记未办另有 PTY-M009 命中。" },
          { h: "待核查问题", p: "差异是否已由权属文件解释，还是构成应办未办。" },
          { h: "建议采取的动作", p: "打开 JV001 与 PTY-M001，对照登记专题状态。" },
        ],
      };
    }
    if (task === "PTY-TRADE-DOCS") {
      return {
        title: "交易过程材料比对",
        sections: [
          { h: "分析结论摘要", p: "PTY-M008 评估报告使用日晚于有效期；PTY-M002 转让价款收款 R-PTY-XFER 可回查资金。" },
          { h: "关键事实与依据", p: "上市股份使用独立模板，不套非上市挂牌。无偿划转节点不适用公开竞价。" },
          { h: "待核查问题", p: "报告版本、挂牌公告与签约文本是否同一标的。" },
          { h: "建议采取的动作", p: "从产权事项打开关系页进入资金收款，关闭浮层后回到原节点。" },
        ],
      };
    }
    if (task === "PTY-GOVERNANCE") {
      if (!objectInScope("LE-CTRL") && !riskInScope("R-FP-032")) {
        return { title: "超出当前授权范围", sections: [{ h: "说明", p: "治理权利样例不在当前授权范围。" }] };
      }
      return {
        title: "治理权利履职辅助核查",
        sections: [
          { h: "分析结论摘要", p: "不能仅凭股比认定已控权。LE-CTRL 章程约定委派 3 名董事，实际到任 2 名。" },
          { h: "关键事实与依据", p: "PTY2-S032 为专业核查：已有材料，结论需人工记录，不自动刷成命中或正常。" },
          { h: "待核查问题", p: "缺席董事是否已改派、表决是否达到章程多数。" },
          { h: "建议采取的动作", p: "打开 R-FP-032 记录专业核查结论，需要时关联整改。" },
        ],
      };
    }
    if (task === "explain_metric") {
      if (pageDomain === "CASH" || pageDomain === "RIGHTS") {
        return {
          title: "请选择当前领域任务",
          sections: [{ h: "说明", p: "资金与产权分析绑定当前主体和业务对象，不使用固定资产投资项目预置。" }],
        };
      }
      if (!objectInScope("FA-P001")) {
        return {
          title: "超出当前授权范围",
          sections: [{ h: "说明", p: "投资成本偏差分析绑定基地能力提升项目，当前用户授权范围或筛选范围内不可见该对象。" }],
        };
      }
      const def = INDICATORS.find((i) => i.id === "FA-I07")!;
      const leaf = def.leaves({ ...filters, risks }).find((l) => l.objectId === "FA-P001");
      const m = computeIndicator(def, new Set(["ORG-A1"]), { ...filters, risks });
      return {
        title: "投资成本偏差解释",
        sections: [
          {
            h: "分析结论摘要",
            p: `基地能力提升项目预计完工投资 ${fmtAmount(11800)} 万元，有效批准概算 ${fmtAmount(10000)} 万元，差额 ${fmtAmount(1800)} 万元，偏差率 18%。这是预测偏差，不能直接解释为已经超支。`,
          },
          {
            h: "关键事实与依据",
            p: leaf
              ? leaf.extras.map((x) => `${x.label}：${x.value}`).join("；")
              : `当前范围 ${filters.orgId}，期间 ${filters.periodStart}~${filters.periodEnd}。`,
          },
          {
            h: "待核查问题",
            p: "没有原批准成本分项和变化记录时，只能解释当前五项构成，不能认定某一成本包造成全部超概。",
          },
          {
            h: "建议采取的动作",
            p: "打开该项目计算依据核对五项构成来源，并在事项中记录核查说明。当前节点指标值 " + (m.value ?? "—") + "%。",
          },
        ],
      };
    }
    if (task === "explain_hit") {
      if (!riskInScope("R07") || !objectInScope("P-PAY001")) {
        return {
          title: "超出当前授权范围",
          sections: [{ h: "说明", p: "付款事项不在当前用户授权范围或筛选范围内。" }],
        };
      }
      const r = risks.find((x) => x.id === "R07");
      return {
        title: "付款事项命中依据",
        sections: [
          { h: "分析结论摘要", p: "付款超有效批准 400 万元，形成核查线索；未超过业务可支付上限 2000 万元。" },
          { h: "关键事实与依据", p: "实付 1200 万元，有效批准 800 万元，业务可支付上限 2000 万元。资金、工程、国际化打开同一事项。" },
          { h: "待核查问题", p: "是否存在可覆盖差额的当时有效批准？是否属于控制缺陷而非已确认损失？" },
          { h: "建议采取的动作", p: r ? `打开 ${r.title}，由单位办理人员提交整改材料，总部复核人员独立复核。` : "打开付款事项办理。" },
        ],
      };
    }
    if (task === "compare_materials") {
      if (!objectInScope("AS001")) {
        return {
          title: "超出当前授权范围",
          sections: [{ h: "说明", p: "专用装备A 不在当前用户授权范围或筛选范围内。" }],
        };
      }
      const as001 = seed.assets.find((a) => a.id === "AS001");
      return {
        title: "资产利用核查建议",
        sections: [
          { h: "分析结论摘要", p: "专用装备A 连续两个完整季度利用率低于阈值，已形成整改逾期事项。" },
          { h: "关键事实与依据", p: "2025 年四季度 48%、2026 年一季度 46%；4–6 月 47%、45%、40% 为月度走势。同类资产总体利用率仍可为 60%。" },
          { h: "待核查问题", p: "数据本身不能证明投资决策失误或资产已经闲置。需核任务需求、可用工时、检维修和调配。" },
          { h: "建议采取的动作", p: as001 ? `打开 ${as001.name} 档案，对照专用装备B 本期利用率。` : "打开资产档案。" },
        ],
      };
    }
    if (!objectInScope("ENG-P001")) {
      return {
        title: "超出当前授权范围",
        sections: [{ h: "说明", p: "境外工程项目不在当前用户授权范围或筛选范围内。" }],
      };
    }
    const eng = seed.engineering_projects.find((p) => p.id === "ENG-P001");
    return {
      title: "境外项目情景说明",
      sections: [
        { h: "分析结论摘要", p: "基础预计完工毛利率 12%。在钢材 +10%、运费 +25% 假设下，增量成本 148 万元，情景毛利率 11.26%。" },
        { h: "关键事实与依据", p: `合同收入 20000 万元，基准成本 17600 万元。${eng ? eng.name : "境外海洋工程项目"} 关联航线事件。` },
        { h: "待核查问题", p: "此结果是条件测算，不是价格预测，也不是已发生损失 148 万元。" },
        { h: "建议采取的动作", p: "在国际化业务中调整冲击假设，并回到工程领域核对基础预测未被覆盖。" },
      ],
    };
  }, [task, filters, risks, canAct, user, orgIds, ai.enabled, catalog, pageDomain, visibleTasks]);

  const fabButton = (
    <button
      type="button"
      data-ai-fab=""
      onClick={() => ai.enabled && setOpen(true)}
      className={
        headerHost
          ? "h-8 px-2.5 rounded-[6px] border border-brand bg-brand text-white text-[12px] font-medium hover:bg-brandstrong"
          : "fixed h-11 px-3 rounded-full text-white text-[13px] font-medium shadow-[0_8px_20px_rgba(11,31,58,0.25)] hover:bg-brandstrong"
      }
      style={
        headerHost
          ? undefined
          : {
              left: 16,
              bottom: 24,
              background: "var(--brand)",
              zIndex: fabZ,
            }
      }
      title={ai.enabled ? "AI分析（抽屉打开时仍可使用）" : "AI分析已关闭"}
    >
      AI分析
    </button>
  );

  return (
    <>
      {showFab && (headerHost ? createPortal(fabButton, headerHost) : fabButton)}
      {open && (
        <div
          ref={containerRef}
          className="fixed inset-0 pointer-events-none"
          style={{ zIndex }}
          role="dialog"
          aria-modal="true"
          aria-label="AI分析"
          tabIndex={-1}
        >
          <div className="absolute inset-0 bg-[#0b1f3a]/25 sup-fade pointer-events-none" aria-hidden />
          <aside className="absolute top-0 right-0 h-full w-[460px] max-w-[100vw] bg-surface border-l border-line flex flex-col shadow-[-8px_0_24px_rgba(11,31,58,0.12)] pointer-events-auto">
          <div className="h-14 px-5 border-b border-line flex items-center justify-between">
            <div>
              <div className="text-[15px] font-semibold">AI分析</div>
              <button type="button" className="text-[12px] text-brand hover:underline" onClick={() => setScopeNote((v) => !v)}>
                {ai.modeDisplay} · {ai.externalConnected ? "已连接模型服务" : "未连接模型服务"}
              </button>
            </div>
            <button type="button" className="text-textsub hover:text-textmain" onClick={close} aria-label="关闭">
              ✕
            </button>
          </div>
          {scopeNote && (
            <div className="px-5 py-3 text-[12px] text-textsub border-b border-line leading-5">
              当前为预置分析。支持指标解释、规则命中、材料比对和核查建议四类任务，输出绑定已有样例事实。不替代专业判断，不自动关闭事项或发布配置。
            </div>
          )}
          <div className="px-5 py-3 flex flex-wrap gap-1.5 border-b border-line">
            {visibleTasks.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setTask(t.id)}
                className={`h-8 px-2.5 rounded-[6px] text-[12px] border ${
                  task === t.id ? "bg-brand text-white border-brand" : "border-line text-textmain hover:bg-tint"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
            <Tag tone="brand">{content.title}</Tag>
            {content.sections.map((s) => (
              <div key={s.h}>
                <div className="text-[13px] font-medium text-textmain mb-1">{s.h}</div>
                <p className="text-[13px] text-textsub leading-6">{s.p}</p>
              </div>
            ))}
            <p className="text-[12px] text-textsub">{config.ai.unrecognized_question}</p>
          </div>
          <div className="px-5 py-3 border-t border-line">
            <Button onClick={close}>关闭</Button>
          </div>
          </aside>
        </div>
      )}
    </>
  );
}
