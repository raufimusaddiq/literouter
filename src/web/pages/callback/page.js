"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "@/web/router";
import LogoMark from "@/shared/components/shell/LogoMark";
import { cn } from "@/shared/utils/cn";

function StatusIcon({ name, className }) {
  return (
    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full border border-line-strong">
      <span aria-hidden="true" className={cn("material-symbols-outlined text-[28px]", className)}>{name}</span>
    </div>
  );
}

function CallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    const code = searchParams.get("code");
    const token = searchParams.get("token");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    const callbackData = {
      code,
      token,
      state,
      error,
      errorDescription,
      fullUrl: window.location.href,
    };

    const expectedOrigins = [
      window.location.origin,
      "http://localhost:1455",
    ];

    if (window.opener) {
      for (const origin of expectedOrigins) {
        try {
          window.opener.postMessage({ type: "oauth_callback", data: callbackData }, origin);
        } catch (e) {
          console.log("postMessage failed:", e);
        }
      }
    }

    try {
      const channel = new BroadcastChannel("oauth_callback");
      channel.postMessage(callbackData);
      channel.close();
    } catch (e) {
      console.log("BroadcastChannel failed:", e);
    }

    try {
      localStorage.setItem("oauth_callback", JSON.stringify({ ...callbackData, timestamp: Date.now() }));
    } catch (e) {
      console.log("localStorage failed:", e);
    }

    if (!(code || token || error)) {
      setTimeout(() => setStatus("manual"), 0);
      return;
    }

    setTimeout(() => setStatus("success"), 0);
    setTimeout(() => {
      window.close();
      setTimeout(() => setStatus("done"), 500);
    }, 1500);
  }, [searchParams]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md text-center">
        <LogoMark size={28} className="mx-auto mb-8 text-ink" />
        {status === "processing" && (
          <>
            <StatusIcon name="progress_activity" className="animate-spin text-ink" />
            <h1 className="mb-2 text-xl font-semibold tracking-[-0.02em] text-ink">Processing...</h1>
            <p className="text-muted">Please wait while we complete the authorization.</p>
          </>
        )}

        {(status === "success" || status === "done") && (
          <>
            <StatusIcon name="check_circle" className="text-ok" />
            <h1 className="mb-2 text-xl font-semibold tracking-[-0.02em] text-ink">Authorization Successful!</h1>
            <p className="text-muted">
              {status === "success" ? "This window will close automatically..." : "You can close this tab now."}
            </p>
          </>
        )}

        {status === "manual" && (
          <>
            <StatusIcon name="info" className="text-warning" />
            <h1 className="mb-2 text-xl font-semibold tracking-[-0.02em] text-ink">Copy This URL</h1>
            <p className="mb-4 text-muted">
              Please copy the URL from the address bar and paste it in the application.
            </p>
            <div className="rounded-lg border border-line-strong bg-raise p-3 text-left">
              <code className="break-all font-mono text-xs text-ink">{typeof window !== "undefined" ? window.location.href : ""}</code>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <div className="p-8 text-center">
          <LogoMark size={28} className="mx-auto mb-6 text-ink" />
          <StatusIcon name="progress_activity" className="animate-spin text-ink" />
          <p className="text-muted">Loading...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
