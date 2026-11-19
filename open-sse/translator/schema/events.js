// Claude Messages API streaming SSE event "type" discriminators. Pure data.
export const CLAUDE_EVENT = {
  MESSAGE_START: "message_start",
  MESSAGE_DELTA: "message_delta",
  MESSAGE_STOP: "message_stop",
  CONTENT_BLOCK_START: "content_block_start",
  CONTENT_BLOCK_DELTA: "content_block_delta",
  CONTENT_BLOCK_STOP: "content_block_stop",
  PING: "ping",
};
