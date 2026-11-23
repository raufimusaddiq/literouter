"use client";

import PropTypes from "prop-types";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";

export const getPageInfo = (pathname) => {
  if (!pathname) return { title: "", description: "", breadcrumbs: [] };

  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo =
      OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId];
    if (providerInfo) {
      return {
        title: providerInfo.name,
        description: "",
        breadcrumbs: [
          { label: "Providers", href: "/dashboard/providers" },
          {
            label: providerInfo.name,
            image: getProviderIconSrc(providerInfo.id),
          },
        ],
      };
    }
  }

  if (pathname.includes("/providers"))
    return {
      title: "Providers",
      description: "Manage your AI provider connections",
      icon: "dns",
      breadcrumbs: [],
    };
  if (pathname.includes("/combos"))
    return {
      title: "Combos",
      description: "Model combos with fallback",
      icon: "layers",
      breadcrumbs: [],
    };
  if (pathname.includes("/usage"))
    return {
      title: "Usage & Analytics",
      description:
        "Monitor your API usage, token consumption, and request logs",
      icon: "bar_chart",
      breadcrumbs: [],
    };
  if (pathname.includes("/auth-files"))
    return {
      title: "Auth Files",
      description: "Map provider credentials stored in the local database",
      icon: "vpn_key",
      breadcrumbs: [],
    };
  if (pathname.includes("/quota"))
    return {
      title: "Quota Tracker",
      description: "Track and manage your API quota limits",
      icon: "data_usage",
      breadcrumbs: [],
    };
  if (pathname.includes("/systemone"))
    return {
      title: "System One",
      description: "Typed decision requests",
      icon: "account_tree",
      breadcrumbs: [],
    };
  if (pathname.includes("/token-saver"))
    return {
      title: "Token Saver",
      description: "Compress prompts and outputs to save tokens",
      icon: "savings",
      breadcrumbs: [],
    };
  if (pathname.includes("/endpoint"))
    return {
      title: "Endpoint",
      description: "API endpoint configuration",
      icon: "api",
      breadcrumbs: [],
    };
  if (pathname.includes("/profile"))
    return {
      title: "Settings",
      description: "Manage your preferences",
      icon: "settings",
      breadcrumbs: [],
    };
  if (pathname.includes("/console-log"))
    return {
      title: "Console Log",
      description: "Live server console output",
      icon: "monitor",
      breadcrumbs: [],
    };
  if (pathname === "/dashboard")
    return {
      title: "Overview",
      description: "Routing control center",
      icon: "dashboard",
      breadcrumbs: [],
    };
  return { title: "", description: "", breadcrumbs: [] };
};

export default function Header() {
  return null;
}

export function HeaderControls({ className = "" }) {
  const visible = useHeaderSearchStore((s) => s.visible);
  if (!visible) return null;

  return (
    <div className={`flex shrink-0 items-center gap-1 ${className}`}>
      <HeaderSearch />
    </div>
  );
}

HeaderControls.propTypes = { className: PropTypes.string };

function HeaderSearch() {
  const visible = useHeaderSearchStore((s) => s.visible);
  const query = useHeaderSearchStore((s) => s.query);
  const placeholder = useHeaderSearchStore((s) => s.placeholder);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);

  if (!visible) return null;

  return (
    <div className="relative w-[160px] sm:w-[220px]">
      <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[16px] text-muted">
        search
      </span>
      <input
        type="text"
        aria-label={placeholder || "Search"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-line-strong bg-raise pl-8 pr-7 text-sm text-ink placeholder:text-faint transition-[background-color,border-color,box-shadow] focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line/20"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-0.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Clear search"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
        </button>
      )}
    </div>
  );
}
