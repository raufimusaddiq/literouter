// Anthropic-shaped /v1/models list, served when the client sends `anthropic-version`.
// https://docs.anthropic.com/en/api/models-list

const EPOCH_ISO = "1970-01-01T00:00:00Z";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;

function toCreatedAt(created) {
  return Number.isFinite(created) ? new Date(created * 1000).toISOString() : EPOCH_ISO;
}

/**
 * @param {Array<{id:string,name?:string,created?:number}>} models - OpenAI-shaped model entries
 * @param {{limit?:string|number, afterId?:string, beforeId?:string}} [page]
 */
export function toAnthropicModelList(models, page = {}) {
  const limitNum = parseInt(page.limit, 10);
  const limit = Number.isFinite(limitNum) ? Math.min(Math.max(limitNum, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  let start = 0;
  let end = models.length;
  if (page.afterId) {
    const i = models.findIndex((m) => m.id === page.afterId);
    if (i >= 0) start = i + 1;
  } else if (page.beforeId) {
    const i = models.findIndex((m) => m.id === page.beforeId);
    if (i >= 0) {
      end = i;
      start = Math.max(0, end - limit);
    }
  }
  const slice = models.slice(start, Math.min(end, start + limit));
  const data = slice.map((m) => ({
    type: "model",
    id: m.id,
    display_name: m.name || m.id,
    created_at: toCreatedAt(m.created),
  }));
  const hasMore = page.beforeId ? start > 0 : start + slice.length < models.length;
  return {
    data,
    has_more: hasMore,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  };
}
