const COLORS = {
  reset: "\x1b[0m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  warning: "\x1b[33m",
  info: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m"
};

const BOX_CHARS = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│"
};

function showBox(title, content, width = 60) {
  const innerWidth = width - 4;
  const lines = content.split("\n");

  const topBorder = BOX_CHARS.topLeft + BOX_CHARS.horizontal.repeat(2) + 
    ` ${title} ` + 
    BOX_CHARS.horizontal.repeat(Math.max(0, innerWidth - title.length - 3)) + 
    BOX_CHARS.topRight;

  console.log(topBorder);

  lines.forEach(line => {
    const paddedLine = line.padEnd(innerWidth);
    console.log(`${BOX_CHARS.vertical} ${paddedLine} ${BOX_CHARS.vertical}`);
  });

  const bottomBorder = BOX_CHARS.bottomLeft + 
    BOX_CHARS.horizontal.repeat(innerWidth + 2) + 
    BOX_CHARS.bottomRight;

  console.log(bottomBorder);
}

function showMenu(title, items, footer) {
  console.log(`\n${COLORS.bold}${title}${COLORS.reset}`);
  console.log(COLORS.dim + "─".repeat(title.length) + COLORS.reset);

  items.forEach((item, index) => {
    console.log(`  ${COLORS.info}${index + 1}.${COLORS.reset} ${item}`);
  });

  if (footer) {
    console.log(`\n${COLORS.dim}${footer}${COLORS.reset}`);
  }
  console.log();
}

function showTable(headers, rows) {
  if (!headers.length || !rows.length) {
    return;
  }

  const colWidths = headers.map((header, i) => {
    const maxDataWidth = Math.max(...rows.map(row => String(row[i] || "").length));
    return Math.max(header.length, maxDataWidth);
  });

  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(" │ ");
  console.log(COLORS.bold + headerRow + COLORS.reset);

  const separator = colWidths.map(w => "─".repeat(w)).join("─┼─");
  console.log(COLORS.dim + separator + COLORS.reset);

  rows.forEach(row => {
    const rowStr = row.map((cell, i) => String(cell || "").padEnd(colWidths[i])).join(" │ ");
    console.log(rowStr);
  });
}

function showStatus(message, type = "info") {
  const symbols = {
    success: "✓",
    error: "✗",
    warning: "⚠",
    info: "ℹ"
  };

  const color = COLORS[type] || COLORS.info;
  const symbol = symbols[type] || symbols.info;

  console.log(`${color}${symbol} ${message}${COLORS.reset}`);
}

function clearScreen() {
  console.clear();
}

function showHeader(title, subtitle) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${COLORS.bright}${COLORS.cyan}${title}${COLORS.reset}`);
  if (subtitle) {
    console.log(`  ${COLORS.dim}${subtitle}${COLORS.reset}`);
  }
  console.log(`${"=".repeat(60)}\n`);
}

module.exports = {
  showBox,
  showMenu,
  showTable,
  showStatus,
  clearScreen,
  showHeader
};
