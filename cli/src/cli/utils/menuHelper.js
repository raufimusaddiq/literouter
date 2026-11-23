const { selectMenu } = require("./input");

async function showMenuWithBack(config) {
  const {
    title,
    headerContent = "",
    items,
    backLabel = "← Back",
    defaultIndex = 0,
    refresh = null,
    breadcrumb = []
  } = config;

  while (true) {
    let refreshedData = null;
    if (refresh) {
      refreshedData = await refresh();
      if (refreshedData === null) {
        return;
      }
    }

    const menuItems = [
      { label: backLabel, icon: "☆" },
      ...items.map(item => ({
        label: typeof item.label === "function" ? item.label(refreshedData) : item.label,
        icon: "☆"
      }))
    ];

    const resolvedHeader = typeof headerContent === "function" 
      ? await headerContent(refreshedData) 
      : headerContent;

    const selected = await selectMenu(
      title,
      menuItems,
      defaultIndex,
      "",
      resolvedHeader,
      breadcrumb
    );

    if (selected === -1 || selected === 0) {
      return;
    }

    const actionIndex = selected - 1;
    const item = items[actionIndex];
    
    if (item && item.action) {
      const shouldContinue = await item.action(refreshedData);
      if (shouldContinue === false) {
        return;
      }
    }
  }
}

async function showListMenu(config) {
  const {
    title,
    headerContent = "",
    fetchItems,
    formatItem,
    onSelect,
    createAction = null,
    backLabel = "← Back",
    breadcrumb = []
  } = config;

  while (true) {
    const result = await fetchItems();
    if (!result) {
      return;
    }

    const items = result.items || [];
    const metadata = result.metadata || {};

    const menuItems = [{ label: backLabel, icon: "☆" }];
    
    if (createAction) {
      menuItems.push({ label: createAction.label, icon: "☆" });
    }

    items.forEach(item => {
      const formatted = formatItem(item);
      menuItems.push({ label: formatted, icon: "☆" });
    });

    const header = typeof headerContent === "function" 
      ? await headerContent(metadata) 
      : headerContent;

    const selected = await selectMenu(title, menuItems, 0, "", header, breadcrumb);

    if (selected === -1 || selected === 0) {
      return;
    }

    if (createAction && selected === 1) {
      await createAction.action();
      continue;
    }

    const offset = createAction ? 2 : 1;
    const itemIndex = selected - offset;
    
    if (itemIndex >= 0 && itemIndex < items.length) {
      await onSelect(items[itemIndex]);
    }
  }
}

module.exports = {
  showMenuWithBack,
  showListMenu
};
