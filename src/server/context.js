const EMPTY = Object.freeze({ peerIp: "", clientIp: "", isLocal: false });
const contexts = new WeakMap();

export function setRequestContext(req, ctx) {
  contexts.set(req, ctx);
}

export function getRequestContext(req) {
  return contexts.get(req) || EMPTY;
}
