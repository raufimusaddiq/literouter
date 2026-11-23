"use client";

import { useState } from "react";
import { useRouter, Link } from "@/web/router";
import { Card, Button, Input, Select, Toggle } from "@/shared/components";
import PageHeader from "@/shared/components/shell/PageHeader";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { AI_PROVIDERS, AUTH_METHODS } from "@/shared/constants/config";
import { getFormAuthMethods } from "@/shared/constants/providers";

const providerOptions = Object.values(AI_PROVIDERS).map((p) => ({
  value: p.id,
  label: p.name,
}));

export default function NewProviderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    provider: "",
    authMethod: AUTH_METHODS.apikey.id,
    apiKey: "",
    displayName: "",
    isActive: true,
  });
  const [errors, setErrors] = useState({});

  const handleChange = (field, value) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "provider") next.authMethod = getFormAuthMethods(value)[0].id;
      return next;
    });
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const authMethods = getFormAuthMethods(formData.provider);
  const credentialLabel = formData.authMethod === AUTH_METHODS.cookie.id ? "Cookie value" : "API Key";

  const validate = () => {
    const newErrors = {};
    if (!formData.provider) newErrors.provider = "Please select a provider";
    if (!formData.apiKey) {
      newErrors.apiKey = `${credentialLabel} is required`;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const response = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        router.push("/dashboard/providers");
      } else {
        const data = await response.json();
        setErrors({ submit: data.error || "Failed to create provider" });
      }
    } catch (error) {
      setErrors({ submit: "An error occurred. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const selectedProvider = AI_PROVIDERS[formData.provider];

  return (
    <div className="mx-auto flex max-w-2xl min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageHeader
          title="Add provider"
          description="Store credentials once; LiteRouter handles routing and fallback."
          breadcrumbs={[
            { label: "Providers", href: "/dashboard/providers" },
            { label: "Add provider" },
          ]}
        />
        <Link
          href="/dashboard/providers"
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back to Providers
        </Link>
      </div>

      <Card variant="raised">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Select
            label="Provider"
            options={providerOptions}
            value={formData.provider}
            onChange={(e) => handleChange("provider", e.target.value)}
            placeholder="Select a provider"
            error={errors.provider}
            required
          />

          {selectedProvider && (
            <div className="flex items-center gap-3 rounded-md border border-line bg-bg px-3.5 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-raise">
                <ProviderIcon
                  src={getProviderIconSrc(selectedProvider.id)}
                  alt={selectedProvider.name}
                  size={24}
                  className="max-h-6 max-w-6 rounded object-contain"
                  fallbackText={selectedProvider.textIcon || selectedProvider.id.slice(0, 2).toUpperCase()}
                  fallbackColor={selectedProvider.color}
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{selectedProvider.name}</p>
                <p className="text-xs text-muted">
                  Selected provider
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span id="auth-method-label" className="text-[13px] font-medium text-ink">
              Authentication Method <span className="text-danger">*</span>
            </span>
            <div role="radiogroup" aria-labelledby="auth-method-label" className="flex gap-2.5">
              {authMethods.map((method) => {
                const selected = formData.authMethod === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleChange("authMethod", method.id)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-medium transition-colors ${
                      selected
                        ? "border-ink bg-ink text-bg"
                        : "border-line-strong bg-bg text-muted hover:border-ink/40 hover:text-ink"
                    }`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                      {method.icon}
                    </span>
                    <span>{method.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Input
            label={credentialLabel}
            type="password"
            placeholder={`Enter your ${credentialLabel.toLowerCase()}`}
            value={formData.apiKey}
            onChange={(e) => handleChange("apiKey", e.target.value)}
            error={errors.apiKey}
            hint="Your credential will be encrypted and stored securely."
            required
          />

          <Input
            label="Display Name"
            placeholder="e.g., Production API, Dev Environment"
            value={formData.displayName}
            onChange={(e) => handleChange("displayName", e.target.value)}
            hint="Optional. A friendly name to identify this configuration."
          />

          <Toggle
            checked={formData.isActive}
            onChange={(checked) => handleChange("isActive", checked)}
            label="Active"
            description="Enable this provider for use in your applications"
          />

          {errors.submit && (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
              {errors.submit}
            </div>
          )}

          <div className="flex gap-3 border-t border-line pt-4">
            <Link href="/dashboard/providers" className="flex-1">
              <Button type="button" variant="ghost" fullWidth>
                Cancel
              </Button>
            </Link>
            <Button type="submit" loading={loading} fullWidth className="flex-1">
              Create Provider
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
