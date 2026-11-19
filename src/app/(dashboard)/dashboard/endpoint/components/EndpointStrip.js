"use client";

import PropTypes from "prop-types";
import { Card, Toggle } from "@/shared/components";
import SecurityWarning from "./SecurityWarning";
import Quickstart from "./Quickstart";

export default function EndpointStrip({
  baseUrl, copied, onCopy, requireApiKey, onRequireApiKey,
  isLoginUnsafe, requireLogin, isRemoteHost, secure,
}) {
  return (
    <Card id="require-api-key">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-text-muted">Base URL</span>
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-main" title={baseUrl}>{baseUrl}</code>
            <button
              type="button"
              onClick={() => onCopy(baseUrl, "local_url")}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded px-2 text-sm text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              aria-label="Copy endpoint URL"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{copied === "local_url" ? "check" : "content_copy"}</span>
              {copied === "local_url" ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2" role="status">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${secure ? "bg-success" : "bg-warning"}`} />
              <span className="text-sm font-semibold text-text-main">{secure ? "Protected" : "Review security"}</span>
            </div>
            <Toggle
              checked={requireApiKey}
              onChange={() => onRequireApiKey(!requireApiKey)}
              label="Require API key"
              aria-label="Require API key"
            />
          </div>
        </div>

        {(isLoginUnsafe || (isRemoteHost && !requireApiKey)) && (
          <div className="flex flex-col gap-2">
            {!requireApiKey && isLoginUnsafe && (
              <SecurityWarning
                message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                action={{ label: "Enable", href: "#require-api-key" }}
              />
            )}
            {isLoginUnsafe && (
              <SecurityWarning
                message={
                  !requireLogin
                    ? "Require login is disabled — anyone can reach your dashboard through the public endpoint."
                    : "Dashboard uses the default password — change it in Profile settings."
                }
                action={{
                  label: !requireLogin ? "Enable" : "Change password",
                  href: "/dashboard/profile",
                }}
              />
            )}
            {isRemoteHost && !requireApiKey && <SecurityWarning message="Endpoint is exposed without an API key." />}
          </div>
        )}
        <p className="text-xs text-text-muted">
          {requireApiKey ? "Requests without a valid key will be rejected." : "Requests without a key are accepted while this is off."}
        </p>

        <Quickstart baseUrl={baseUrl} copied={copied} onCopy={onCopy} />
      </div>
    </Card>
  );
}

EndpointStrip.propTypes = {
  baseUrl: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  requireApiKey: PropTypes.bool.isRequired,
  onRequireApiKey: PropTypes.func.isRequired,
  isLoginUnsafe: PropTypes.bool.isRequired,
  requireLogin: PropTypes.bool.isRequired,
  isRemoteHost: PropTypes.bool.isRequired,
  secure: PropTypes.bool.isRequired,
};
