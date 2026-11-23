"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";
import LogoMark from "@/shared/components/shell/LogoMark";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");

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
      <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-ink"></div>
          <p className="mt-4 text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-line-strong bg-raise lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden min-h-[34rem] border-r border-line-strong p-10 lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex items-center gap-3 text-ink">
              <LogoMark size={28} />
              <p className="text-base font-semibold tracking-[-0.02em]">LiteRouter</p>
            </div>
            <p className="mt-20 text-[12.5px] font-medium text-muted">Local routing control plane</p>
            <h1 className="mt-3 max-w-md text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-ink">One endpoint. Clear operational state.</h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-muted">Manage keys, providers, usage, and quota without changing the client contract.</p>
          </div>
          <ul className="m-0 grid list-none grid-cols-3 gap-4 border-t border-line p-0 pt-4 text-[12.5px] text-muted">
            <li className="flex items-center gap-2"><span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />Provider health</li>
            <li className="flex items-center gap-2"><span aria-hidden="true" className="size-1.5 rounded-full bg-faint" />Fallback routes</li>
            <li className="flex items-center gap-2"><span aria-hidden="true" className="size-1.5 rounded-full bg-faint" />Quota signals</li>
          </ul>
        </section>

        <section className="flex items-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-2.5 text-ink">
                <LogoMark size={26} />
                <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink">LiteRouter</h1>
              </div>
              <p className="mt-2 text-[12.5px] font-medium text-muted">Routing control plane</p>
            </div>
            <div className="mb-7">
              <h2 className="text-2xl font-semibold tracking-[-0.03em] text-ink">Welcome back</h2>
              <p className="mt-2 text-sm text-muted">Enter your password to access the dashboard.</p>
            </div>

            <Card>
              {mustChange ? (
                <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
                  <p className="text-center text-sm text-warning">
                    Set a new password before accessing the dashboard remotely.
                  </p>
                  <Input
                    label="New password"
                    type="password"
                    placeholder="Enter new password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    error={error || undefined}
                    required
                    autoFocus
                  />
                  <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!newPassword}>
                    Set password
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Input
                      label="Password"
                      type="password"
                      placeholder="Enter password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      error={error || undefined}
                      required
                      autoFocus
                    />
                    {retryAfter > 0 && (
                      <p className="text-xs text-warning">
                        Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                      </p>
                    )}
                    {resetHint && (
                      <p className="text-xs text-muted">
                        Forgot password? Open <code className="rounded bg-surface-2 px-1 font-mono">literouter</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                      </p>
                    )}
                  </div>

                  <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={retryAfter > 0}>
                    {retryAfter > 0 ? `Wait ${retryAfter}s` : "Login"}
                  </Button>

                  <p className="mt-2 text-center text-xs text-muted">
                    Default password is <code className="rounded bg-surface-2 px-1 font-mono">123456</code>
                  </p>
                  {hasPassword === false && (
                    <p className="text-center text-xs text-warning">
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
