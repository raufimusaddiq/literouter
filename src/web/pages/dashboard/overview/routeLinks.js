export function computeRouteLinks(recent = [], rows = []) {
  const reqList = Array.isArray(recent) ? recent : [];
  const rowList = Array.isArray(rows) ? rows : [];
  const firstIndexByProvider = new Map();

  for (let i = 0; i < rowList.length; i += 1) {
    const provider = rowList[i]?.provider;
    if (provider != null && provider !== "" && !firstIndexByProvider.has(provider)) {
      firstIndexByProvider.set(provider, i);
    }
  }

  const hits = new Map();
  const links = reqList.map((req, from) => {
    const provider = req?.provider;
    if (provider != null && provider !== "") {
      hits.set(provider, (hits.get(provider) || 0) + 1);
    }
    const to = provider != null && firstIndexByProvider.has(provider)
      ? firstIndexByProvider.get(provider)
      : null;
    return { from, to };
  });

  return {
    links,
    hits,
    newest: reqList.length > 0 ? 0 : null,
  };
}
