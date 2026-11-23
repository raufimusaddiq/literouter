"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, CardSkeleton, ConfirmModal, PageIntro } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import EndpointStrip from "./components/EndpointStrip";
import KeysTable from "./components/KeysTable";
export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);

  const [usage, setUsage] = useState({});
  const [usageState, setUsageState] = useState("loading");

  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const { copied, copy } = useCopyToClipboard();

  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before exposing the endpoint."
    : "Change the default dashboard password before exposing the endpoint.";

  const loadSettings = async () => {
    try {
      const settingsRes = await fetch("/api/settings");
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setRequireApiKey(data.requireApiKey || false);
        setRequireLogin(data.requireLogin !== false);
        setHasPassword(data.hasPassword || false);
      }
    } catch (error) {
      console.log("Error loading settings:", error);
    }
  };

  const handleRequireApiKey = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (res.ok) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const fetchData = async () => {
    try {
      const fetchKeys = async () => {
        const res = await fetch("/api/keys");
        if (!res.ok) return [];
        const data = await res.json();
        return data.keys || [];
      };

      let existing = await fetchKeys();
      if (existing.length === 0) {
        try {
          const createRes = await fetch("/api/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Default Key" }),
          });
          if (createRes.ok) existing = await fetchKeys();
        } catch {}
      }
      setKeys(existing);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsage = async () => {
    try {
      const res = await fetch("/api/usage/keys");
      if (!res.ok) throw new Error(String(res.status));
      setUsage((await res.json()).usage || {});
      setUsageState("ready");
    } catch {
      setUsageState("error");
    }
  };

  useEffect(() => {
    const id = window.setTimeout(() => {
      fetchData();
      fetchUsage();
      loadSettings();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        fetchUsage();
        setNewKeyName("");
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

  const handleDeleteKey = async ({ id, name }) => {
    setConfirmState({
      title: "Delete API key",
      message: `Delete API key "${name}"? Clients using it will stop working immediately.`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeys((prev) => prev.filter((k) => k.id !== id));
          }
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      }
    });
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const handleUpdateKeyAccess = async (id, access) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.key) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, access: data.key.access } : k));
      } else {
        console.log("Error updating key access:", data.error || res.status);
      }
    } catch (error) {
      console.log("Error updating key access:", error);
    }
  };

  const handleToggleRequest = (key, checked) => {
    if (key.isActive !== false && !checked) {
      setConfirmState({
        title: "Pause API key",
        message: `Pause API key "${key.name}"?

This key will stop working immediately but can be resumed later.`,
        onConfirm: async () => {
          setConfirmState(null);
          handleToggleKey(key.id, checked);
        },
      });
    } else {
      handleToggleKey(key.id, checked);
    }
  };

  const handleRequestRestrict = (key) => setConfirmState({
    title: "Restrict API key",
    message: `Restrict API key "${key.name}"?

It will only be able to call the combos and models you add. Until you add one, it can call nothing.`,
    onConfirm: async () => {
      setConfirmState(null);
      handleUpdateKeyAccess(key.id, { restricted: true, allow: key.access?.allow || [] });
    },
  });

  const [baseUrl, setBaseUrl] = useState("/v1");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const id = window.setTimeout(() => setBaseUrl(`${window.location.origin}/v1`), 0);
      return () => window.clearTimeout(id);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const endpointSecure = requireApiKey && !isLoginUnsafe;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageIntro
        title="Endpoint & keys"
        description={`${keys.length} ${keys.length === 1 ? "key" : "keys"} · ${keys.filter((k) => k.isActive !== false).length} active`}
        action={<Button icon="add" onClick={() => setShowAddModal(true)}>Create key</Button>}
      />

      <EndpointStrip
        baseUrl={baseUrl}
        copied={copied}
        onCopy={copy}
        requireApiKey={requireApiKey}
        onRequireApiKey={handleRequireApiKey}
        isLoginUnsafe={isLoginUnsafe}
        requireLogin={requireLogin}
        isRemoteHost={isRemoteHost}
        secure={endpointSecure}
      />

      <KeysTable
        keys={keys}
        usage={usage}
        usageState={usageState}
        copied={copied}
        onCopy={copy}
        onCreate={() => setShowAddModal(true)}
        onToggle={handleToggleRequest}
        onDelete={handleDeleteKey}
        onUpdateAccess={handleUpdateKeyAccess}
        onRequestRestrict={handleRequestRestrict}
      />

      <Modal
        isOpen={showAddModal}
        title="Create API key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
        }}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); handleCreateKey(); }}
        >
          <Input
            label="Key name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex gap-2">
            <Button type="submit" fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
              }}
              type="button"
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => setCreatedKey(null)}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">key</span>
              Save this key now!
            </p>
            <p className="text-sm text-text-muted">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap">
            <Input
              value={createdKey || ""}
              readOnly
              aria-label="Created API key"
              className="min-w-0 flex-1 basis-full font-mono text-sm sm:basis-auto"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

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


APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};
