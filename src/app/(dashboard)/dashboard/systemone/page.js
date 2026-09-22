"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { APIKEY_PROVIDERS, supportsServiceKind } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { Badge, Button, Card, Select, PageIntro } from "@/shared/components";

const SAMPLE = {
  state: { message: "My card was charged twice." },
  questions: {
    refund_requested: {
      type: "noul",
      instructions: "Does the customer request a refund?",
    },
  },
};

function getSystemOneProviders() {
  return Object.values(APIKEY_PROVIDERS)
    .filter((provider) => supportsServiceKind(provider, "systemone"))
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

export default function SystemOnePage() {
  const providers = getSystemOneProviders();
  const [providerId, setProviderId] = useState(providers[0]?.id || "");
  const provider = providers.find((entry) => entry.id === providerId) || providers[0];
  const models = getModelsByProviderId(provider?.id || "");
  const [model, setModel] = useState(providers[0] ? getModelsByProviderId(providers[0].id)[0]?.id || "" : "");
  const selectedModel = models.some((entry) => entry.id === model) ? model : models[0]?.id || "";
  const [requestText, setRequestText] = useState(() => JSON.stringify(SAMPLE, null, 2));
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [connections, setConnections] = useState([]);
  const [clientApiKey, setClientApiKey] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/providers"), fetch("/api/keys")])
      .then(async ([providersResponse, keysResponse]) => {
        const providersData = await providersResponse.json();
        const keysData = await keysResponse.json();
        setConnections(providersData.connections || []);
        setClientApiKey(keysData.keys?.find((key) => key.isActive !== false)?.key || "");
      })
      .catch(() => {
        setConnections([]);
        setClientApiKey("");
      });
  }, []);

  const connectionCount = connections.filter(
    (connection) => connection.provider === provider?.id && connection.isActive !== false,
  ).length;
  const endpoint = typeof window === "undefined" ? "/v1/systemone" : `${window.location.origin}/v1/systemone`;

  const runRequest = async () => {
    setResult(null);
    let body;
    try {
      body = JSON.parse(requestText);
    } catch {
      setResult({ status: 400, ok: false, text: "Request body is not valid JSON." });
      return;
    }
    body.model = `${providerId}/${selectedModel}`;
    setRunning(true);
    try {
      const response = await fetch("/v1/systemone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientApiKey ? { Authorization: `Bearer ${clientApiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
      setResult({ status: response.status, ok: response.ok, text: formatted });
    } catch (error) {
      setResult({ status: 0, ok: false, text: error.message || "Request failed." });
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="flex min-w-0 flex-col gap-7 overflow-x-hidden">
      <PageIntro
        eyebrow="System One workspace"
        title="Run a typed decision request."
        description="Choose a registered provider, edit the native request, and inspect the upstream response without leaving LiteRouter."
        action={<Link href="/dashboard/providers" className="shrink-0"><Button variant="secondary" icon="settings">Configure providers</Button></Link>}
      />

      {providers.length === 0 ? (
        <Card>
          <p className="font-medium">No System One providers are registered.</p>
          <p className="mt-1 text-sm text-text-muted">Add a registry entry with a `systemone` service kind and a model list.</p>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <Card className="min-w-0" title="Request" subtitle="Provider-native JSON is forwarded unchanged after model normalization." icon="tune">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Provider"
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
                options={providers.map((entry) => ({ value: entry.id, label: entry.name }))}
              />
              <Select
                label="Model"
                value={selectedModel}
                onChange={(event) => setModel(event.target.value)}
                options={models.map((entry) => ({ value: entry.id, label: entry.name || entry.id }))}
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-xs ring-1 ring-border-subtle">
              <span className="min-w-0 truncate font-mono text-text-muted">POST {endpoint}</span>
              <Badge variant={connectionCount && clientApiKey ? "success" : "default"} size="sm" dot>
                {connectionCount && clientApiKey
                  ? `${connectionCount} connection${connectionCount === 1 ? "" : "s"}`
                  : !clientApiKey ? "LiteRouter key needed" : "No connection"}
              </Badge>
            </div>

            <label className="mt-4 block text-sm font-medium text-text-main" htmlFor="systemone-request">Request JSON</label>
            <textarea
              id="systemone-request"
              value={requestText}
              onChange={(event) => setRequestText(event.target.value)}
              spellCheck="false"
              className="mt-1.5 min-h-[330px] w-full resize-y rounded-xl bg-surface-2 p-3 font-mono text-xs leading-5 text-text-main ring-1 ring-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-text-muted">
                {clientApiKey
                  ? "Uses your active LiteRouter API key and provider connection."
                  : <>Create an active LiteRouter key in <Link href="/dashboard/endpoint" className="text-primary hover:underline">Endpoint &amp; Key</Link>.</>}
              </p>
              <Button onClick={runRequest} loading={running} disabled={!providerId || !selectedModel} icon="play_arrow">
                Run request
              </Button>
            </div>
          </Card>

          <Card className="min-w-0" title="Response" subtitle="Status and body returned by the System One upstream." icon="data_object">
            {!result ? (
              <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-border px-6 text-center text-sm text-text-muted">
                Run a request to see the typed answer and usage payload.
              </div>
            ) : (
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className={`material-symbols-outlined text-[18px] ${result.ok ? "text-emerald-500" : "text-red-500"}`}>
                    {result.ok ? "check_circle" : "error"}
                  </span>
                  <span className="font-medium">{result.status ? `HTTP ${result.status}` : "Network error"}</span>
                </div>
                <pre className="mt-4 min-h-[380px] max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-sidebar p-4 font-mono text-xs leading-5 text-text-main">{result.text}</pre>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        <span>{provider?.description || "System One providers expose typed decision APIs."}</span>
        {provider?.docsUrl && (
          <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Provider docs ↗</a>
        )}
      </div>
    </main>
  );
}
