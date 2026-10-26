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
  title?: string;
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

async function fetchCaddyfile(): Promise<{ content: string; etag: string }> {
  const res = await fetch("/api/caddyfile");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to load Caddyfile");
  return data;
}

export function EditorShell() {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  // Version the editor's content is based on; saves against a newer file are refused
  const [etag, setEtag] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [output, setOutput] = useState<OutputState>({ text: null, ok: null });

  const save = useActionStatus();
  const reload = useActionStatus();
  const validate = useActionStatus();
  const format = useActionStatus();

  // Only sets state from promise callbacks, so it's safe to call from an effect
  const applyLoad = useCallback((result: Promise<{ content: string; etag: string }>) => {
    result
      .then(
        (data) => {
          setContent(data.content);
          setSavedContent(data.content);
          setEtag(data.etag);
          setLoadError(null);
        },
        (err: unknown) => setLoadError((err as Error).message),
      )
      .finally(() => setLoading(false));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    applyLoad(fetchCaddyfile());
  }, [applyLoad]);

  useEffect(() => { applyLoad(fetchCaddyfile()); }, [applyLoad]);

  const handleSave = useCallback(() => {
    save.run(async () => {
      const res = await fetch("/api/caddyfile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, etag }),
      });
      const data = await res.json();
      if (!res.ok) {
        const text =
          res.status === 409
            ? "The Caddyfile changed since you opened it (another save, or an MCP change). Copy your edits, reload the page, and reapply them."
            : (data.message ?? data.error ?? "Save failed");
        setOutput({ text, ok: false, title: "Save failed" });
        throw new Error(text);
      }
      setSavedContent(content);
      setEtag(data.etag);
      setOutput({ text: data.message, ok: true, title: "Saved" });
    });
  }, [content, etag, save]);

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
      const res = await fetch("/api/caddy/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      setOutput({ text: data.output ?? data.error ?? "", ok: data.ok ?? false });
      if (!data.ok) throw new Error(data.output);
    });
  }, [content, validate]);

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
        title={output.title}
        onClear={() => setOutput({ text: null, ok: null })}
      />
    </div>
  );
}
