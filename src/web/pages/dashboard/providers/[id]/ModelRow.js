import { formatTime } from "@/shared/utils/dateTime";
import PropTypes from "prop-types";
import { CapacityBadges } from "@/shared/components";

function regionOptInUrl(error) {
  const str = typeof error === "string" ? error : JSON.stringify(error);
  if (!/RegionError|hosted in China|regionNotAllowed/i.test(str)) return null;
  const linkMatch = str.match(/https:\/\/opencode\.ai\/workspace\/[^\s"')]+/);
  const wrkMatch = str.match(/wrk_[0-9A-Za-z]+/);
  if (linkMatch) return linkMatch[0].endsWith("/go") ? linkMatch[0] : `${linkMatch[0]}/go`;
  if (wrkMatch) return `https://opencode.ai/workspace/${wrkMatch[0]}/go`;
  return "https://opencode.ai";
}

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testResult, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, caps, thinkingSuffix }) {
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
  const testStatus = testResult?.status;
  const testError = testStatus === "error" ? (testResult.error || "Model not reachable") : null;
  const testedAt = typeof testResult?.at === "number"
    ? formatTime(testResult.at)
    : null;
  const regionOptIn = testError ? regionOptInUrl(testError) : null;
  const statusIconTone = testStatus === "ok"
    ? "text-ok"
    : testStatus === "error"
      ? "text-danger"
      : "text-faint";

  return (
    <div className="group min-w-0 max-w-full border-b border-line px-2 py-2.5 transition-colors hover:bg-raise/60">
      <div className="flex min-w-0 items-start gap-2.5 sm:items-center">
        <span aria-hidden="true" className={`material-symbols-outlined shrink-0 text-[16px] ${statusIconTone}`}>
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <code className="max-w-full truncate font-mono text-[12.5px] tracking-[-0.01em] text-ink">
            {displayModel}
          </code>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
            {model.name && <span className="truncate text-[11px] text-muted">{model.name}</span>}
            <CapacityBadges focusable caps={caps} colorOverride="text-faint" size={13} />
          </span>
          {!!testedAt && (
            <span className={`inline-flex items-center gap-1 font-mono text-[11px] tabular-nums ${testStatus === "ok" ? "text-ok" : "text-danger"}`}>
              <span aria-hidden="true" className={`size-1.5 rounded-full ${testStatus === "ok" ? "bg-ok" : "bg-danger"}`} />
              {testStatus === "ok" ? "passed" : "failed"} {testedAt}
            </span>
          )}
          {!!testError && (
            <span className="min-w-0">
              <span className="block break-words text-xs text-danger">{testError}</span>
              {!!regionOptIn && (
                <a
                  href={regionOptIn}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
                >
                  <span>Allow China-hosted models</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-[13px]">open_in_new</span>
                </a>
              )}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onTest && (
            <div className="group/btn relative shrink-0">
              <button
                type="button"
                onClick={onTest}
                disabled={isTesting}
                aria-label={`${isTesting ? "Testing model" : "Test model"} ${displayModel}`}
                className={`rounded-md p-1 text-muted transition-opacity hover:bg-surface-2 hover:text-ink ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100"}`}
              >
                <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${isTesting ? "animate-spin" : ""}`}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted opacity-0 transition-opacity group-hover/btn:opacity-100">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
          <div className="group/btn relative shrink-0">
            <button
              type="button"
              onClick={() => onCopy(displayModel, `model-${model.id}`)}
              aria-label={`Copy model ID ${displayModel}`}
              className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                {copied === `model-${model.id}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted opacity-0 transition-opacity group-hover/btn:opacity-100">
              {copied === `model-${model.id}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {isCustom ? (
            <button
              type="button"
              onClick={onDeleteAlias}
              aria-label={`Remove custom model ${displayModel}`}
              className="rounded-md p-1 text-muted opacity-100 transition-opacity hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100"
              title="Remove custom model"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
            </button>
          ) : onDisable ? (
            <button
              type="button"
              onClick={onDisable}
              aria-label={`Disable model ${displayModel}`}
              className="rounded-md p-1 text-muted opacity-100 transition-opacity hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100"
              title="Disable this model"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testResult: PropTypes.shape({
    status: PropTypes.oneOf(["ok", "error"]).isRequired,
    error: PropTypes.string,
    at: PropTypes.number,
  }),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
