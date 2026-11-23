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
          <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 lg:flex-1">
            <span className="shrink-0 text-[12.5px] font-medium text-muted">Base URL</span>
            <div className="inline-flex h-8 min-w-0 max-w-full items-center overflow-hidden rounded-md border border-line-strong">
              <code
                className="min-w-0 flex-1 truncate px-2.5 font-mono text-[11.5px] tracking-[-0.01em] text-ink sm:flex-initial sm:px-3 sm:text-[12.5px]"
                title={baseUrl}
              >
                {baseUrl}
              </code>
              <span
                role="status"
                className={`inline-flex h-full shrink-0 items-center gap-1.5 border-l border-line px-3 text-[12.5px] font-semibold ${
                  secure ? "text-ok" : "text-warning"
                }`}
              >
                <span aria-hidden="true" className={`size-[7px] shrink-0 rounded-full ${secure ? "bg-ok" : "bg-warning"}`} />
                {secure ? "Protected" : "Open"}
              </span>
              <button
                type="button"
                onClick={() => onCopy(baseUrl, "local_url")}
                className="h-full shrink-0 cursor-pointer border-l border-line bg-raise px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-line focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-mark-line"
                aria-label="Copy endpoint URL"
              >
                {copied === "local_url" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <Toggle
            checked={requireApiKey}
            onChange={() => onRequireApiKey(!requireApiKey)}
            label="Require API key"
            aria-label="Require API key"
          />
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
        <p className="text-[12.5px] text-muted">
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
