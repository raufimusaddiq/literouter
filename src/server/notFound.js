const TITLE = "404: This page could not be found.";

const PAGE =
  '<!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/>' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
  '<meta name="robots" content="noindex"/>' +
  `<title>${TITLE}</title></head><body>` +
  '<div style="font-family:system-ui,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;;height:100vh;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center">' +
  "<div><style>body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}" +
  "@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}</style>" +
  '<h1 class="next-error-h1" style="display:inline-block;margin:0 20px 0 0;padding:0 23px 0 0;font-size:24px;font-weight:500;vertical-align:top;line-height:49px">404</h1>' +
  '<div style="display:inline-block"><h2 style="font-size:14px;font-weight:400;line-height:49px;margin:0">This page could not be found.</h2></div>' +
  "</div></div></body></html>";

const BODY = new TextEncoder().encode(PAGE);

export function notFound() {
  return new Response(BODY, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(BODY.byteLength),
      "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
    },
  });
}
