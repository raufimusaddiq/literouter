"use client";

import { lazy, Suspense, useState, useEffect } from "react";
import { Button, CardSkeleton, ModelSelectModal, ConfirmModal, CapacityBadges, Select, Toggle } from "@/shared/components";
import PageHeader from "@/shared/components/shell/PageHeader";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { aggregateComboCapabilities } from "open-sse/providers/capabilities.js";

const ComboFormModal = lazy(() => import("./ComboFormModal"));

const CAPACITY_ADAPTER_CAPS = [
  { key: "vision", label: "Vision", icon: "visibility", desc: "Images" },
  { key: "audioInput", label: "Audio", icon: "graphic_eq", desc: "Audio input" },
];
const EMPTY_CAP_ENTRY = { enabled: false, roundRobin: false, models: [] };
const EMPTY_CAPACITY_ADAPTER = {
  vision: { ...EMPTY_CAP_ENTRY },
  pdf: { ...EMPTY_CAP_ENTRY },
  audioInput: { ...EMPTY_CAP_ENTRY },
  videoInput: { ...EMPTY_CAP_ENTRY },
};
function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => e?.model || e).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

function StrategyNote({ title, text }) {
  return (
    <div className="border-l-2 border-line-strong pl-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[12.5px] leading-5 text-muted">{text}</p>
    </div>
  );
}

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const comboByName = Object.fromEntries(combos.map((combo) => [combo.name, combo]));
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [capacityAdapter, setCapacityAdapter] = useState(EMPTY_CAPACITY_ADAPTER);
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState(null);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, settingsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      
      if (combosRes.ok) setCombos((combosData.combos || []).filter(c => !c.kind || c.kind === "llm"));
      if (providersRes.ok) {
        setActiveProviders(providersData.connections || []);
      }
      setComboStrategies(settingsData.comboStrategies || {});
      const rawAdapter = settingsData.capacityAdapter || {};
      const normalized = {};
      for (const cap of CAPACITY_ADAPTER_CAPS) {
        normalized[cap.key] = normalizeCapEntry(rawAdapter[cap.key]);
      }
      setCapacityAdapter(normalized);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetCapacityAdapter = async (next) => {
    setCapacityAdapter(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityAdapter: next }),
      });
    } catch (error) {
      console.log("Error updating capacity adapter:", error);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Combo",
      message: "Delete this combo?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (res.ok) {
            setCombos(combos.filter(c => c.id !== id));
          }
        } catch (error) {
          console.log("Error deleting combo:", error);
        }
      }
    });
  };

  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
      const next = { ...(updated[comboName] || {}), ...patch };
      if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") {
        delete updated[comboName];
      } else {
        updated[comboName] = next;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });

      setComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-6 overflow-x-clip px-1 sm:px-0">
      <PageHeader
        title="Combos"
        description="Bundle models under one client-facing name and choose how requests fall back."
        actions={<Button icon="add" onClick={() => setShowCreateModal(true)}>Create combo</Button>}
      />
      <div className="grid gap-3 border-b border-line pb-6 sm:grid-cols-3">
        <StrategyNote title="Fallback" text="Try models in priority order." />
        <StrategyNote title="Round robin" text="Spread requests across the pool." />
        <StrategyNote title="Fusion" text="Parallel panel plus judge. Highest cost." />
      </div>

      {combos.length === 0 ? (
        <div className="border-y border-line py-12 text-center">
          <span aria-hidden="true" className="material-symbols-outlined mb-3 text-[28px] text-faint">layers</span>
          <p className="mb-1 text-sm font-semibold text-ink">No combos yet</p>
          <p className="mb-4 text-[12.5px] text-muted">Create model combos with fallback support</p>
          <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
            Create Combo
          </Button>
        </div>
      ) : (
        <div className="flex flex-col border-t border-line-strong">
          {combos.map((combo) => (
            <ComboCard
              comboByName={comboByName}
              key={combo.id}
              combo={combo}
              getCaps={getCaps}
              activeProviders={activeProviders}
              copied={copied}
              onCopy={copy}
              onEdit={() => setEditingCombo(combo)}
              onDelete={() => handleDelete(combo.id)}
              strategy={comboStrategies[combo.name] || {}}
              onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
            />
          ))}
        </div>
      )}

      <CapacityAdapterSection
        capacityAdapter={capacityAdapter}
        onChange={handleSetCapacityAdapter}
        activeProviders={activeProviders}
        getCaps={getCaps}
      />

      {showCreateModal && (
        <Suspense fallback={null}>
          <ComboFormModal
            key="create"
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSave={handleCreate}
            activeProviders={activeProviders}
          />
        </Suspense>
      )}

      {editingCombo && (
        <Suspense fallback={null}>
          <ComboFormModal
            key={editingCombo.id}
            isOpen={!!editingCombo}
            combo={editingCombo}
            onClose={() => setEditingCombo(null)}
            onSave={(data) => handleUpdate(editingCombo.id, data)}
            activeProviders={activeProviders}
          />
        </Suspense>
      )}

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}

const STRATEGY_OPTIONS = [
  { value: "fallback", label: "Fallback — try in order" },
  { value: "round-robin", label: "Round Robin — rotate" },
  { value: "fusion", label: "Fusion — panel + judge" },
];

function ComboCard({ combo, comboByName, getCaps, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, onSetStrategy }) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const comboCaps = aggregateComboCapabilities(combo.models, comboByName, getCaps);

  return (
    <div className="border-b border-line py-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <code className="block truncate font-mono text-sm font-semibold text-ink">{combo.name}</code>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            {combo.models.length === 0 ? (
              <span className="text-[12.5px] text-faint">No models</span>
            ) : (
              combo.models.slice(0, 3).map((model, index) => (
                <span key={index} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                  {index > 0 && <span aria-hidden="true" className="text-faint">→</span>}
                  <code className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[12px] tracking-[-0.01em] text-muted">
                    <span className="min-w-0 break-all">{model}</span>
                    <CapacityBadges size={14} colorOverride="text-faint" caps={
                      comboByName[model]
                        ? aggregateComboCapabilities(comboByName[model], comboByName, getCaps)
                        : getCaps?.(model)
                    } />
                  </code>
                </span>
              ))
            )}
            {combo.models.length > 3 && (
              <span className="text-[12px] text-faint">+{combo.models.length - 3} more</span>
            )}
          </div>
          {isFusion && (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-medium text-muted">Judge</span>
              <button
                onClick={() => setShowJudgeSelect(true)}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-line-strong px-1.5 py-0.5 font-mono text-[12px] text-ink transition-colors hover:border-ink hover:bg-raise focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line"
                title="Pick the model that fuses panel answers"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[13px]">gavel</span>
                <span className="truncate">{judge || `Auto — ${combo.models[0] || "first model"}`}</span>
              </button>
              {judge && (
                <button
                  onClick={() => onSetStrategy({ judgeModel: "" })}
                  aria-label="Reset judge to Auto"
                  className="rounded-md p-0.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line"
                  title="Reset judge to Auto"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[13px]">close</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          <div className="w-full sm:w-[200px]">
            <Select
              aria-label="Fallback strategy"
              options={STRATEGY_OPTIONS}
              value={current}
              onChange={(e) => onSetStrategy({ fallbackStrategy: e.target.value })}
              selectClassName="h-8 sm:text-[13px]"
            />
          </div>

          <div className="grid grid-cols-3 gap-1 sm:flex">
            <Button
              variant="ghost"
              size="sm"
              icon={copied === `combo-${combo.id}` ? "check" : "content_copy"}
              onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
              title="Copy combo name"
            >
              Copy
            </Button>
            <Button variant="ghost" size="sm" icon="edit" onClick={onEdit} title="Edit">
              Edit
            </Button>
            <Button variant="danger" size="sm" icon="delete" onClick={onDelete} title="Delete">
              Delete
            </Button>
          </div>
        </div>
      </div>

      {showJudgeSelect && (
        <ModelSelectModal
          isOpen={showJudgeSelect}
          onClose={() => setShowJudgeSelect(false)}
          onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
          activeProviders={activeProviders}
          title="Select Judge Model"
          addedModelValues={judge ? [judge] : []}
          closeOnSelect={true}
        />
      )}
    </div>
  );
}

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line-strong pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">Vision Adapter</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Your model can&apos;t read image/audio? Auto-switches to a model in the pool below.
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px] text-muted">
            <li><span className="font-medium text-ink">Vision</span> — images (png, jpg, webp, …)</li>
            <li><span className="font-medium text-ink">Audio</span> — audio input</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-col border-t border-line">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <CapacityAdapterCap
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        ))}
      </div>
    </div>
  );
}

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p) => onChange({ ...entry, ...p });

  const handleAdd = (model) => {
    if (models.includes(model.value)) return;
    patch({ models: [...models, model.value] });
  };

  const handleRemove = (index) => {
    patch({ models: models.filter((_, i) => i !== index) });
  };

  const handleMove = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  };

  return (
    <div className={`border-b border-line py-4 ${!enabled ? "opacity-50" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          <Toggle
            checked={enabled}
            onChange={(v) => patch({ enabled: v })}
            aria-label={`Enable ${cap.label} adapter`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-faint">{cap.icon}</span>
              <code className="font-mono text-sm font-semibold text-ink">{cap.label}</code>
              <span className="text-[12px] text-faint">— {cap.desc}</span>
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              {models.length === 0 ? (
                <span className="text-[12.5px] text-faint">No models</span>
              ) : (
                models.slice(0, 3).map((model, index) => (
                  <span key={`${model}-${index}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                    {index > 0 && <span aria-hidden="true" className="text-faint">→</span>}
                    <code className="group/chip inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[12px] tracking-[-0.01em] text-muted">
                      <span className="min-w-0 break-all">{model}</span>
                      <CapacityBadges size={14} colorOverride="text-faint" caps={getCaps?.(model)} />
                      <button onClick={() => handleMove(index, -1)} disabled={index === 0} aria-label={`Move ${model} up`} className={`leading-none opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 ${index === 0 ? "text-line-strong" : "text-muted hover:text-ink"}`}>
                        <span aria-hidden="true" className="material-symbols-outlined text-[12px]">arrow_upward</span>
                      </button>
                      <button onClick={() => handleMove(index, 1)} disabled={index === models.length - 1} aria-label={`Move ${model} down`} className={`leading-none opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 ${index === models.length - 1 ? "text-line-strong" : "text-muted hover:text-ink"}`}>
                        <span aria-hidden="true" className="material-symbols-outlined text-[12px]">arrow_downward</span>
                      </button>
                      <button onClick={() => handleRemove(index)} aria-label={`Remove ${model}`} className="leading-none opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 text-muted hover:text-danger">
                        <span aria-hidden="true" className="material-symbols-outlined text-[12px]">close</span>
                      </button>
                    </code>
                  </span>
                ))
              )}
              {models.length > 3 && (
                <span className="text-[12px] text-faint">+{models.length - 3} more</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted cursor-pointer select-none">
            <Toggle
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              disabled={!enabled}
              aria-label={`Round-robin ${cap.label} adapter`}
            />
            <span>Round</span>
          </label>
          <Button
            icon="add"
            variant="ghost"
            size="sm"
            onClick={() => setShowModelSelect(true)}
            disabled={!enabled}
            title={`Add ${cap.label} model`}
          >
            Add Model
          </Button>
        </div>
      </div>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAdd}
          onDeselect={(m) => handleRemove(models.indexOf(m?.value || m))}
          activeProviders={activeProviders}
          title={`Add ${cap.label} Model`}
          addedModelValues={models}
          capFilter={cap.key}
          closeOnSelect={false}
        />
      )}
    </div>
  );
}
