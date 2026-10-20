"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useMemo, useState } from "react";
import { DOMAIN_META, INVESTMENT_NAV_ID, NAV_ITEMS, isInvestmentPath } from "@/lib/seed";
import { can, canDomain, config, riskVisible } from "@/lib/config";
import { useDemoStore } from "@/lib/store";
import { Modal } from "@/components/ui";
import { isOpen } from "@/lib/risks";
import AiPanel, { AiToolbarButton, AiUiProvider } from "@/components/AiPanel";
import FilterBar from "@/components/FilterBar";
import {
  IconBell,
  IconBrandMark,
  IconDoc,
  IconGear,
  NAV_ICONS,
} from "@/components/icons";

const UI_VERSION = "1.6.1";

const PAGE_OWNS_FILTER = [
  "/overview",
  "/fixed-asset-investment",
  "/equity-investment",
  "/international-business",
  "/funds",
  "/property-rights",
  "/engineering-projects",
  "/supervision-workbench",
];

function routeActive(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function breadcrumb(pathname: string): { parent: string; current: string } {
  if (pathname.startsWith("/settings")) return { parent: "穿透式监管", current: "系统配置" };
  if (pathname.startsWith("/supervision-workbench")) return { parent: "穿透式监管", current: "监管工作台" };
  if (pathname.startsWith("/scenario-library")) return { parent: "系统配置", current: "场景规则库" };
  if (pathname.startsWith("/data-sources")) return { parent: "系统配置", current: "数据与运行" };
  if (pathname.startsWith("/object/")) return { parent: "穿透式监管", current: "对象档案" };
  if (isInvestmentPath(pathname)) {
    const current = routeActive(pathname, DOMAIN_META.EQ.route) ? DOMAIN_META.EQ.label : DOMAIN_META.FA.label;
    return { parent: "投资管理", current };
  }
  const nav = NAV_ITEMS.find((item) => item.id !== INVESTMENT_NAV_ID && routeActive(pathname, item.route));
  return { parent: "穿透式监管", current: nav?.label ?? "综合总览" };
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { dirty, saveError, user, setUserId, configUsers, risks } = useDemoStore();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  const pendingCount = useMemo(
    () => risks.filter((r) => isOpen(r) && riskVisible(user, r)).length,
    [risks, user],
  );
  const canInvestment = canDomain(user, "FA") || canDomain(user, "EQ");
  const navItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (!can(user, "business.read")) return false;
        if (item.id === INVESTMENT_NAV_ID) return canInvestment;
        return canDomain(user, item.domain);
      }),
    [user, canInvestment],
  );
  const crumbs = breadcrumb(pathname);
  const ownsFilter = PAGE_OWNS_FILTER.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const showFilter = !pathname.startsWith("/settings") && !ownsFilter;
  const initial = (user?.name ?? "用").slice(0, 1);

  return (
    <AiUiProvider>
    <div className="reg-app">
      <nav className="reg-sidebar" aria-label="一级导航">
        <div className="reg-brand">
          <IconBrandMark />
          <div className="min-w-0">
            <div className="reg-brand-title">{config.ui.brand_lines[0]}</div>
            <div className="reg-brand-sub">{config.ui.brand_lines[1]}</div>
          </div>
        </div>
        <ul className="reg-nav">
          {navItems.map((item) => {
            const active = item.id === INVESTMENT_NAV_ID ? isInvestmentPath(pathname) : routeActive(pathname, item.route);
            const href =
              item.id === INVESTMENT_NAV_ID
                ? canDomain(user, "FA")
                  ? DOMAIN_META.FA.route
                  : DOMAIN_META.EQ.route
                : item.route;
            const Icon = NAV_ICONS[item.id] ?? NAV_ICONS.P00;
            return (
              <li key={item.id}>
                <Link
                  href={href}
                  className="reg-nav-link"
                  aria-current={active ? "page" : undefined}
                  data-testid={item.id === INVESTMENT_NAV_ID ? "nav-investment" : `nav-${item.id}`}
                >
                  <Icon size={18} />
                  <span className="reg-nav-label" title={item.label}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="reg-sidebar-footer">
          <Link
            href="/settings"
            className="reg-nav-link"
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          >
            <IconGear size={18} />
            <span className="reg-nav-label">系统配置</span>
          </Link>
          <button
            type="button"
            className="reg-nav-link w-full text-left"
            onClick={() => setNoticeOpen(true)}
          >
            <IconDoc size={18} />
            <span className="reg-nav-label">数据说明</span>
          </button>
        </div>
      </nav>

      <div className="reg-main">
        <header className="reg-toolbar sticky top-0 z-30">
          <nav className="text-[13px] text-textsub min-w-0 truncate" aria-label="面包屑">
            <span>{crumbs.parent}</span>
            <span className="mx-1.5 text-[#C5D0DE]">/</span>
            <span className="text-textmain">{crumbs.current}</span>
          </nav>
          <div className="reg-toolbar-actions">
            <Link
              href="/supervision-workbench"
              className="inline-flex items-center gap-2 h-9 px-3 rounded-[8px] border border-line text-[13px] text-textmain hover:bg-tint"
            >
              监管工作台
              <span className="num inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-full bg-brand text-white text-[11px]">
                {pendingCount}
              </span>
            </Link>
            <Link
              href="/scenario-library"
              className="inline-flex items-center h-9 px-3 rounded-[8px] border border-line text-[13px] text-textmain hover:bg-tint whitespace-nowrap"
              aria-current={pathname.startsWith("/scenario-library") ? "page" : undefined}
            >
              场景规则库
            </Link>
            <Link
              href="/supervision-workbench"
              className="relative inline-flex items-center justify-center h-9 w-9 rounded-[8px] border border-line text-textsub hover:bg-tint hover:text-brand"
              aria-label={`待办 ${pendingCount} 件`}
            >
              <IconBell size={18} />
              {pendingCount > 0 && (
                <span className="num absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[11px] flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </Link>
            <button
              type="button"
              className="h-9 px-3 rounded-[8px] border border-line text-[13px] text-textmain hover:bg-tint"
              onClick={() => setNoticeOpen(true)}
            >
              {config.data_notice.entry_label}
            </button>
            <AiToolbarButton />
            <div className="relative">
              <button
                type="button"
                className="flex items-center gap-2 h-9 pl-1 pr-2.5 rounded-full border border-line max-w-[220px] hover:bg-tint"
                onClick={() => setUserMenu((v) => !v)}
                aria-label="当前用户"
                title="本地身份切换，用于验证授权产品行为，不等于正式登录"
              >
                <span className="w-7 h-7 rounded-full bg-brand text-white text-[13px] font-medium flex items-center justify-center shrink-0">
                  {initial}
                </span>
                <span className="text-[13px] text-textmain truncate">{user?.name ?? "未登录"}</span>
              </button>
              {userMenu && (
                <div className="absolute right-0 mt-1 bg-surface border border-line rounded-[8px] shadow-[0_8px_24px_rgba(17,43,77,0.12)] z-40 min-w-[200px] max-w-[280px] py-1">
                  {configUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-[13px] hover:bg-tint ${
                        u.id === user?.id ? "text-brand font-medium" : "text-textmain"
                      }`}
                      onClick={() => {
                        setUserId(u.id);
                        setUserMenu(false);
                      }}
                    >
                    {u.name}
                    {(u.status === "disabled" || u.status === "retired") && (
                      <span className="text-textsub">（停用）</span>
                    )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              className="absolute w-px h-px overflow-hidden opacity-0"
              value={user?.id ?? ""}
              onChange={(e) => setUserId(e.target.value)}
              aria-label="当前用户（键盘）"
            >
              {configUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        {showFilter && (
          <div className="px-6 py-3 bg-surface border-b border-line">
            <FilterBar />
          </div>
        )}

        {(dirty || saveError || (user && !can(user, "business.read"))) && (
          <div className="px-6 py-2 bg-[#fafcff] border-b border-line flex flex-wrap items-center gap-3 text-[12px] text-textsub">
            {dirty && <span className="text-brand">含本地办理修改</span>}
            {saveError && <span style={{ color: "var(--risk-red-fg)" }}>{saveError}</span>}
            {user && !can(user, "business.read") && <span>当前身份无业务数据权限</span>}
          </div>
        )}

        <main className="reg-content flex-1 min-w-0" key={user?.id ?? "anon"}>
          {children}
        </main>
      </div>

      <AiPanel key={user?.id ?? "anon"} />

      <Modal open={noticeOpen} onClose={() => setNoticeOpen(false)} title="数据说明" width={640}>
        <p className="text-[14px] leading-6 text-textmain">{config.data_notice.text}</p>
        <dl className="mt-4 grid grid-cols-1 gap-2 text-[13px]">
          <div className="flex gap-3">
            <dt className="text-textsub shrink-0 w-24">界面版本</dt>
            <dd className="num text-textmain">{UI_VERSION}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-textsub shrink-0 w-24">业务口径</dt>
            <dd className="text-textmain">V1.6</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-textsub shrink-0 w-24">样例规模</dt>
            <dd className="text-textmain">
              纳管单位按组织主数据去重；工程项目按期间实施 64 个（含原 ENG-P001）、其中本期完工 9 个。公开 12 家子公司与 64 个项目是披露参照，合成台账另行记录来源。
            </dd>
          </div>
        </dl>
        <p className="text-[13px] text-textsub mt-3 leading-6">
          真实历史事件日期与样例行情分别标识。AI 面板当前为预置分析，未连接模型服务。匿名名称不等于真实经营数据。业务页面不标注“演示”。
        </p>
      </Modal>
    </div>
    </AiUiProvider>
  );
}
