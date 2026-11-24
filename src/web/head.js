const GA_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const ORIGIN_PATTERN = /^https?:\/\/[A-Za-z0-9.-]{1,253}(?::\d{1,5})?$/;
const TITLE = "LiteRouter — AI routing control plane";
const DESCRIPTION = "A lean control plane for provider keys, routing, usage, and quota.";

const BASE_TAGS = [
  '<link rel="icon" href="/favicon.svg?v=3" type="image/svg+xml">',
  '<link rel="icon" href="/icons/favicon-32.png?v=3" type="image/png" sizes="32x32">',
  '<link rel="icon" href="/icons/favicon-96.png?v=3" type="image/png" sizes="96x96">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">',
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="LiteRouter">',
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="LiteRouter">',
  `<meta property="og:title" content="${TITLE}">`,
  `<meta property="og:description" content="${DESCRIPTION}">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="LiteRouter logo">',
  '<meta name="twitter:card" content="summary_large_image">',
  `<meta name="twitter:title" content="${TITLE}">`,
  `<meta name="twitter:description" content="${DESCRIPTION}">`,
];

function analyticsTags(gaId) {
  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>`,
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${gaId}');</script>`,
  ];
}

function ogImageTags(origin) {
  const base = typeof origin === "string" && ORIGIN_PATTERN.test(origin) ? origin : "";
  const image = `${base}/og.png`;
  const tags = [
    `<meta property="og:image" content="${image}">`,
    `<meta name="twitter:image" content="${image}">`,
  ];
  if (base) tags.push(`<meta property="og:url" content="${base}/">`);
  return tags;
}

export function headExtras({ gaId, origin } = {}) {
  const tags = [...BASE_TAGS, ...ogImageTags(origin)];
  if (typeof gaId === "string" && GA_ID_PATTERN.test(gaId)) tags.push(...analyticsTags(gaId));
  return tags.join("\n");
}
