"use client";

import { useState, useRef } from "react";
import { Badge, Button, Card, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const PLACEHOLDER = `[
  {
    "access_token": "eyJ0eXAiOiJhdCtqd3Qi...",
    "refresh_token": "LZhriF9bf88pPykpXCuZ9...",
    "id_token": "eyJ0eXAiOiJKV1QiLCJhbGci...",
    "email": "account1@example.com"
  },
  {
    "access_token": "eyJ0eXAiOiJhdCtqd3Qi...",
    "refresh_token": "LZhriF9bf88pPykpXCuZ9...",
    "id_token": "eyJ0eXAiOiJKV1QiLCJhbGci...",
    "email": "account2@example.com"
  }
]`;

function parseAccountsInput(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (initialErr) {
    try {
      let fixed = trimmed;
      if (!fixed.startsWith("[")) {
        fixed = fixed.replace(/\}\s*,\s*\{/g, "},{").replace(/\}\s*\{/g, "},{");
        if (fixed.endsWith(",")) fixed = fixed.slice(0, -1);
        fixed = `[${fixed}]`;
      }
      parsed = JSON.parse(fixed);
    } catch {
      throw initialErr;
    }
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    return [parsed];
  }

  throw new Error("Input must be a JSON object or array of objects");
}

export default function BulkImportGrokCliModal({ isOpen, onClose, onSuccess }) {
  const [jsonText, setJsonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileCountInfo, setFileCountInfo] = useState(null);
  const fileInputRef = useRef(null);

  const handleClose = () => {
    if (submitting) return;
    setJsonText("");
    setParseError("");
    setResult(null);
    setFileCountInfo(null);
    setIsDragging(false);
    onClose();
  };

  const processFiles = async (files) => {
    if (!files || files.length === 0) return;
    setParseError("");
    const jsonFiles = Array.from(files).filter(
      (file) => file.name.endsWith(".json") || file.type === "application/json" || file.type === ""
    );

    if (jsonFiles.length === 0) {
      setParseError(translate("Please select valid .json files"));
      return;
    }

    try {
      const allAccounts = [];
      for (const file of jsonFiles) {
        const text = await file.text();
        const accountsFromFile = parseAccountsInput(text);
        if (Array.isArray(accountsFromFile)) {
          allAccounts.push(...accountsFromFile);
        } else if (accountsFromFile) {
          allAccounts.push(accountsFromFile);
        }
      }

      if (allAccounts.length === 0) {
        setParseError(translate("No accounts found in selected files"));
        return;
      }

      setJsonText(JSON.stringify(allAccounts, null, 2));
      setFileCountInfo({
        filesCount: jsonFiles.length,
        accountsCount: allAccounts.length,
      });
    } catch (err) {
      setParseError(`${translate("Error reading files")}: ${err.message}`);
    }
  };

  const handleFileInputChange = (e) => {
    processFiles(e.target.files);
    if (e.target) e.target.value = "";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);

    let accounts;
    try {
      accounts = parseAccountsInput(jsonText);
    } catch (err) {
      setParseError(`${translate("Invalid JSON")}: ${err.message}`);
      return;
    }

    if (!accounts || accounts.length === 0) {
      setParseError(translate("No accounts found in input"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/oauth/grok-cli/bulk-import", {
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
    <Modal isOpen={isOpen} title={translate("Bulk Add Grok CLI Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {translate("Upload multiple .json files or paste JSON array / object.")}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon="upload_file"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
            className="whitespace-nowrap"
          >
            {translate("Upload JSON Files")}
          </Button>
        </div>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-md border transition-colors ${
            isDragging
              ? "border-mark-line bg-bg ring-2 ring-mark-line/30"
              : "border-line-strong bg-bg"
          }`}
        >
          <textarea
            className="min-h-[240px] w-full resize-y rounded-md bg-transparent p-2.5 font-mono text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-mark-line"
            placeholder={PLACEHOLDER}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setFileCountInfo(null);
            }}
            disabled={submitting}
          />

          {isDragging && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-md bg-raise/95">
              <span aria-hidden="true" className="material-symbols-outlined mb-1 text-3xl text-ink">upload_file</span>
              <span className="text-sm font-medium text-ink">
                {translate("Drop .json files here")}
              </span>
            </div>
          )}
        </div>

        {fileCountInfo && (
          <div className="flex items-center gap-2 rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-xs font-medium text-ok">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-ok" />
            <span>
              {translate("Loaded")} {fileCountInfo.accountsCount} {translate("account(s) from")}{" "}
              {fileCountInfo.filesCount} {translate("file(s)")}
            </span>
          </div>
        )}

        {parseError && (
          <p className="break-words text-xs text-danger">{parseError}</p>
        )}

        {result && result.failed > 0 && (
          <div className="flex flex-col gap-2">
            <div>
              <Badge variant="warning" size="md" dot>
                {result.failed} {translate("failed")}
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
