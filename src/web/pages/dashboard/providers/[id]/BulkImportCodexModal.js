"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Badge, Button, Card, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const PLACEHOLDER = `[
  {
    "accessToken": "eyJhbGc...",
    "refreshToken": "rt_...",
    "idToken": "eyJhbGc...",
    "email": "user@example.com"
  }
]`;

function normalizeToArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    return [parsed];
  }
  return null;
}

export default function BulkImportCodexModal({ isOpen, onClose, onSuccess }) {
  const [jsonText, setJsonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);

  const handleClose = () => {
    if (submitting) return;
    setJsonText("");
    setParseError("");
    setResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);

    const trimmed = jsonText.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setParseError(`${translate("Invalid JSON")}: ${err.message}`);
      return;
    }

    const accounts = normalizeToArray(parsed);
    if (!accounts || accounts.length === 0) {
      setParseError(translate("No accounts found in input"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/oauth/codex/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data?.error || `Request failed: ${res.status}`);
        return;
      }
      setResult(data);
      if (data.success > 0 && typeof onSuccess === "function") {
        onSuccess();
      }
    } catch (err) {
      setParseError(err.message || translate("Request failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];

  return (
    <Modal isOpen={isOpen} title={translate("Bulk Add Codex Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted">
          {translate(
            "Paste an array of codex account JSON objects. Each must include accessToken (and ideally refreshToken, idToken)."
          )}
        </p>

        <textarea
          className="min-h-[240px] w-full resize-y rounded-md border border-line-strong bg-bg p-2.5 font-mono text-sm text-ink placeholder:text-faint focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line"
          placeholder={PLACEHOLDER}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          disabled={submitting}
        />

        {parseError && (
          <p className="break-words text-xs text-danger">{parseError}</p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div>
              <Badge variant={result.failed > 0 ? "warning" : "success"} size="md" dot>
                {result.success} {translate("added")}
                {result.failed > 0 ? `, ${result.failed} ${translate("failed")}` : ""}
              </Badge>
            </div>
            {failedItems.length > 0 && (
              <Card variant="raised" padding="xs" className="max-h-40 overflow-y-auto">
                <ul className="space-y-1 font-mono text-xs">
                  {failedItems.map((item) => (
                    <li key={item.index} className="text-danger">
                      [{item.index}] {item.error}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={submitting || !jsonText.trim()}
          >
            {submitting ? translate("Importing...") : translate("Import All")}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkImportCodexModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
