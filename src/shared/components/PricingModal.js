"use client";

import { useState, useEffect } from "react";
import { getDefaultPricing } from "open-sse/providers/pricing.js";
import Modal from "./Modal";
import Button from "./Button";
import Card from "./Card";

export default function PricingModal({ isOpen, onClose, onSave }) {
  const [pricingData, setPricingData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setPricingData(data);
      } else {
        const defaults = getDefaultPricing();
        setPricingData(defaults);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
      const defaults = getDefaultPricing();
      setPricingData(defaults);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadPricing();
    }
  }, [isOpen]);

  const handlePricingChange = (provider, model, field, value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) return;

    setPricingData(prev => {
      const newData = { ...prev };
      if (!newData[provider]) newData[provider] = {};
      if (!newData[provider][model]) newData[provider][model] = {};
      newData[provider][model][field] = numValue;
      return newData;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricingData)
      });

      if (response.ok) {
        onSave?.();
        onClose();
      } else {
        const error = await response.json();
        alert(`Failed to save pricing: ${error.error}`);
      }
    } catch (error) {
      console.error("Failed to save pricing:", error);
      alert("Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset all pricing to defaults? This cannot be undone.")) return;

    try {
      const response = await fetch("/api/pricing", { method: "DELETE" });
      if (response.ok) {
        const defaults = getDefaultPricing();
        setPricingData(defaults);
      }
    } catch (error) {
      console.error("Failed to reset pricing:", error);
      alert("Failed to reset pricing");
    }
  };

  const handleClose = () => {
    if (!saving) onClose();
  };

  if (!isOpen) return null;

  const allProviders = Object.keys(pricingData).sort();
  const pricingFields = ["input", "output", "cached", "reasoning", "cache_creation"];

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      closeOnOverlay={!saving}
      title="Pricing Configuration"
      size="xxl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            variant="danger"
            onClick={handleReset}
            disabled={saving}
            className="whitespace-nowrap"
          >
            Reset to Defaults
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              loading={saving}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-sm text-muted">Loading pricing data...</div>
      ) : (
        <div className="space-y-6">
          <Card variant="raised" padding="xs" className="text-sm">
            <p className="mb-1 font-medium text-ink">Pricing Rates Format</p>
            <p className="text-xs text-muted">
              All rates are in <strong className="text-ink">dollars per million tokens</strong> ($/1M tokens).
              Example: Input rate of 2.50 means $2.50 per 1,000,000 input tokens.
            </p>
          </Card>

          {allProviders.map(provider => {
            const models = Object.keys(pricingData[provider]).sort();
            return (
              <div key={provider} className="border-t border-line-strong pt-4">
                <h3 className="mb-3 font-mono text-sm font-semibold text-ink">
                  {provider}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-line-strong text-xs font-medium text-muted">
                      <tr>
                        <th className="px-3 py-2 text-left">Model</th>
                        <th className="px-3 py-2 text-right">Input</th>
                        <th className="px-3 py-2 text-right">Output</th>
                        <th className="px-3 py-2 text-right">Cached</th>
                        <th className="px-3 py-2 text-right">Reasoning</th>
                        <th className="px-3 py-2 text-right">Cache creation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {models.map(model => (
                        <tr key={model} className="transition-colors hover:bg-bg/60">
                          <td className="px-3 py-2 font-mono text-xs text-ink">{model}</td>
                          {pricingFields.map(field => (
                            <td key={field} className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={pricingData[provider][model][field] || 0}
                                onChange={(e) => handlePricingChange(provider, model, field, e.target.value)}
                                className="w-20 rounded-md border border-line-strong bg-bg px-2 py-1 text-right font-mono text-xs tabular-nums text-ink focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {allProviders.length === 0 && (
            <div className="py-8 text-center text-sm text-muted">
              No pricing data available
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
