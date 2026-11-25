"use client";

import PropTypes from "prop-types";
import { Badge, Toggle } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import {
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { Link } from "@/web/router";

function getStatusDisplay(connected, error, errorCode) {
  const parts = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" variant="success" size="sm" dot>
        {connected} Connected
      </Badge>,
    );
  }
  if (error > 0) {
    const errText = errorCode
      ? `${error} Error (${errorCode})`
      : `${error} Error`;
    parts.push(
      <Badge key="error" variant="error" size="sm" dot>
        {errText}
      </Badge>,
    );
  }
  if (parts.length === 0) {
    return <span className="text-faint">No connections</span>;
  }
  return parts;
}

export function ProviderCard({ providerId, provider, stats, authType, onToggle }) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isNoAuth = !!provider.noAuth;

  return (
    <Link
      href={`/dashboard/providers/${providerId}`}
      className={`group flex min-w-0 items-center justify-between gap-3 px-2 py-3 transition-colors hover:bg-raise focus-visible:bg-raise ${allDisabled ? "opacity-50" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-raise">
          <ProviderIcon
            src={`/providers/${provider.id}.png`}
            alt={provider.name}
            size={24}
            className="max-h-6 max-w-6 rounded object-contain"
            fallbackText={
              provider.textIcon || provider.id.slice(0, 2).toUpperCase()
            }
            fallbackColor={provider.color}
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{provider.name}</h3>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {allDisabled ? (
              <Badge variant="default" size="sm" dot>
                Disabled
              </Badge>
            ) : isNoAuth ? (
              <Badge variant="success" size="sm" dot>Ready</Badge>
            ) : (
              <>
                {getStatusDisplay(connected, error, errorCode)}
                {errorTime && (
                  <span className="font-mono text-faint">{errorTime}</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {stats.total > 0 && (
          <div
            className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle(!allDisabled ? false : true);
            }}
          >
            <Toggle
              size="sm"
              checked={!allDisabled}
              onChange={() => {}}
              title={allDisabled ? "Enable provider" : "Disable provider"}
              aria-label={allDisabled ? "Enable provider" : "Disable provider"}
            />
          </div>
        )}
      </div>
    </Link>
  );
}

ProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

export function ApiKeyProviderCard({
  providerId,
  provider,
  stats,
  authType,
  onToggle,
}) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(
    ANTHROPIC_COMPATIBLE_PREFIX,
  );

  const getIconPath = () => {
    if (isCompatible && provider.apiType)
      return provider.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return getProviderIconSrc(provider.id);
  };

  return (
    <Link
      href={`/dashboard/providers/${providerId}`}
      className={`group flex min-w-0 items-center justify-between gap-3 px-2 py-3 transition-colors hover:bg-raise focus-visible:bg-raise ${allDisabled ? "opacity-50" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-raise">
          <ProviderIcon
            src={getIconPath()}
            alt={provider.name}
            size={24}
            className="max-h-6 max-w-6 rounded object-contain"
            fallbackText={
              provider.textIcon || provider.id.slice(0, 2).toUpperCase()
            }
            fallbackColor={provider.color}
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{provider.name}</h3>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {allDisabled ? (
              <Badge variant="default" size="sm" dot>
                Disabled
              </Badge>
            ) : (
              <>
                {getStatusDisplay(connected, error, errorCode)}
                {isCompatible && (
                  <Badge variant="default" size="sm" dot={false} pill>
                    {provider.apiType === "responses"
                      ? "Responses"
                      : "Chat"}
                  </Badge>
                )}
                {isAnthropicCompatible && (
                  <Badge variant="default" size="sm" dot={false} pill>
                    Messages
                  </Badge>
                )}
                {errorTime && (
                  <span className="font-mono text-faint">{errorTime}</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {stats.total > 0 && (
          <div
            className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle(!allDisabled ? false : true);
            }}
          >
            <Toggle
              size="sm"
              checked={!allDisabled}
              onChange={() => {}}
              title={allDisabled ? "Enable provider" : "Disable provider"}
              aria-label={allDisabled ? "Enable provider" : "Disable provider"}
            />
          </div>
        )}
      </div>
    </Link>
  );
}

ApiKeyProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};
