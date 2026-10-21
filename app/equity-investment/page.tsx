"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 股权投资模块已退出。旧地址直接打开或刷新后进入投资管理。 */
export default function RetiredEquityInvestmentPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/fixed-asset-investment");
  }, [router]);
  return <p className="text-[14px] text-textsub">正在进入投资管理。</p>;
}
