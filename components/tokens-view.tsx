"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { TokenRecord } from "@/lib/tokens";

type TokenView = Omit<TokenRecord, "hash">;

const noSubscribe = () => () => {};

async function fetchTokens(): Promise<TokenView[]> {
  const res = await fetch("/api/tokens");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.tokens;
}

export function TokensView() {
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [name, setName] = useState("openchamber");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Only sets state from promise callbacks, so it's safe to call from an effect
  const refresh = useCallback(() => {
    fetchTokens().then(setTokens, (err: Error) => setError(err.message));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, scope }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCreated({ token: data.token, name: data.record.name });
      setCopied(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    refresh();
  };

  // "" on the server, the real origin in the browser, without a hydration mismatch
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const config = `"mcp": {
  "servers": {
    "caddy": {
      "type": "remote",
      "url": "${origin}/api/mcp",
      "oauth": false,
      "protocol": "auto",
      "headers": { "Authorization": "Bearer {env:CADDY_MCP_TOKEN}" }
    }
  }
}`;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0 h-[52px]">
        <span className="text-sm font-medium">MCP tokens</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6 max-w-3xl">
          <p className="text-sm text-muted-foreground">
            Agents connect to <code className="text-foreground">{origin}/api/mcp</code> with one of these tokens. <b>read</b> tokens can
            read, list, validate and check domains; <b>write</b> tokens can also propose changes and apply them once you approve.
          </p>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">New token</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="token-name">Name</Label>
                <Input id="token-name" value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="token-scope">Scope</Label>
                <select id="token-scope" value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="write">write</option>
                  <option value="read">read</option>
                </select>
              </div>
              <Button onClick={create} disabled={busy || !name.trim()} className="gap-1.5">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {created && (
              <div className="space-y-3 rounded-md bg-zinc-950 p-3">
                <p className="text-xs text-yellow-300">Copy this token for &ldquo;{created.name}&rdquo; now. It is not shown again.</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs break-all flex-1">{created.token}</code>
                  <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => navigator.clipboard.writeText(created.token).then(() => setCopied(true))}>
                    <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Set it as <code>CADDY_MCP_TOKEN</code> in the environment OpenChamber runs in, and add this to your OpenCode config
                  (<code>~/.config/opencode/opencode.jsonc</code>):
                </p>
                <pre className="text-xs text-zinc-300 overflow-auto">{config}</pre>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Tokens</h2>
            {tokens.length === 0 && <p className="text-xs text-muted-foreground">No tokens yet.</p>}
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <span className="text-sm">{t.name}</span>
                <Badge variant="outline" className={t.scope === "write" ? "text-yellow-400 border-yellow-400/40" : ""}>{t.scope}</Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  created {new Date(t.createdAt).toLocaleDateString()} · {t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleString()}` : "never used"}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" aria-label={`Revoke ${t.name}`}><Trash2 className="size-3.5" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke &ldquo;{t.name}&rdquo;?</AlertDialogTitle>
                      <AlertDialogDescription>Agents using this token lose access immediately.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => revoke(t.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Revoke</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
