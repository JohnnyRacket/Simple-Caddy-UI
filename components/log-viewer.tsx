"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, Trash2, RefreshCw } from "lucide-react";

const MAX_LINES = 2000;

type ConnStatus = "connecting" | "connected" | "disconnected" | "error";

export function LogViewer() {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const connect = useCallback(() => {
    esRef.current?.close();
    setStatus("connecting");
    setErrorMsg(null);

    const es = new EventSource("/api/logs");
    esRef.current = es;

    es.onopen = () => setStatus("connected");

    es.onmessage = (ev) => {
      try {
        const { line } = JSON.parse(ev.data) as { line: string };
        setLines((prev) => {
          const next = [...prev, line];
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      } catch {
        // malformed event, skip
      }
    };

    es.onerror = () => {
      setStatus("error");
      setErrorMsg(
        "Lost connection to log stream. journalctl may not be available on this system.",
      );
      es.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { esRef.current?.close(); };
  }, [connect]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [lines]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <StatusPill status={status} />
        {errorMsg && (
          <span className="text-xs text-destructive truncate max-w-sm">{errorMsg}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(status === "error" || status === "disconnected") && (
            <Button variant="secondary" size="sm" onClick={connect} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              Reconnect
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLines([])}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Log output */}
      <ScrollArea
        className="flex-1 bg-zinc-950"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          autoScrollRef.current = atBottom;
        }}
      >
        <div className="p-3 font-mono text-xs text-zinc-300 space-y-0.5 min-h-full">
          {lines.length === 0 ? (
            <span className="text-muted-foreground">
              {status === "connecting" ? "Connecting…" : "No log lines yet."}
            </span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="leading-5 whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

function StatusPill({ status }: { status: ConnStatus }) {
  const config: Record<ConnStatus, { label: string; icon: React.ElementType; className: string }> = {
    connecting: { label: "Connecting", icon: Wifi, className: "text-yellow-400" },
    connected: { label: "Live", icon: Wifi, className: "text-green-400" },
    disconnected: { label: "Disconnected", icon: WifiOff, className: "text-muted-foreground" },
    error: { label: "Error", icon: WifiOff, className: "text-destructive" },
  };
  const { label, icon: Icon, className } = config[status];
  return (
    <Badge variant="outline" className={`gap-1.5 text-xs ${className} border-current`}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}
