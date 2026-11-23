"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@/web/router";
import { APIKEY_PROVIDERS, supportsServiceKind } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { Badge, Button, Card, Select, Toggle } from "@/shared/components";
import PageHeader from "@/shared/components/shell/PageHeader";
import { useOrigin } from "@/shared/hooks/useOrigin";
import StateEditor from "./components/StateEditor";
import { fieldClass, linkButtonClass } from "./components/fieldClass";
import QuestionBuilder from "./components/QuestionBuilder";
import AnswerView from "./components/AnswerView";
import {
  TEMPLATES,
  addAsset,
  blankForm,
  buildBody,
  buildCurl,
  errorFieldsFromResponse,
  errorText,
  formFromBody,
  insertPlaceholder,
  parseStoredForm,
  requestHeaders,
} from "./lib/requestBuilder";

const STORAGE_KEY = "literouter.systemone.lab";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function getSystemOneProviders() {
  return Object.values(APIKEY_PROVIDERS)
    .filter((provider) => supportsServiceKind(provider, "systemone"))
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

function loadStoredForm() {
  try {
    return parseStoredForm(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return blankForm();
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

export default function SystemOnePage() {
  const providers = getSystemOneProviders();
  const [providerId, setProviderId] = useState(providers[0]?.id || "");
  const provider = providers.find((entry) => entry.id === providerId) || providers[0];
  const models = getModelsByProviderId(provider?.id || "");
  const [model, setModel] = useState(providers[0] ? getModelsByProviderId(providers[0].id)[0]?.id || "" : "");
  const selectedModel = models.some((entry) => entry.id === model) ? model : models[0]?.id || "";
  const [form, setForm] = useState(blankForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const advancedSource = useRef("form");
  const [assetError, setAssetError] = useState("");
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [running, setRunning] = useState(false);
  const [connections, setConnections] = useState([]);
  const [clientApiKey, setClientApiKey] = useState("");
  const [copyState, setCopyState] = useState("idle");
  const fileInput = useRef(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setForm(loadStoredForm());
    setHydrated(true);
  }, []);

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

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {}
  }, [form, hydrated]);

  useEffect(() => {
    if (!advancedOpen) return;
    if (advancedSource.current === "json") {
      advancedSource.current = "form";
      return;
    }
    setRequestText(JSON.stringify(buildBody(form, `${providerId}/${selectedModel}`).body, null, 2));
  }, [advancedOpen, form, providerId, selectedModel]);

  const origin = useOrigin();
  const endpoint = `${origin}/v1/systemone`;
  const connectionCount = connections.filter(
    (connection) => connection.provider === provider?.id && connection.isActive !== false,
  ).length;

  const preview = buildBody(form, `${providerId}/${selectedModel}`);
  const blockingErrors = preview.errors;
  const runDisabledReason = !providerId || !selectedModel
    ? "Choose a provider and model."
    : !clientApiKey
      ? "Create an active LiteRouter API key first."
      : form.questions.length === 0
        ? "Add a state and a question to run."
        : blockingErrors[0] || "";
  const templateButtons = TEMPLATES.map((template) => (
    <Button
      key={template.id}
      type="button"
      size="sm"
      variant="secondary"
      icon="bolt"
      onClick={() => setForm((current) => ({ ...template.build(), longContext: current.longContext }))}
    >
      {template.label}
    </Button>
  ));
  const hasBoxQuestion = form.questions.some((question) => question.type === "box");
  const showAssets = assetsOpen || hasBoxQuestion || form.assets.length > 0;
  const questionsById = Object.fromEntries(form.questions.map((question) => [question.key.trim(), question]));

  const openAdvanced = () => {
    setRequestText(JSON.stringify(preview.body, null, 2));
    setJsonError("");
    setAdvancedOpen(true);
  };

  const applyAdvanced = (text) => {
    setRequestText(text);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setJsonError("Request is not valid JSON. The form keeps its last good state.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setJsonError("Request must be a JSON object. The form keeps its last good state.");
      return;
    }
    setJsonError("");
    advancedSource.current = "json";
    const next = formFromBody(parsed);
    setForm({ ...next, longContext: form.longContext });
  };

  const runRequest = async () => {
    const checked = buildBody(form, `${providerId}/${selectedModel}`);
    if (checked.errors.length) {
      setResult(null);
      setFieldErrors({});
      setResult({ status: 0, ok: false, errorText: checked.errors.join("\n"), text: "" });
      return;
    }
    setResult(null);
    setFieldErrors({});
    setRunning(true);
    try {
      const response = await fetch("/v1/systemone", {
        method: "POST",
        headers: {
          ...requestHeaders(form),
          ...(clientApiKey ? { Authorization: `Bearer ${clientApiKey}` } : {}),
        },
        body: JSON.stringify(checked.body),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {}
      const pretty = payload ? JSON.stringify(payload, null, 2) : text;
      setResult({
        status: response.status,
        ok: response.ok,
        text: pretty,
        payload,
        assets: form.assets,
        errorText: response.ok ? "" : errorText(payload, `Upstream error: ${response.status}`),
      });
      if (response.status === 422) setFieldErrors(errorFieldsFromResponse(payload));
    } catch (error) {
      setResult({ status: 0, ok: false, text: "", payload: null, errorText: error.message || "Request failed." });
    } finally {
      setRunning(false);
    }
  };

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(buildCurl(endpoint, preview.body, requestHeaders(form)));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
    }
  };

  const uploadImage = async (file) => {
    if (!file) return;
    const format = file.type === "image/jpeg" || file.type === "image/jpg" ? "jpg" : file.type === "image/png" ? "png" : "";
    if (!format) {
      setAssetError("Only PNG and JPG images are supported.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAssetError("Image is too large. Use one under 4 MB.");
      return;
    }
    try {
      const data_base64 = await readFileAsBase64(file);
      setAssetError("");
      setForm((current) => addAsset(current, { name: file.name, format, data_base64 }));
    } catch (error) {
      setAssetError(error.message);
    }
  };

  return (
    <main className="flex min-w-0 flex-col gap-7 overflow-x-clip">
      <PageHeader
        title="System One"
        description="Typed decision requests: compose state and questions, run them against a provider, read the answers."
        actions={<Link href="/dashboard/providers" className="shrink-0"><Button variant="secondary" icon="settings">Configure providers</Button></Link>}
      />

      {providers.length === 0 ? (
        <Card>
          <p className="font-medium">No System One providers are registered.</p>
          <p className="mt-1 text-sm text-muted">Add a registry entry with a `systemone` service kind and a model list.</p>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
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

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-line px-1 py-2 text-xs">
                <span className="min-w-0 truncate font-mono text-muted">POST {endpoint}</span>
                <Badge variant={connectionCount && clientApiKey ? "success" : "default"} size="sm" dot>
                  {connectionCount && clientApiKey
                    ? `${connectionCount} connection${connectionCount === 1 ? "" : "s"}`
                    : !clientApiKey ? "LiteRouter key needed" : "No connection"}
                </Badge>
              </div>

              {form.questions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Templates">
                  {templateButtons}
                </div>
              )}

              <div className="mt-5 border-t border-line pt-4">
                <StateEditor form={form} onChange={setForm} error={form.stateMode === "json" ? blockJsonError(form.stateJson) : ""} />
              </div>

              <div className="mt-5 border-t border-line pt-4">
                <h3 className="mb-3 text-sm font-semibold text-ink">Questions</h3>
                <QuestionBuilder
                  form={form}
                  onChange={setForm}
                  errors={fieldErrors}
                  emptyActions={<div className="flex flex-wrap gap-2" role="group" aria-label="Templates">{templateButtons}</div>}
                />
              </div>
            </Card>

            <Card className="min-w-0" title="Images" subtitle="PNG or JPG, sent as base64 assets." icon="image">
              {showAssets ? (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/png,image/jpeg"
                      aria-label="Upload image"
                      className="sr-only"
                      id="systemone-image-input"
                      onChange={(event) => uploadImage(event.target.files?.[0])}
                    />
                    <Button type="button" size="sm" variant="secondary" icon="upload" onClick={() => fileInput.current?.click()}>Upload image</Button>
                    <label htmlFor="systemone-paste-zone" className="sr-only">Paste an image</label>
                    <div
                      id="systemone-paste-zone"
                      tabIndex={0}
                      onPaste={(event) => uploadImage(event.clipboardData?.files?.[0])}
                      className="min-h-10 flex-1 rounded-md border border-dashed border-line-strong px-3 py-2 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line"
                    >
                      Or focus here and paste an image.
                    </div>
                  </div>

                  {assetError && <p role="alert" className="mt-2 text-xs text-danger">{assetError}</p>}

                  {form.assets.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2">
                      {form.assets.map((asset) => (
                        <li key={asset.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-raise p-2">
                          <span className="min-w-0 truncate font-mono text-xs text-ink">{asset.placeholder}</span>
                          <span className="text-xs text-muted">{asset.name || asset.format}</span>
                          <span className="flex flex-1 justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              icon="input"
                              onClick={() => setForm((current) => insertPlaceholder(current, asset.placeholder))}
                            >
                              Insert
                            </Button>
                            <button
                              type="button"
                              aria-label={`Remove image ${asset.placeholder}`}
                              onClick={() => setForm((current) => ({ ...current, assets: current.assets.filter((entry) => entry.id !== asset.id) }))}
                              className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-raise hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAssetsOpen(true)}
                  className={linkButtonClass}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add</span>
                  Add images
                </button>
              )}
            </Card>

            <Card className="min-w-0" title="Advanced" subtitle="Edit the exact request JSON when the form is not enough." icon="data_object">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Toggle
                  checked={advancedOpen}
                  onChange={(value) => (value ? openAdvanced() : setAdvancedOpen(false))}
                  label="Edit request JSON"
                />
                <Toggle
                  checked={form.longContext}
                  onChange={(longContext) => setForm((current) => ({ ...current, longContext }))}
                  label="Long context"
                />
              </div>
              {advancedOpen && (
                <div className="mt-3">
                  <label htmlFor="systemone-advanced-json" className="text-xs font-medium text-ink">Request JSON</label>
                  <textarea
                    id="systemone-advanced-json"
                    value={requestText}
                    onChange={(event) => applyAdvanced(event.target.value)}
                    spellCheck="false"
                    className={fieldClass({ invalid: Boolean(jsonError), className: "mt-1 min-h-[240px] resize-y p-3 font-mono text-xs leading-5" })}
                  />
                  {jsonError && <p role="alert" className="mt-1 text-xs text-danger">{jsonError}</p>}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="secondary" icon="content_copy" onClick={copyCurl}>Copy as curl</Button>
                <span aria-live="polite" className="text-xs text-muted">
                  {copyState === "copied" ? "Copied." : copyState === "failed" ? "Copy failed." : "Uses a placeholder key, never your real one."}
                </span>
              </div>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-raise p-3 font-mono text-[11px] leading-5 text-muted">{JSON.stringify(preview.body, null, 2)}</pre>
            </Card>
          </div>

          <Card className="min-w-0" title="Answers" subtitle="Typed results, probability bars, and raw JSON." icon="data_object">
            <div className="sticky -top-4">
              <AnswerView result={result} form={{ questionsById }} />
              <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
                {runDisabledReason && <p className="text-xs text-muted">{runDisabledReason}</p>}
                <Button onClick={runRequest} loading={running} disabled={Boolean(runDisabledReason)} icon="play_arrow" fullWidth>
                  Run request
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{provider?.description || "System One providers expose typed decision APIs."}</span>
        {provider?.docsUrl && (
          <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-[3px] hover:opacity-80">Provider docs ↗</a>
        )}
      </div>
    </main>
  );
}

function blockJsonError(text) {
  try {
    const parsed = JSON.parse(text || "null");
    return Array.isArray(parsed) || (parsed !== null && typeof parsed === "object") ? "" : "State must be an array or object in JSON mode.";
  } catch {
    return "State is not valid JSON.";
  }
}
