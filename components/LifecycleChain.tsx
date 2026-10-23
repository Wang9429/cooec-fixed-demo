"use client";

import React from "react";
import type { ChevronItem } from "@/components/ChevronFlow";

/**
 * 投资管理监管总览的横向流程链。八个环节保持同一行，用连接箭头表示先后衔接。
 * 窄屏只在链条区域内横向滚动，不换行、不改成宫格。
 */
export default function LifecycleChain({
  items,
  value,
  onChange,
}: {
  items: ChevronItem[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <section
      className="bg-surface border border-line rounded-[10px] shadow-[0_2px_10px_rgba(17,43,77,0.04)] px-4 py-4"
      data-testid="lifecycle-chain"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[16px] font-semibold text-textmain">投资全生命周期</h2>
        <button
          type="button"
          data-testid="lifecycle-all"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={`shrink-0 h-8 px-3 rounded-[6px] border text-[13px] transition-colors duration-150 ${
            value === null ? "border-brand bg-tint text-brand font-medium" : "border-line bg-surface text-textsub hover:bg-tint"
          }`}
        >
          全部环节
        </button>
      </div>
      <div className="overflow-x-auto pb-1" role="tablist" aria-label="投资管理业务阶段">
        <div className="flex items-stretch min-w-max">
          {items.map((item, index) => {
            const selected = value === item.id;
            const countTone =
              item.openCount === 0
                ? "var(--risk-neutral-fg)"
                : item.severity === "red"
                  ? "var(--risk-red-fg)"
                  : "var(--risk-amber-fg)";
            return (
              <div key={item.id} className="flex items-center">
                {index > 0 && (
                  <span className="w-8 shrink-0 flex items-center text-[#8EADD4]" aria-hidden>
                    <span className="h-px flex-1 bg-current" />
                    <span className="text-[16px] leading-none -ml-0.5">›</span>
                  </span>
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`lifecycle-node-${item.id}`}
                  onClick={() => onChange(item.id)}
                  title={`${item.name}｜未关闭事项 ${item.openCount} 件`}
                  className={`w-[128px] shrink-0 h-[76px] rounded-[8px] border px-2.5 text-left transition-colors duration-150 ${
                    selected ? "border-brand bg-tint shadow-[inset_0_0_0_1px_var(--brand)]" : "border-line bg-white hover:bg-tint"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`num inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] shrink-0 ${
                        selected ? "bg-brand text-white" : "bg-[#E7EFFA] text-brand"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className={`text-[13px] leading-[18px] whitespace-nowrap ${selected ? "text-brand font-medium" : "text-textmain"}`}>
                      {item.name}
                    </span>
                  </span>
                  <span className="block text-[12px] leading-[18px] mt-1.5 pl-6 whitespace-nowrap">
                    <span className="text-textsub">未关闭 </span>
                    <span className="num font-semibold" style={{ color: countTone }}>
                      {item.openCount}
                    </span>
                    <span className="text-textsub"> 件</span>
                    {item.openCount > 0 && (
                      <span style={{ color: countTone }} aria-hidden>
                        {" "}
                        {item.severity === "red" ? "●" : "▲"}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
