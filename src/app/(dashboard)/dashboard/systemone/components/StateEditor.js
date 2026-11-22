"use client";

import { SegmentedControl } from "@/shared/components";
import { makeId } from "../lib/requestBuilder";

const MODES = [
  { value: "text", label: "Text" },
  { value: "fields", label: "Fields" },
  { value: "json", label: "JSON" },
];

export default function StateEditor({ form, onChange, error }) {
  const patch = (values) => onChange({ ...form, ...values });

  const updateField = (id, values) => {
    patch({ stateFields: form.stateFields.map((row) => (row.id === id ? { ...row, ...values } : row)) });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-main" id="systemone-state-label">State</span>
        <div role="group" aria-label="State input mode">
          <SegmentedControl options={MODES} value={form.stateMode} size="sm" onChange={(stateMode) => patch({ stateMode })} />
        </div>
      </div>

      {form.stateMode === "text" && (
        <div className="mt-2">
          <label htmlFor="systemone-state-text" className="sr-only">State text</label>
          <textarea
            id="systemone-state-text"
            value={form.stateText}
            onChange={(event) => patch({ stateText: event.target.value })}
            spellCheck="false"
            placeholder="Paste the conversation, email, or document to evaluate."
            className="min-h-[140px] w-full resize-y rounded-xl bg-surface-2 p-3 text-sm leading-6 text-text-main ring-1 ring-transparent placeholder:text-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <p className="mt-1 text-xs text-text-muted">Sent as a plain string.</p>
        </div>
      )}

      {form.stateMode === "fields" && (
        <div className="mt-2 flex flex-col gap-2">
          {form.stateFields.map((row, index) => (
            <div key={row.id} className="flex items-start gap-2">
              <label htmlFor={`state-key-${row.id}`} className="sr-only">Field {index + 1} name</label>
              <input
                id={`state-key-${row.id}`}
                value={row.key}
                onChange={(event) => updateField(row.id, { key: event.target.value })}
                placeholder="name"
                className="w-2/5 min-w-0 rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-xs text-text-main ring-1 ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <label htmlFor={`state-value-${row.id}`} className="sr-only">Field {index + 1} value</label>
              <input
                id={`state-value-${row.id}`}
                value={row.value}
                onChange={(event) => updateField(row.id, { value: event.target.value })}
                placeholder="value"
                className="min-w-0 flex-1 rounded-lg bg-surface-2 px-2.5 py-2 text-sm text-text-main ring-1 ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <button
                type="button"
                aria-label={`Remove field ${index + 1}`}
                onClick={() => patch({ stateFields: form.stateFields.filter((entry) => entry.id !== row.id) })}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => patch({ stateFields: [...form.stateFields, { id: makeId("f"), key: "", value: "" }] })}
            className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-lg px-3 text-xs font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add</span>
            Add field
          </button>
          <p className="text-xs text-text-muted">Sent as a key/value object.</p>
        </div>
      )}

      {form.stateMode === "json" && (
        <div className="mt-2">
          <label htmlFor="systemone-state-json" className="sr-only">State JSON</label>
          <textarea
            id="systemone-state-json"
            value={form.stateJson}
            onChange={(event) => patch({ stateJson: event.target.value })}
            spellCheck="false"
            className={`min-h-[140px] w-full resize-y rounded-xl bg-surface-2 p-3 font-mono text-xs leading-5 text-text-main ring-1 focus:outline-none focus:ring-2 ${error ? "ring-red-500/50 focus:ring-red-500/40" : "ring-transparent focus:ring-brand-500/30"}`}
          />
          {error ? (
            <p role="alert" className="mt-1 text-xs text-red-500">{error}</p>
          ) : (
            <p className="mt-1 text-xs text-text-muted">Arrays and nested objects are allowed.</p>
          )}
        </div>
      )}
    </div>
  );
}
