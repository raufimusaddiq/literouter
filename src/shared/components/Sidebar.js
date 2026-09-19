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
        "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
        isActive(item.href)
          ? "bg-primary/10 text-primary"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
      )}
    >
      <span className={cn(
        "material-symbols-outlined text-[18px]",
        isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
      )}>
        {item.icon}
      </span>
      <span className="text-[13px] font-medium">{item.label}</span>
    </Link>
  );

  return (
    <aside className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">
      <div className="flex items-center gap-2 px-6 pt-5 pb-2">
        <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
        <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
        <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
      </div>
      <div className="px-6 py-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex items-center justify-center size-9 rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-[var(--shadow-warm)]">
            <span className="material-symbols-outlined text-white text-[20px]">hub</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold tracking-tight text-text-main">{APP_CONFIG.name}</h1>
            <span className="text-xs text-text-muted">v{APP_CONFIG.version}</span>
          </div>
        </Link>
      </div>
      <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
        {navItems.map(link)}
        <div className="pt-3 mt-2 space-y-0.5">
          <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">System</p>
          {systemItems.map(link)}
        </div>
      </nav>
    </aside>
  );
}

Sidebar.propTypes = { onClose: PropTypes.func };
