import { Component, Suspense, createElement, lazy, useEffect } from "react";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import TimezoneProvider from "@/shared/components/TimezoneProvider";
import DashboardLayout from "@/shared/components/layouts/DashboardLayout";
import { CardSkeleton } from "@/shared/components/Loading";
import { Link, ParamsProvider, matchRoute, redirect, usePathname } from "./router.js";
import { routes } from "./routes.js";
import { getBoot } from "./boot.js";

const lazyPages = new WeakMap();

function lazyPage(route) {
  let page = lazyPages.get(route);
  if (!page) {
    page = lazy(route.load);
    lazyPages.set(route, page);
  }
  return page;
}

function pick(list, pathname) {
  for (const route of list) {
    const params = matchRoute(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/dashboard" className="text-sm underline">
        Back to the dashboard
      </Link>
    </div>
  );
}

export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm">This page failed to load</p>
        <button
          type="button"
          className="rounded-md border border-current px-3 py-1.5 text-sm"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}

function RedirectRoute({ to }) {
  useEffect(() => {
    redirect(to);
  }, [to]);
  return null;
}

export function Routes({ routesOverride }) {
  const pathname = usePathname();
  const match = pick(routesOverride ?? routes, pathname);
  if (!match) return <NotFound />;
  const { route, params } = match;
  if (route.redirect) return <RedirectRoute to={route.redirect} />;
  const body = (
    <RouteErrorBoundary key={route.path}>
      <Suspense fallback={<CardSkeleton />}>
        {createElement(lazyPage(route))}
      </Suspense>
    </RouteErrorBoundary>
  );
  return (
    <ParamsProvider params={params}>
      {route.shell ? <DashboardLayout>{body}</DashboardLayout> : body}
    </ParamsProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <RuntimeI18nProvider>
        <TimezoneProvider timeZone={getBoot().timeZone}>
          <Routes />
        </TimezoneProvider>
      </RuntimeI18nProvider>
    </ThemeProvider>
  );
}
