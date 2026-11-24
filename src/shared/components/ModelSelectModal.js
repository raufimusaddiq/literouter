"use client";

import { applyQoderModelNames } from "@/shared/utils/providerCustomModels";

import { useState, useMemo, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import ProviderIcon from "./ProviderIcon";
import CapacityBadges from "./CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, getProviderAlias } from "@/shared/constants/providers";

const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(id => FREE_PROVIDERS[id].noAuth);

const LIVE_CATALOG_PROVIDERS = ["cursor", "cline", "clinepass"];

function useLiveProviderModels(isOpen, connectionIds, label) {
  const [models, setModels] = useState([]);
  const idsKey = (connectionIds ?? []).join("|");

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    if (!isOpen || ids.length === 0) {
      (async () => {
        setModels([]);
      })();
      return undefined;
    }

    let cancelled = false;
    Promise.all(ids.map(async (connectionId) => {
      const response = await fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    }))
      .then((modelLists) => {
        if (cancelled) return;
        const seen = new Set();
        setModels(modelLists.flat().filter((model) => {
          if (!model?.id || seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        }));
      })
      .catch((error) => {
        console.warn(`Unable to load ${label} models for selector:`, error);
        if (!cancelled) setModels([]);
      });

    return () => { cancelled = true; };
  }, [isOpen, idsKey, label]);

  return models;
}

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = [],
  title = "Select Model",
  modelAliases = {},
  kindFilter = null,
  capFilter = null,
  addedModelValues = [],
  closeOnSelect = true,
}) {
  const filteredActiveProviders = useMemo(() => {
    if (!kindFilter) return activeProviders;
    return activeProviders.filter((p) => {
      const info = AI_PROVIDERS[p.provider];
      const kinds = info?.serviceKinds || ["llm"];
      return kinds.includes(kindFilter);
    });
  }, [activeProviders, kindFilter]);
  const { getCaps } = useModelCaps();
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [disabledModels, setDisabledModels] = useState({});
  const liveConnectionIdsByProvider = useMemo(() => {
    const map = Object.fromEntries(LIVE_CATALOG_PROVIDERS.map((id) => [id, []]));
    for (const p of activeProviders) {
      if (p?.id && Object.prototype.hasOwnProperty.call(map, p.provider)) map[p.provider].push(p.id);
    }
    return map;
  }, [activeProviders]);
  const cursorConnectionIds = liveConnectionIdsByProvider.cursor;
  const clineConnectionIds = liveConnectionIdsByProvider.cline;
  const clinepassConnectionIds = liveConnectionIdsByProvider.clinepass;

  const cursorModels = useLiveProviderModels(isOpen, cursorConnectionIds, "Cursor");
  const clineModels = useLiveProviderModels(isOpen, clineConnectionIds, "Cline");
  const clinepassModels = useLiveProviderModels(isOpen, clinepassConnectionIds, "ClinePass");

  const fetchCombos = async () => {
    try {
      const res = await fetch("/api/combos");
      if (!res.ok) throw new Error(`Failed to fetch combos: ${res.status}`);
      const data = await res.json();
      setCombos(data.combos || []);
    } catch (error) {
      console.error("Error fetching combos:", error);
      setCombos([]);
    }
  };

  useEffect(() => {
    if (isOpen) (async () => fetchCombos())();
  }, [isOpen]);

  const fetchProviderNodes = async () => {
    try {
      const res = await fetch("/api/provider-nodes");
      if (!res.ok) throw new Error(`Failed to fetch provider nodes: ${res.status}`);
      const data = await res.json();
      setProviderNodes(data.nodes || []);
    } catch (error) {
      console.error("Error fetching provider nodes:", error);
      setProviderNodes([]);
    }
  };

  useEffect(() => {
    if (isOpen) (async () => fetchProviderNodes())();
  }, [isOpen]);

  const fetchCustomModels = async () => {
    try {
      const res = await fetch("/api/models/custom");
      if (!res.ok) throw new Error(`Failed to fetch custom models: ${res.status}`);
      const data = await res.json();
      setCustomModels(data.models || []);
    } catch (error) {
      console.error("Error fetching custom models:", error);
      setCustomModels([]);
    }
  };

  useEffect(() => {
    if (isOpen) (async () => fetchCustomModels())();
  }, [isOpen]);

  const fetchDisabledModels = async () => {
    try {
      const res = await fetch("/api/models/disabled");
      if (!res.ok) throw new Error(`Failed to fetch disabled models: ${res.status}`);
      const data = await res.json();
      setDisabledModels(data.disabled || {});
    } catch (error) {
      console.error("Error fetching disabled models:", error);
      setDisabledModels({});
    }
  };

  useEffect(() => {
    if (isOpen) (async () => fetchDisabledModels())();
  }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  const groupedModels = useMemo(() => {
    const groups = {};

    const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText"]);
    const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image"]);

    const filterByKind = (models) => {
      if (!kindFilter) return models.filter((m) => m.isPlaceholder || m.isCustom || !getModelKind(m) || getModelKind(m) === "llm");
      if (!TYPED_KINDS.has(kindFilter)) return models;
      return models.filter((m) => m.isPlaceholder || getModelKind(m) === kindFilter);
    };

    const activeConnectionIds = filteredActiveProviders.map(p => p.provider);

    const noAuthIds = kindFilter
      ? NO_AUTH_PROVIDER_IDS.filter((id) => (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(kindFilter))
      : NO_AUTH_PROVIDER_IDS;

    const providerIdsToShow = new Set([
      ...activeConnectionIds,
      ...noAuthIds,
    ]);

    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId) => {
      const alias = getProviderAlias(providerId);
      const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      if (providerInfo.passthroughModels) {
        const aliasModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${alias}/`, ""),
            name: aliasName,
            value: fullModel,
          }));
        const customRegisteredModels = customModels
          .filter((m) => m.providerAlias === alias)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${alias}/${m.id}`,
            kind: getModelKind(m),
            isCustom: true,
          }));

        let combined = aliasModels;
        if (kindFilter && TYPED_KINDS.has(kindFilter)) {
          const registeredTyped = customRegisteredModels.filter((m) => getModelKind(m) === kindFilter);
          combined = [
            ...registeredTyped,
            ...getModelsByProviderId(providerId)
            .filter((m) => getModelKind(m) === kindFilter)
            .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
            .filter((m) => !registeredTyped.some((registered) => registered.value === m.value)),
          ];
          if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
            const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
            if (supports) combined = [{ id: providerId, name: providerInfo.name, value: alias }];
          }
        } else {
          const registeredLlms = customRegisteredModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm");
          const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
          const hardcoded = getModelsByProviderId(providerId)
            .filter((m) => !getModelKind(m) || getModelKind(m) === "llm")
            .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
            .filter((m) => !seen.has(m.value));
          combined = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((registered) => registered.value === m.value)), ...hardcoded];
        }

        if (combined.length > 0) {
          const matchedNode = providerNodes.find(node => node.id === providerId);
          const displayName = matchedNode?.name || providerInfo.name;

          groups[providerId] = {
            name: displayName,
            alias: alias,
            color: providerInfo.color,
            models: combined,
          };
        }
      } else if (isCustomProvider) {
        if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
        const connection = activeProviders.find(p => p.provider === providerId);
        const matchedNode = providerNodes.find(node => node.id === providerId);
        const displayName = matchedNode?.name || connection?.name || providerInfo.name;
        const nodePrefix = connection?.providerSpecificData?.prefix || matchedNode?.prefix || providerId;

        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
          }));

        const registeredCustom = customModels
          .filter((m) => m.providerAlias === providerId)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${nodePrefix}/${m.id}`,
            isCustom: true,
          }));
        const seen = new Set(nodeModels.map((m) => m.value));
        const mergedModels = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];

        const modelsToShow = mergedModels.length > 0 ? mergedModels : [{
          id: `__placeholder__${providerId}`,
          name: `${nodePrefix}/model-id`,
          value: `${nodePrefix}/model-id`,
          isPlaceholder: true,
        }];

        groups[providerId] = {
          name: displayName,
          alias: nodePrefix,
          color: providerInfo.color,
          models: modelsToShow,
          isCustom: true,
          hasModels: mergedModels.length > 0,
        };
      } else {
        const liveModels = providerId === "cursor" ? cursorModels : providerId === "cline" ? clineModels : providerId === "clinepass" ? clinepassModels : [];
        const hardcodedModels = liveModels.length > 0
          ? liveModels
          : getModelsByProviderId(providerId);
        const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));

        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = Object.entries(modelAliases)
          .filter(([aliasName, fullModel]) =>
            fullModel.startsWith(`${alias}/`) &&
            (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) &&
            !hardcodedIds.has(fullModel.replace(`${alias}/`, ""))
          )
          .map(([aliasName, fullModel]) => {
            const modelId = fullModel.replace(`${alias}/`, "");
            return { id: modelId, name: aliasName, value: fullModel, isCustom: true };
          });

        const customAliasIds = new Set(customAliasModels.map((m) => m.id));
        const customRegisteredModels = customModels
          .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, isCustom: true }));

        const merged = [
          ...applyQoderModelNames(hardcodedModels, customModels, alias).map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) })),
          ...customAliasModels,
          ...customRegisteredModels,
        ];
        const seen = new Set();
        let allModels = filterByKind(merged.filter((m) => {
          if (seen.has(m.value)) return false;
          seen.add(m.value);
          return true;
        }));

        if (allModels.length === 0 && kindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
          const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
          if (supports) {
            allModels = [{ id: providerId, name: providerInfo.name, value: alias }];
          }
        }

        if (allModels.length > 0) {
          groups[providerId] = {
            name: providerInfo.name,
            alias: alias,
            color: providerInfo.color,
            models: allModels,
          };
        }
      }
    });

    Object.entries(groups).forEach(([providerId, group]) => {
      const aliasKey = getProviderAlias(providerId);
      const disabledIds = new Set([
        ...(disabledModels[aliasKey] || []),
        ...(disabledModels[providerId] || []),
      ]);
      if (disabledIds.size === 0) return;
      group.models = group.models.filter((m) => !disabledIds.has(m.id));
      if (group.models.length === 0) delete groups[providerId];
    });

    return groups;
  }, [filteredActiveProviders, modelAliases, allProviders, providerNodes, customModels, disabledModels, kindFilter, activeProviders, cursorModels, clineModels, clinepassModels]);

  const filteredCombos = useMemo(() => {
    if (kindFilter || capFilter) return [];
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter(c => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery, kindFilter]);

  const sortModels = (models) => {
    const added = models.filter(m => addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    const rest = models.filter(m => !addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    return [...added, ...rest];
  };

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = {};
    Object.entries(groupedModels).forEach(([providerId, group]) => {
      let models = group.models;
      if (capFilter) {
        models = models.filter((m) => getCaps(m.value)?.[capFilter] === true);
        if (models.length === 0) return;
      }
      if (query) {
        const providerNameMatches = group.name.toLowerCase().includes(query);
        models = models.filter(
          (m) =>
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query)
        );
        if (models.length === 0 && !providerNameMatches) return;
      }
      filtered[providerId] = {
        ...group,
        models: sortModels(models),
      };
    });

    return filtered;
  }, [groupedModels, searchQuery, addedModelValues]);

  const handleSelect = (model) => {
    const value = model?.value || model?.name || model;
    const isAdded = addedModelValues.includes(value);

    if (isAdded && onDeselect) {
      onDeselect(model);
    } else {
      onSelect(model);
    }

    if (closeOnSelect) {
      onClose();
      setSearchQuery("");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setSearchQuery("");
      }}
      title={title}
      size="md"
      footer={null}
    >
      <div className="mb-3 flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2 text-xs text-muted">
        <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[15px] text-muted">info</span>
        <span>Click to add, click again to remove. Changes are saved automatically.</span>
      </div>

      <div className="mb-3">
        <div className="relative">
          <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-muted">
            search
          </span>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-line-strong bg-bg pl-8 pr-3 text-sm text-ink placeholder:text-faint focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line"
          />
        </div>
      </div>

      <div className="max-h-[400px] space-y-4 overflow-y-auto pr-1">
        {filteredCombos.length > 0 && (
          <div>
            <div className="sticky top-0 z-10 mb-2 flex items-center gap-1.5 border-b border-line bg-raise py-1">
              <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-muted">layers</span>
              <span className="text-xs font-semibold text-ink">Combos</span>
              <span className="font-mono text-[11px] text-faint">({filteredCombos.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCombos.map((combo) => {
                const isSelected = selectedModel === combo.name;
                return (
                  <button
                    type="button"
                    key={combo.id}
                    onClick={() => handleSelect({ id: combo.name, name: combo.name, value: combo.name })}
                    className={`flex min-h-11 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors hover:cursor-pointer ${
                      isSelected || addedModelValues.includes(combo.name)
                        ? "border-ink bg-ink text-bg"
                        : "border-line-strong bg-bg text-ink hover:border-ink/50 hover:bg-surface-2"
                    }`}
                  >
                    {addedModelValues.includes(combo.name) && (
                      <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "12px" }}>check</span>
                    )}
                    {combo.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {Object.entries(filteredGroups).map(([providerId, group]) => (
          <div key={providerId}>
            <div className="sticky top-0 z-10 mb-2 flex items-center gap-1.5 border-b border-line bg-raise py-1">
              <ProviderIcon
                src={`/providers/${providerId}.png`}
                alt={group.name}
                size={14}
                fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()}
                fallbackColor={group.color}
              />
              <span className="text-xs font-semibold text-ink">
                {group.name}
              </span>
              <span className="font-mono text-[11px] text-faint">
                ({group.models.length})
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {group.models.map((model) => {
                const isSelected = selectedModel === model.value;
                const isPlaceholder = model.isPlaceholder;
                return (
                  <button
                    type="button"
                    key={model.value}
                    onClick={() => handleSelect(model)}
                    title={isPlaceholder ? "Select to pre-fill, then edit model ID in the input" : undefined}
                    className={`min-h-11 rounded-md border px-2.5 text-xs font-medium transition-colors hover:cursor-pointer ${
                      isPlaceholder
                        ? "border-dashed border-line-strong bg-bg text-muted hover:border-ink/50 hover:text-ink"
                        : isSelected || addedModelValues.includes(model.value)
                          ? "border-ink bg-ink text-bg"
                          : "border-line-strong bg-bg text-ink hover:border-ink/50 hover:bg-surface-2"
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      {addedModelValues.includes(model.value) && !isPlaceholder && (
                        <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "12px" }}>check</span>
                      )}
                      {isPlaceholder ? (
                        <>
                          <span aria-hidden="true" className="material-symbols-outlined text-[12px]">edit</span>
                          <span className="font-mono">{model.name}</span>
                        </>
                      ) : model.isCustom ? (
                        <>
                          <span>{model.name}</span>
                          <span className="text-[11px] font-normal opacity-60">custom</span>
                          <CapacityBadges caps={getCaps(model.value)} />
                        </>
                      ) : (
                        <>
                          <span>{model.name}</span>
                          <CapacityBadges caps={getCaps(model.value)} />
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
          <div className="py-6 text-center text-muted">
            <span aria-hidden="true" className="material-symbols-outlined mb-1 block text-2xl text-faint">
              search_off
            </span>
            <p className="text-xs">No models found</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

ModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  onDeselect: PropTypes.func,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    })
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
  kindFilter: PropTypes.string,
  addedModelValues: PropTypes.arrayOf(PropTypes.string),
  closeOnSelect: PropTypes.bool,
};
