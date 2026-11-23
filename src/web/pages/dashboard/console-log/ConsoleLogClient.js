"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import PageHeader from "@/shared/components/shell/PageHeader";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-ink",
  INFO: "text-ink",
  WARN: "text-warning",
  ERROR: "text-danger",
  DEBUG: "text-muted",
};

function colorLine(line) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match ? match[1]?.replace(/\[|\]/g, "") : null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-ink";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/console-logs", { method: "DELETE" });
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Console log" description="Live server events and route diagnostics from the local process." actions={<Button size="sm" variant="outline" icon="delete" onClick={handleClear}>Clear log</Button>} />
      <Card variant="raised" padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-xs font-medium text-muted">Live output</p>
            <p className="mt-1 text-sm text-ink">Server events and route diagnostics.</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${connected ? "text-ok" : "text-warning"}`}>
            <span aria-hidden="true" className={`size-1.5 rounded-full ${connected ? "bg-ok" : "bg-warning"}`} />
            {connected ? "Streaming" : "Disconnected"}
          </span>
        </div>
        <div
          ref={logRef}
          className="h-[calc(100dvh-260px)] overflow-y-auto p-5 font-mono text-xs text-ink"
        >
          <div aria-live="polite" aria-atomic="false" role="status">
          {logs.length === 0 ? (
            <span className="text-muted">No console logs yet.</span>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line, i) => (
                <div key={i} className="[overflow-wrap:anywhere]">{colorLine(line)}</div>
              ))}
            </div>
          )}
          </div>
        </div>
      </Card>
    </div>
  );
}
