"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Card, Input, Modal, Toggle } from "@/shared/components";
import { CAPACITY_META } from "@/shared/constants/models";

const defaultCaps = () => Object.fromEntries(Object.keys(CAPACITY_META).map((key) => [key, false]));

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }) {
  const [modelId, setModelId] = useState("");
  const [caps, setCaps] = useState(defaultCaps);
  const [testStatus, setTestStatus] = useState(null);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) { setModelId(""); setCaps(defaultCaps()); setTestStatus(null); setTestError(""); }
  }, [isOpen]);

  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      await onSave(cleanId, caps);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Model">
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex items-end gap-2">
            <Input
              label="Model ID"
              type="text"
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="flex-1"
              inputClassName="font-mono"
              autoFocus
            />
            <Button
              variant="secondary"
              size="lg"
              icon="science"
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
              className="whitespace-nowrap"
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Sent to provider as: <code className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-ink">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </div>

        <Card variant="raised" padding="sm">
          <p className="mb-3 text-[13px] font-medium text-ink">Capabilities</p>
          <div className="flex flex-wrap gap-4">
            {Object.entries(CAPACITY_META).map(([key, meta]) => (
              <Toggle
                key={key}
                checked={!!caps[key]}
                onChange={(v) => setCaps((prev) => ({ ...prev, [key]: v }))}
                label={meta.label}
                description={meta.desc}
                size="sm"
              />
            ))}
          </div>
        </Card>

        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-ok">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-danger">
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger" />
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
