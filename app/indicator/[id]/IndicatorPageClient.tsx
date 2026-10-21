"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useEffect } from "react";
import IndicatorDrawer from "@/components/IndicatorDrawer";
import { Card, Notice } from "@/components/ui";
import { DOMAIN_META } from "@/lib/seed";
import { indicatorById } from "@/lib/metrics";
import { runnableDrawerIndicators } from "@/lib/indicator-scope";
import { orgName } from "@/lib/org";
import { useDemoStore } from "@/lib/store";
import { isRetiredSupervisionDomain } from "@/lib/supervision-scope";

/**
 * P71 指标穿透独立页。直接访问路由时提供同内容，
 * 返回链接指向携带上下文的来源领域；卡片默认交互仍是弹出组织树。
 */
export default function IndicatorPageClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { filters } = useDemoStore();
  const id = decodeURIComponent(params.id);
  const def = indicatorById(id);
  const retired = Boolean(def && isRetiredSupervisionDomain(def.domain));

  useEffect(() => {
    if (retired) router.replace("/fixed-asset-investment");
  }, [retired, router]);

  const scopeLabel = `${orgName(filters.orgId)}${filters.includeChildren ? "（含下级）" : "（仅本级）"}｜${filters.periodStart}~${filters.periodEnd}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button className="text-[13px] text-brand hover:underline" onClick={() => router.back()}>
          ‹ 返回来源页面
        </button>
        {def && !retired && (
          <>
            <span className="text-textsub">/</span>
            <Link href={DOMAIN_META[def.domain].route} className="text-[13px] text-brand hover:underline">
              {DOMAIN_META[def.domain].label}
            </Link>
          </>
        )}
      </div>

      {retired ? (
        <p className="text-[14px] text-textsub">正在进入投资管理。</p>
      ) : def ? (
        <IndicatorDrawer
          open
          onClose={() => router.back()}
          indicator={def}
          indicatorOptions={runnableDrawerIndicators(def.domain)}
          onSwitchIndicator={(next) => router.replace(`/indicator/${next}`)}
          allowIndicatorSwitch
          initialOrgId={filters.orgId}
          includeChildren={filters.includeChildren}
          scopeLabel={scopeLabel}
          onOpenObject={(oid) => router.push(`/object/${oid}`)}
          onOpenRisk={() => router.push("/supervision-workbench")}
        />
      ) : (
        <Card title={`指标 ${id}`}>
          <Notice tone="amber" title="指标不存在">
            {id} 不在当前指标目录中。
          </Notice>
        </Card>
      )}
    </div>
  );
}
