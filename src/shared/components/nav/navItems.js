export const NAV_GROUPS = [
  { id: "operate", label: "Operate" },
  { id: "route", label: "Route" },
  { id: "observe", label: "Observe" },
  { id: "system", label: "System" },
];

export const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Overview",
    shortLabel: "Overview",
    icon: "dashboard",
    group: "operate",
    primary: true,
  },
  {
    href: "/dashboard/endpoint",
    label: "Endpoint & Key",
    shortLabel: "Keys",
    icon: "api",
    group: "operate",
    primary: true,
  },
  {
    href: "/dashboard/providers",
    label: "Providers",
    shortLabel: "Providers",
    icon: "dns",
    group: "operate",
    primary: true,
  },
  {
    href: "/dashboard/combos",
    label: "Combo & Vision Adapter",
    shortLabel: "Combo & Vision Adapter",
    icon: "layers",
    group: "route",
    primary: false,
  },
  {
    href: "/dashboard/systemone",
    label: "System One",
    shortLabel: "System One",
    icon: "account_tree",
    group: "route",
    primary: false,
  },
  {
    href: "/dashboard/usage",
    label: "Usage",
    shortLabel: "Usage",
    icon: "bar_chart",
    group: "observe",
    primary: true,
  },
  {
    href: "/dashboard/quota",
    label: "Quota Tracker",
    shortLabel: "Quota Tracker",
    icon: "data_usage",
    group: "observe",
    primary: false,
  },
  {
    href: "/dashboard/token-saver",
    label: "Token Saver",
    shortLabel: "Token Saver",
    icon: "savings",
    group: "observe",
    primary: false,
  },
  {
    href: "/dashboard/console-log",
    label: "Console Log",
    shortLabel: "Console Log",
    icon: "terminal",
    group: "system",
    primary: false,
  },
  {
    href: "/dashboard/profile",
    label: "Settings",
    shortLabel: "Settings",
    icon: "settings",
    group: "system",
    primary: false,
  },
];

export function isNavActive(href, pathname) {
  if (!pathname) return false;
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}
