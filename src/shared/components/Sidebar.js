"use client";

import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
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
  const isActive = (href) => href === "/dashboard/endpoint"
    ? pathname === "/dashboard" || pathname.startsWith(href)
    : pathname.startsWith(href);
  const link = (item) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={onClose}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group",
        isActive(item.href)
          ? "bg-primary text-white shadow-[0_10px_24px_-14px_var(--color-primary)]"
          : "text-text-muted hover:bg-surface hover:text-text-main"
      )}
    >
      <span className={cn(
        "material-symbols-outlined text-[18px]",
        isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors duration-500"
      )}>
        {item.icon}
      </span>
      <span className="text-[13px] font-medium">{item.label}</span>
    </Link>
  );

  return (
    <aside className="flex w-[17.5rem] flex-col rounded-[1.65rem] bg-sidebar p-3 ring-1 ring-border-subtle transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] min-h-full">
      <div className="px-3 py-4">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="flex items-center justify-center size-10 rounded-2xl bg-primary text-white shadow-[0_14px_30px_-16px_var(--color-primary)] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-0.5">
            <span className="material-symbols-outlined text-[21px]">route</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-[17px] font-semibold tracking-[-0.05em] text-text-main">{APP_CONFIG.name}</h1>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Control plane</span>
          </div>
        </Link>
      </div>
      <nav className="flex-1 px-1 py-4 space-y-1 overflow-y-auto custom-scrollbar">
        {navItems.map(link)}
        <div className="pt-3 mt-2 space-y-0.5">
          <p className="px-3 text-[10px] font-semibold text-text-muted/60 uppercase tracking-[0.18em] mb-2">System</p>
          {systemItems.map(link)}
        </div>
      </nav>
    </aside>
  );
}

Sidebar.propTypes = { onClose: PropTypes.func };
