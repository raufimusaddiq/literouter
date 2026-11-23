"use client";

import { useState } from "react";
import { Badge } from "@/shared/components";

function pct(value) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `${Math.round(Math.max(0, Math.min(1, number)) * 100)}%`;
}

function Bar({ label, value, highlight = false }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={`min-w-0 truncate ${highlight ? "font-semibold text-text-main" : "text-text-muted"}`}>{label}</span>
        <span className="shrink-0 font-mono text-text-muted">{pct(value)}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${label}: ${pct(value)}`}>
        <div className={`h-full rounded-full ${highlight ? "bg-primary" : "bg-brand-500/50"}`} style={{ width: pct(value) }} />
      </div>
    </div>
  );
}

function NoUL({ answer }) {
  const probability = typeof answer.noul === "number" ? answer.noul : 0;
  const yes = probability >= 0.5;
  return (
    <div>
      <div className="flex items-center gap-2">
        <Badge variant={yes ? "success" : "default"} icon={yes ? "check" : "close"}>{yes ? "Yes" : "No"}</Badge>
        <span className="text-xs text-text-muted">probability of yes</span>
      </div>
      <div className="mt-3">
        <Bar label="Yes" value={probability} highlight />
      </div>
    </div>
  );
}

function Choice({ answer }) {
  const probabilities = answer.probabilities || {};
  const winner = answer.choice || Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success" icon="check">{winner || "—"}</Badge>
        {typeof answer.confidence === "number" && (
          <span className="text-xs text-text-muted">confidence {pct(answer.confidence)}</span>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {Object.entries(probabilities).map(([name, value]) => (
          <Bar key={name} label={name} value={value} highlight={name === winner} />
        ))}
      </div>
    </div>
  );
}

function Score({ answer }) {
  const probabilities = answer.probabilities || {};
  const entries = Object.entries(probabilities).sort((a, b) => Number(a[0]) - Number(b[0]));
  const top = Math.max(entries.length - 1, 0);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold text-text-main">{typeof answer.score === "number" ? answer.score.toFixed(2) : "—"}</span>
        <span className="text-xs text-text-muted">of {top}</span>
        {typeof answer.confidence === "number" && <span className="text-xs text-text-muted">· confidence {pct(answer.confidence)}</span>}
      </div>
      {Array.isArray(answer.legend) && (
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
          {answer.legend.map((label, index) => (
            <li key={`${label}-${index}`}><span className="font-mono">{index}</span> {label}</li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {entries.map(([name, value]) => (
          <Bar key={name} label={`${name} · ${answer.legend?.[Number(name)] || ""}`.trim()} value={value} />
        ))}
      </div>
    </div>
  );
}

function Box({ answer, assets }) {
  const box = answer.box || {};
  const asset = assets?.find((entry) => entry.placeholder) || null;
  const percent = (value) => `${(typeof value === "number" ? Math.max(0, Math.min(1, value)) : 0) * 100}%`;
  const width = (box.right ?? 0) - (box.left ?? 0);
  const height = (box.bottom ?? 0) - (box.top ?? 0);
  return (
    <div>
      {asset?.data_base64 ? (
        <div className="relative inline-block max-w-full overflow-hidden rounded-lg ring-1 ring-border-subtle">
          <img src={`data:image/${asset.format};base64,${asset.data_base64}`} alt="Image used for the box question" className="block max-h-80 w-auto max-w-full" />
          <div
            aria-hidden="true"
            className="absolute rounded border-2 border-red-500 bg-red-500/20"
            style={{
              top: percent(box.top),
              left: percent(box.left),
              width: percent(width),
              height: percent(height),
            }}
          />
        </div>
      ) : (
        <p className="text-xs text-text-muted">No image preview available for this box answer.</p>
      )}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-text-muted sm:grid-cols-4">
        {["top", "bottom", "left", "right"].map((side) => (
          <div key={side}>
            <dt className="inline">{side}: </dt>
            <dd className="inline text-text-main">{typeof box[side] === "number" ? box[side].toFixed(3) : "—"}</dd>
          </div>
        ))}
      </dl>
      {typeof answer.confidence === "number" && <p className="mt-1 text-xs text-text-muted">confidence {pct(answer.confidence)}</p>}
    </div>
  );
}

export default function AnswerView({ result, form }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!result) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border px-6 text-center text-sm text-text-muted">
        Build a request and run it to see typed answers here.
      </div>
    );
  }

  const payload = result.payload;
  const answers = payload?.answers || {};
  const questions = form?.questionsById ? form.questionsById : {};
  const cards = Object.entries(answers).map(([key, answer]) => {
    const spec = questions[key] || {};
    const type = answer?.type || spec.type || "noul";
    return (
      <div key={key} className="min-w-0 rounded-xl bg-surface-2 p-3 ring-1 ring-border-subtle sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-sm font-semibold text-text-main">{key}</span>
          <Badge size="sm">{type}</Badge>
        </div>
        {spec.instructions && <p className="mb-3 text-xs text-text-muted">{spec.instructions}</p>}
        {type === "choice" ? <Choice answer={answer} />
          : type === "score" ? <Score answer={answer} />
            : type === "box" ? <Box answer={answer} assets={result.assets} />
              : <NoUL answer={answer} />}
      </div>
    );
  });

  return (
    <div className="min-w-0">
      {!result.ok ? (
        <div role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600 ring-1 ring-red-500/20 dark:text-red-400">
          <p className="font-semibold">{result.status ? `HTTP ${result.status}` : "Network error"}</p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">{result.errorText || "Request failed."}</pre>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            {payload?.model && <Badge size="sm" variant="primary">{payload.model}</Badge>}
            {payload?.usage && (
              <span className="font-mono">
                {payload.usage.input_tokens ?? 0} in · {payload.usage.output_tokens ?? 0} out tokens
              </span>
            )}
          </div>
          {cards.length ? <div className="flex flex-col gap-3">{cards}</div> : <p className="text-sm text-text-muted">The response had no answers.</p>}
        </>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowRaw((value) => !value)}
          aria-expanded={showRaw}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text-main focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{showRaw ? "expand_less" : "expand_more"}</span>
          Raw JSON
        </button>
        {showRaw && (
          <pre className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-sidebar p-3 font-mono text-xs leading-5 text-text-main">{result.text}</pre>
        )}
      </div>
    </div>
  );
}
