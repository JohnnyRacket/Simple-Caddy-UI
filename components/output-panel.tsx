"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface OutputPanelProps {
  output: string | null;
  ok: boolean | null;
  onClear: () => void;
}

export function OutputPanel({ output, ok, onClear }: OutputPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!output) return null;

  return (
    <div className="shrink-0 border-t border-border bg-zinc-950 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card">
        <span
          className={cn(
            "text-xs font-medium",
            ok === true
              ? "text-green-400"
              : ok === false
                ? "text-red-400"
                : "text-muted-foreground",
          )}
        >
          {ok === true ? "Valid" : ok === false ? "Invalid" : "Output"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
          <button
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded"
            aria-label="Clear output"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {!collapsed && (
        <pre className="text-xs font-mono text-zinc-300 p-3 overflow-auto max-h-48 whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}
