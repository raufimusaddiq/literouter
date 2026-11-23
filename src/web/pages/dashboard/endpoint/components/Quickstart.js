"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { buildSnippets } from "../quickstartSnippets";

const STORAGE_KEY = "endpoint-quickstart-open";

export default function Quickstart({ baseUrl, copied, onCopy }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("curl");
  const snippets = useMemo(() => buildSnippets(baseUrl), [baseUrl]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      try { setOpen(window.localStorage.getItem(STORAGE_KEY) === "1"); } catch {}
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch {}
  };

  const active = snippets.find((s) => s.id === tab) || snippets[0];
  const copyId = `quickstart_${active.id}`;

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="endpoint-quickstart"
        className="flex min-h-11 items-center gap-1 text-sm font-medium text-text-main hover:text-primary"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{open ? "expand_more" : "chevron_right"}</span>
        Quickstart
      </button>
      {open && (
        <div id="endpoint-quickstart" className="mt-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Quickstart language" className="flex gap-1">
              {snippets.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === s.id}
                  onClick={() => setTab(s.id)}
                  className={`min-h-11 rounded-md px-3 text-sm font-medium transition-colors ${tab === s.id ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-main"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onCopy(active.code, copyId)}
              className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              aria-label={`Copy ${active.label} snippet`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{copied === copyId ? "check" : "content_copy"}</span>
              {copied === copyId ? "Copied" : "Copy"}
            </button>
          </div>
          <pre role="tabpanel" tabIndex={0} className="mt-1 max-w-full overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-main">
            <code>{active.code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

Quickstart.propTypes = {
  baseUrl: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
};
