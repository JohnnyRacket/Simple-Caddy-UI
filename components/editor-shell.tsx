"use client";
import { useCallback, useEffect, useState } from "react";
import { CaddyfileEditor } from "./caddyfile-editor";
import { EditorToolbar, ActionStatus } from "./editor-toolbar";
import { OutputPanel } from "./output-panel";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

interface OutputState {
  text: string | null;
  ok: boolean | null;
}

function useActionStatus() {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const run = useCallback(async (fn: () => Promise<void>) => {
    setStatus("loading");
    try {
      await fn();
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    }
  }, []);
  return { status, run };
}

export function EditorShell() {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [output, setOutput] = useState<OutputState>({ text: null, ok: null });

  const save = useActionStatus();
  const reload = useActionStatus();
  const validate = useActionStatus();
  const format = useActionStatus();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/caddyfile");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load Caddyfile");
      setContent(data.content);
      setSavedContent(data.content);
    } catch (err: unknown) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(() => {
    save.run(async () => {
      const res = await fetch("/api/caddyfile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOutput({ text: data.error ?? "Save failed", ok: false });
        throw new Error(data.error);
      }
      setSavedContent(content);
    });
  }, [content, save]);

  const handleReload = useCallback(() => {
    reload.run(async () => {
      const res = await fetch("/api/caddy/reload", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setOutput({ text: data.error ?? "Reload failed", ok: false });
        throw new Error(data.error);
      }
    });
  }, [reload]);

  const handleValidate = useCallback(() => {
    validate.run(async () => {
      const res = await fetch("/api/caddy/validate", { method: "POST" });
      const data = await res.json();
      setOutput({ text: data.output ?? data.error ?? "", ok: data.ok ?? false });
      if (!data.ok) throw new Error(data.output);
    });
  }, [validate]);

  const handleFormat = useCallback(() => {
    format.run(async () => {
      const res = await fetch("/api/caddy/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOutput({ text: data.error ?? "Format failed", ok: false });
        throw new Error(data.error);
      }
      if (data.content) setContent(data.content);
    });
  }, [content, format]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading Caddyfile…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="text-sm font-medium text-destructive">Failed to load Caddyfile</p>
        <pre className="text-xs bg-muted rounded p-3 max-w-lg overflow-auto text-muted-foreground">
          {loadError}
        </pre>
        <Button variant="secondary" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <EditorToolbar
        onSave={handleSave}
        onReload={handleReload}
        onValidate={handleValidate}
        onFormat={handleFormat}
        saveStatus={save.status}
        reloadStatus={reload.status}
        validateStatus={validate.status}
        formatStatus={format.status}
        dirty={content !== savedContent}
      />
      <div className="flex-1 overflow-hidden">
        <CaddyfileEditor value={content} onChange={setContent} />
      </div>
      <OutputPanel
        output={output.text}
        ok={output.ok}
        onClear={() => setOutput({ text: null, ok: null })}
      />
    </div>
  );
}
