"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }) {
  const iconTone = testStatus === "ok"
    ? "text-ok"
    : testStatus === "error"
      ? "text-danger"
      : "text-faint";

  return (
    <div className="group flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-raise/60">
      <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${iconTone}`}>
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{modelId}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <code className="truncate font-mono text-xs text-muted">{fullModel}</code>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onTest && (
          <div className="group/btn relative">
            <button
              type="button"
              onClick={onTest}
              aria-label={`Test model ${modelId}`}
              disabled={isTesting}
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
        <div className="group/btn relative">
          <button
            type="button"
            onClick={() => onCopy(fullModel, `model-${modelId}`)}
            aria-label={`Copy model ID ${fullModel}`}
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
              {copied === `model-${modelId}` ? "check" : "content_copy"}
            </span>
          </button>
          <span className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted opacity-0 transition-opacity group-hover/btn:opacity-100">
            {copied === `model-${modelId}` ? "Copied!" : "Copy"}
          </span>
        </div>
        <button
          type="button"
          onClick={onDeleteAlias}
          aria-label={`Remove model ${modelId}`}
          className="rounded-md p-1 text-danger opacity-100 transition-opacity hover:bg-danger/10 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100"
          title="Remove model"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">delete</span>
        </button>
      </div>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models?refresh=1`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="new-compatible-model-input" className="mb-1 block text-xs font-medium text-muted">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="h-9 w-full rounded-md border border-line-strong bg-raise px-3 font-mono text-sm text-ink placeholder:text-faint focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line"
          />
        </div>
        <Button size="md" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding} className="whitespace-nowrap">
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="md" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing} className="whitespace-nowrap">
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {allModels.map(({ id, alias, source }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
              testStatus={modelTestResults[id]}
              isTesting={testingModelId === id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
