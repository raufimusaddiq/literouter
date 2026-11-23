"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import PricingModal from "@/shared/components/PricingModal";

export default function PricingSettingsPage() {
  const [showModal, setShowModal] = useState(false);
  const [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setCurrentPricing(data);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePricingUpdated = () => {
    loadPricing();
  };

  const getModelCount = () => {
    if (!currentPricing) return 0;
    let count = 0;
    for (const provider in currentPricing) {
      count += Object.keys(currentPricing[provider]).length;
    }
    return count;
  };

  const getProviders = () => {
    if (!currentPricing) return [];
    return Object.keys(currentPricing).sort();
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.025em] text-ink sm:text-[30px] sm:leading-[36px]">Pricing Settings</h1>
          <p className="mt-1 text-sm text-muted">
            Configure pricing rates for cost tracking and calculations
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowModal(true)}>
          Edit Pricing
        </Button>
      </div>

      <dl className="m-0 grid grid-cols-1 border-t border-line-strong sm:grid-cols-3">
        <div className="border-b border-line py-4 sm:border-b-0 sm:pr-6">
          <dt className="text-[12.5px] text-muted">Total Models</dt>
          <dd className="metric-value m-0 mt-1 font-mono text-2xl font-semibold text-ink">
            {loading ? "..." : getModelCount()}
          </dd>
        </div>
        <div className="border-b border-line py-4 sm:border-b-0 sm:px-6">
          <dt className="text-[12.5px] text-muted">Providers</dt>
          <dd className="metric-value m-0 mt-1 font-mono text-2xl font-semibold text-ink">
            {loading ? "..." : getProviders().length}
          </dd>
        </div>
        <div className="py-4 sm:pl-6">
          <dt className="text-[12.5px] text-muted">Status</dt>
          <dd className="m-0 mt-1 flex items-center gap-2 text-2xl font-semibold text-ok">
            {loading ? "..." : (
              <>
                <span aria-hidden="true" className="size-2 rounded-full bg-ok" />
                Active
              </>
            )}
          </dd>
        </div>
      </dl>

      <Card title="How Pricing Works">
        <div className="space-y-3 text-sm text-muted">
          <p>
            <strong className="text-ink">Cost Calculation:</strong> Costs are calculated based on token usage and pricing rates.
            Each request&apos;s cost is determined by: (input_tokens × input_rate) + (output_tokens × output_rate) + (cached_tokens × cached_rate)
          </p>
          <p>
            <strong className="text-ink">Pricing Format:</strong> All rates are in <strong className="text-ink">dollars per million tokens</strong> ($/1M tokens).
            Example: An input rate of 2.50 means $2.50 per 1,000,000 input tokens.
          </p>
          <p>
            <strong className="text-ink">Token Types:</strong>
          </p>
          <ul className="ml-4 list-inside list-disc space-y-1">
            <li><strong className="text-ink">Input:</strong> Standard prompt tokens</li>
            <li><strong className="text-ink">Output:</strong> Completion/response tokens</li>
            <li><strong className="text-ink">Cached:</strong> Cached input tokens (typically 50% of input rate)</li>
            <li><strong className="text-ink">Reasoning:</strong> Special reasoning/thinking tokens (fallback to output rate)</li>
            <li><strong className="text-ink">Cache Creation:</strong> Tokens used to create cache entries (fallback to input rate)</li>
          </ul>
          <p>
            <strong className="text-ink">Custom Pricing:</strong> You can override default pricing for specific models.
            Reset to defaults anytime to restore standard rates.
          </p>
        </div>
      </Card>

      <Card
        title="Current Pricing Overview"
        action={
          <Button variant="ghost" size="sm" onClick={() => setShowModal(true)}>
            View Full Details
          </Button>
        }
      >
        {loading ? (
          <div className="py-4 text-center text-sm text-muted">Loading pricing data...</div>
        ) : currentPricing ? (
          <div className="flex flex-col">
            {Object.keys(currentPricing).slice(0, 5).map(provider => (
              <div key={provider} className="flex items-center justify-between gap-4 border-b border-line py-3 text-sm">
                <span className="font-mono font-semibold text-ink">{provider.toUpperCase()}</span>
                <span className="text-muted">
                  {Object.keys(currentPricing[provider]).length} models
                </span>
              </div>
            ))}
            {Object.keys(currentPricing).length > 5 && (
              <div className="pt-3 text-sm text-muted">
                + {Object.keys(currentPricing).length - 5} more providers
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted">No pricing data available</div>
        )}
      </Card>

      {showModal && (
        <PricingModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSave={handlePricingUpdated}
        />
      )}
    </div>
  );
}
