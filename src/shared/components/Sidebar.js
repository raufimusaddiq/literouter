"use client";

import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "dashboard" },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/systemone", label: "System One", icon: "account_tree" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
];

const systemItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/profile", label: "Settings", icon: "settings" },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const isActive = (href) => href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
  const link = (item) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={onClose}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={cn(
        "group relative flex min-h-11 touch-manipulation items-center gap-3 rounded-xl px-3 py-2.5 transition-[background-color,color] duration-200 focus-visible:outline-2 focus-visible:outline-primary",
        isActive(item.href)
          ? "bg-primary/10 text-primary before:absolute before:left-0 before:top-2 before:h-7 before:w-0.5 before:rounded-full before:bg-primary"
          : "text-text-muted hover:bg-bg-alt hover:text-text-main"
      )}
    >
      <span className={cn(
        "material-symbols-outlined text-[18px]",
        isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors duration-200"
      )}>
        {item.icon}
      </span>
      <span className="text-[13px] font-medium">{item.label}</span>
    </Link>
  );

  return (
    <aside className="relative flex h-full w-[15.5rem] min-h-0 flex-col overflow-hidden border-r border-border-subtle bg-sidebar p-3 text-text-main transition-colors duration-300">
      <div className="px-3 py-4">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="flex size-10 items-center justify-center rounded-[10px] bg-primary text-white shadow-[0_14px_30px_-16px_var(--color-primary)] transition-colors duration-200">
            <span aria-hidden="true" className="material-symbols-outlined text-[21px]">route</span>
          </div>
          <div className="flex min-w-0 flex-col">
            <h1 className="text-[17px] font-semibold tracking-[-0.05em] text-text-main">{APP_CONFIG.name}</h1>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Control plane</span>
          </div>
        </Link>
      </div>
      <div className="mx-3 h-px bg-border-subtle" />
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 py-5 custom-scrollbar">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-subtle">Workspace</p>
        {navItems.map(link)}
        <div className="pt-3 mt-2 space-y-0.5">
          <p className="px-3 text-[10px] font-semibold text-text-subtle uppercase tracking-[0.18em] mb-2">System</p>
          {systemItems.map(link)}
        </div>
      </nav>
      <div className="m-1 rounded-[10px] bg-bg-alt p-3 ring-1 ring-border-subtle" role="status" aria-label="Workspace status">
        <div className="flex items-center gap-2 text-xs font-medium text-text-main">
          <span className="size-2 rounded-full bg-success" />
          Workspace online
        </div>
        <p className="mt-1 text-[11px] leading-4 text-text-muted">Routes, keys, and provider state stay local.</p>
      </div>
    </aside>
  );
}

Sidebar.propTypes = { onClose: PropTypes.func };
