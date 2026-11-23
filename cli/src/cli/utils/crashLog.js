const DEFAULT_LINES = 50;

function createCrashLog(limit = DEFAULT_LINES) {
  let buffer = [];

  async function collect(stream) {
    try {
      const decoder = new TextDecoder();
      let tail = "";
      for await (const chunk of stream) {
        tail += decoder.decode(chunk, { stream: true });
        const lines = tail.split("\n");
        tail = lines.pop();
        buffer.push(...lines.filter(Boolean));
        if (buffer.length > limit) buffer = buffer.slice(-limit);
      }
      if (tail) buffer.push(tail);
      if (buffer.length > limit) buffer = buffer.slice(-limit);
    } catch (e) {}
  }

  return { collect, lines: () => buffer };
}

module.exports = { createCrashLog };
