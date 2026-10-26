"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { DiffView } from "@/components/diff-view";
import type { Proposal } from "@/lib/proposals";
import type { HistoryEntry } from "@/lib/history";
import { cn } from "@/lib/utils";

type ProposalView = Omit<Proposal, "content">;

const actorText = (a: HistoryEntry["actor"]) => (a.kind === "ui" ? "UI" : `${a.tokenName} (MCP)`);
const when = (iso: string) => new Date(iso).toLocaleString();

const OUTCOME_STYLE: Record<string, string> = {
  applied: "text-green-400 border-green-400/40",
  noop: "text-muted-foreground",
  rolled_back: "text-yellow-400 border-yellow-400/40",
  invalid: "text-red-400 border-red-400/40",
  conflict: "text-red-400 border-red-400/40",
  failed: "text-red-400 border-red-400/40",
  pending: "text-sky-400 border-sky-400/40",
  approved: "text-sky-400 border-sky-400/40",
  rejected: "text-muted-foreground",
  expired: "text-muted-foreground",
};

function Sites({ a }: { a: { added: string[]; removed: string[]; changed: string[] } }) {
  const parts = [
    ...a.added.map((h) => ["+", h, "text-green-400"]),
    ...a.removed.map((h) => ["−", h, "text-red-400"]),
    ...a.changed.map((h) => ["~", h, "text-yellow-400"]),
  ];
  if (!parts.length) return <span className="text-xs text-muted-foreground">No site routes change</span>;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-mono">
      {parts.map(([sign, h, cls]) => (
        <span key={sign + h} className={cls}>{sign} {h}</span>
      ))}
    </div>
  );
}

function Risks({ risks }: { risks: { code: string; message: string }[] }) {
  if (!risks.length) return null;
  return (
    <ul className="space-y-1">
      {risks.map((r) => (
        <li key={r.code + r.message} className="flex gap-2 text-xs text-yellow-300">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> {r.message}
        </li>
      ))}
    </ul>
  );
}

async function loadChanges(): Promise<{ proposals: ProposalView[]; history: HistoryEntry[] }> {
  const res = await fetch("/api/changes");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

export function ChangesView() {
  const highlight = useSearchParams().get("proposal");
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Only sets state from promise callbacks, so it's safe to call from an effect
  const fetchChanges = useCallback(() => {
    loadChanges().then(
      (data) => {
        setProposals(data.proposals);
        setHistory(data.history);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, []);

  useEffect(() => {
    fetchChanges();
    const t = setInterval(fetchChanges, 5000); // agents add proposals while the page is open
    return () => clearInterval(t);
  }, [fetchChanges]);

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const act = async (key: string, url: string, body?: unknown) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const data = await res.json();
      const message = data.result?.message ?? data.message ?? data.error ?? (res.ok ? "Done" : "Failed");
      setNotice({ ok: res.ok, text: message });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
      fetchChanges();
    }
  };

  const pending = proposals.filter((p) => p.status === "pending");
  const decided = proposals.filter((p) => p.status !== "pending").slice(0, 10);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0 h-[52px]">
        <span className="text-sm font-medium">Changes</span>
        {pending.length > 0 && <Badge variant="outline" className="text-sky-400 border-sky-400/40">{pending.length} awaiting approval</Badge>}
        <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={fetchChanges}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6 max-w-5xl">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && (
            <pre className={cn("text-xs whitespace-pre-wrap rounded-md p-3", notice.ok ? "bg-green-950/40 text-green-300" : "bg-red-950/40 text-red-300")}>{notice.text}</pre>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Awaiting approval</h2>
            {pending.length === 0 && <p className="text-xs text-muted-foreground">No proposals waiting. Agents propose changes through the MCP; they show up here.</p>}
            {pending.map((p) => (
              <div key={p.id} id={p.id} className={cn("rounded-lg border bg-card p-4 space-y-3", p.id === highlight ? "border-sky-400/60" : "border-border")}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{p.summary}</span>
                  <span className="text-xs text-muted-foreground">by {actorText(p.actor)} · {when(p.createdAt)} · expires {new Date(p.expiresAt).toLocaleTimeString()}</span>
                </div>
                <Sites a={p.analysis} />
                <Risks risks={p.analysis.risks} />
                <DiffView diff={p.analysis.diff} />
                <div className="flex gap-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" className="gap-1.5" disabled={busy !== null}>
                        {busy === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve & apply
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Apply this change to the live Caddyfile?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {p.summary}. It is validated, written and reloaded; if the reload fails or an untouched site starts answering differently, the previous Caddyfile is restored.
                          {p.analysis.risks.length > 0 && ` ${p.analysis.risks.length} risk flag(s) above.`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => act(p.id, `/api/proposals/${p.id}`, { decision: "approve" })}>Apply</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button size="sm" variant="secondary" className="gap-1.5" disabled={busy !== null} onClick={() => act(p.id + ":r", `/api/proposals/${p.id}`, { decision: "reject" })}>
                    <X className="size-3.5" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </section>

          {decided.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Recent proposals</h2>
              {decided.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className={OUTCOME_STYLE[p.status]}>{p.status}</Badge>
                  <span>{p.summary}</span>
                  <span className="text-muted-foreground">by {actorText(p.actor)} · {when(p.createdAt)}{p.decidedVia ? ` · decided in ${p.decidedVia === "ui" ? "the UI" : "chat"}` : ""}</span>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">History</h2>
            {history.length === 0 && <p className="text-xs text-muted-foreground">No changes recorded yet.</p>}
            {history.map((e) => (
              <div key={e.id} className="rounded-md border border-border bg-card">
                <button className="w-full flex flex-wrap items-center gap-2 p-3 text-left" onClick={() => toggle(e.id)}>
                  {open.has(e.id) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  <Badge variant="outline" className={OUTCOME_STYLE[e.outcome]}>{e.outcome.replace("_", " ")}</Badge>
                  <span className="text-sm">{e.summary}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{actorText(e.actor)} · {when(e.at)}</span>
                </button>
                {open.has(e.id) && (
                  <div className="px-3 pb-3 space-y-3">
                    <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{e.message}</pre>
                    {e.analysis && <Sites a={e.analysis} />}
                    {e.analysis && <Risks risks={e.analysis.risks} />}
                    {e.analysis && <DiffView diff={e.analysis.diff} />}
                    {e.health && e.health.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Health check: {e.health.length} untouched site(s)</summary>
                        <table className="mt-2 font-mono">
                          <tbody>
                            {e.health.map((h) => (
                              <tr key={h.host} className={h.before === h.after ? "text-muted-foreground" : "text-red-300"}>
                                <td className="pr-4">{h.host}</td><td className="pr-4">{h.before}</td><td>{h.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    )}
                    {e.outcome === "applied" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="secondary" className="gap-1.5" disabled={busy !== null}>
                            {busy === e.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Restore the version before this
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Restore the Caddyfile from before this change?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This undoes &ldquo;{e.summary}&rdquo; and every change made after it. It goes through the same validate, reload and health check as any save.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => act(e.id, `/api/history/${e.id}/rollback`)}>Restore</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
