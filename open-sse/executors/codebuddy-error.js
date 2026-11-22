export function parseCodeBuddyError(bodyText) {
  if (!bodyText) return null;
  try {
    const data = JSON.parse(bodyText);
    const message = data?.msg || data?.message || data?.error?.message || "";
    if (data?.code !== 6004 && !/超出频率限制|frequency limit|限额/i.test(message)) return null;

    let resetsAtMs = null;
    const match = message.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
    if (match) {
      const timezone = match[3]
        ? (match[3].includes(":") ? `+${match[3]}` : `+${match[3].padStart(2, "0")}:00`)
        : "+08:00";
      const timestamp = new Date(`${match[1]}T${match[2]}${timezone}`).getTime();
      if (!Number.isNaN(timestamp)) resetsAtMs = timestamp;
    }
    return { status: 429, message: message || "CodeBuddy frequency limit (6004)", resetsAtMs };
  } catch {
    return null;
  }
}
