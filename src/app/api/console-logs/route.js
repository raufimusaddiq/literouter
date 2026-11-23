import { json } from "@/server/http.js";
import { clearConsoleLogs, getConsoleLogs, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

export async function GET() {
  try {
    const logs = getConsoleLogs();
    return json({ success: true, logs });
  } catch (error) {
    console.error("Error getting console logs:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    clearConsoleLogs();
    return json({ success: true });
  } catch (error) {
    console.error("Error clearing console logs:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}
