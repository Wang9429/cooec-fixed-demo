"use client";

import Link from "next/link";
import { DOMAIN_META } from "@/lib/seed";
import { canDomain } from "@/lib/config";
import { useDemoStore } from "@/lib/store";

const KINDS = ["FA", "EQ"] as const;

/** 投资管理页面内切换固定资产与股权，沿用各自路由，不合并数据。 */
export default function InvestmentKindTabs({ current }: { current: "FA" | "EQ" }) {
  const { user } = useDemoStore();
  const visible = KINDS.filter((domain) => canDomain(user, domain));
  if (!visible.length) return null;

  return (
    <div
      className="flex items-center gap-1 border-b border-line overflow-x-auto"
      role="tablist"
      aria-label="投资类型"
      data-testid="investment-kind-tabs"
    >
      {visible.map((domain) => {
        const meta = DOMAIN_META[domain];
        const active = domain === current;
        return (
          <Link
            key={domain}
            href={meta.route}
            role="tab"
            aria-selected={active}
            data-testid={`investment-tab-${domain}`}
            className={`relative inline-flex items-center px-4 h-10 text-[14px] whitespace-nowrap ${
              active ? "text-brand font-medium" : "text-textsub hover:text-textmain"
            }`}
          >
            {meta.label}
            {active && <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-brand rounded-full" />}
          </Link>
        );
      })}
    </div>
  );
}
