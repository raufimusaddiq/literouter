"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || data.requireLogin === false) {
            window.location.assign("/dashboard");
            return;
          }
          setHasPassword(!!data.hasPassword);
        } else {
          setHasPassword(true);
        }
      } catch {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mustChangePassword) {
          setMustChange(true);
          return;
        }
        window.location.assign("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Force a new password before entering the dashboard (default + remote).
  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      if (res.ok) {
        window.location.assign("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to set password");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-backdrop flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[1.5rem] bg-surface shadow-[var(--shadow-elevated)] ring-1 ring-border-subtle lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden min-h-[34rem] overflow-hidden bg-sidebar p-10 lg:flex lg:flex-col lg:justify-between">
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_14px_30px_-16px_var(--color-primary)]">
                <span aria-hidden="true" className="material-symbols-outlined">route</span>
              </div>
              <div>
                <p className="text-base font-semibold tracking-[-0.04em] text-text-main">LiteRouter</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Control plane</p>
              </div>
            </div>
            <p className="page-kicker mt-20">Route with intent</p>
            <h1 className="mt-3 max-w-md text-4xl font-semibold leading-[1.05] tracking-[-0.06em] text-text-main">Your providers. One calm control surface.</h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-text-muted">Manage keys, provider health, usage, and quota without changing the client endpoint.</p>
          </div>
          <div className="relative z-10 grid grid-cols-3 gap-2 text-xs text-text-muted">
            <div className="rounded-xl bg-surface/70 p-3 ring-1 ring-border-subtle"><span className="mb-2 block size-2 rounded-full bg-success" />Provider health</div>
            <div className="rounded-xl bg-surface/70 p-3 ring-1 ring-border-subtle"><span className="mb-2 block size-2 rounded-full bg-primary" />Fallback routes</div>
            <div className="rounded-xl bg-surface/70 p-3 ring-1 ring-border-subtle"><span className="mb-2 block size-2 rounded-full bg-warning" />Quota signals</div>
          </div>
          <div className="landing-grid absolute inset-0 opacity-30" aria-hidden="true" />
        </section>

        <section className="flex items-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <p className="page-kicker">Routing control plane</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.06em] text-text-main">LiteRouter</h1>
            </div>
            <div className="mb-7">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-text-main">Welcome back</h2>
              <p className="mt-2 text-sm text-text-muted">Enter your password to access the dashboard.</p>
            </div>

        <Card className="shadow-none">
          {mustChange ? (
            <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
                Set a new password before accessing the dashboard remotely.
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">New password</label>
                <Input
                  type="password"
                  placeholder="Enter new password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!newPassword}>
                Set password
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
                {retryAfter > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                  </p>
                )}
                {resetHint && (
                  <p className="text-xs text-text-muted">
                    Forgot password? Open <code className="bg-sidebar px-1 rounded">9router</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                  </p>
                )}
              </div>

              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={retryAfter > 0}>
                {retryAfter > 0 ? `Wait ${retryAfter}s` : "Login"}
              </Button>

              <p className="text-xs text-center text-text-muted mt-2">
                Default password is <code className="bg-sidebar px-1 rounded">123456</code>
              </p>
              {hasPassword === false && (
                <p className="text-xs text-center text-amber-600 dark:text-amber-400">
                  Security risk: no password set. You will be asked to set one when logging in remotely.
                </p>
              )}
            </form>
          )}
        </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
