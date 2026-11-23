const GA_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

const BASE_TAGS = [
  '<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">',
  '<link rel="shortcut icon" href="/favicon.svg?v=2">',
  '<link rel="manifest" href="/manifest.webmanifest">',
];

function analyticsTags(gaId) {
  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>`,
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${gaId}');</script>`,
  ];
}

export function headExtras({ gaId } = {}) {
  const tags = [...BASE_TAGS];
  if (typeof gaId === "string" && GA_ID_PATTERN.test(gaId)) tags.push(...analyticsTags(gaId));
  return tags.join("\n");
}
