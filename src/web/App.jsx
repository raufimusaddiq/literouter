import { Component, Suspense, createElement, lazy, useEffect } from "react";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import TimezoneProvider from "@/shared/components/TimezoneProvider";
import DashboardLayout from "@/shared/components/layouts/DashboardLayout";
import { CardSkeleton } from "@/shared/components/Loading";
import { Link, ParamsProvider, redirect, usePathname, useScrollReset } from "./router.js";
import { findRoute, routes } from "./routes.js";
import { getBoot } from "./boot.js";

const CHUNK_RELOAD_KEY = "lr:chunk-reload";
const CHUNK_RELOAD_WINDOW_MS = 30_000;

const lazyPages = new WeakMap();

function reloadOnceOnStaleChunk(error) {
  let reload = false;
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY));
    reload = !last || Date.now() - last > CHUNK_RELOAD_WINDOW_MS;
    if (reload) window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    reload = false;
  }
  if (!reload) throw error;
  window.location.reload();
  return new Promise(() => {});
}

function lazyPage(route) {
  let page = lazyPages.get(route);
  if (!page) {
    page = lazy(() => route.load().catch(reloadOnceOnStaleChunk));
    lazyPages.set(route, page);
  }
  return page;
}

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center text-ink">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Page not found</h1>
      <Link href="/dashboard" className="text-sm text-muted underline underline-offset-4 hover:text-ink">
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
        <p className="text-sm text-ink">This page failed to load</p>
        <button
          type="button"
          className="h-8 cursor-pointer rounded-md border border-line-strong px-3.5 text-[13px] font-semibold text-ink transition-colors hover:bg-raise focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line"
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
  const match = findRoute(pathname, routesOverride ?? routes);
  useScrollReset(null, !match?.route.shell);
  if (!match) return <NotFound />;
  const { route, params } = match;
  if (route.redirect) return <RedirectRoute to={route.redirect} />;
  const body = (
    <RouteErrorBoundary key={pathname}>
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
