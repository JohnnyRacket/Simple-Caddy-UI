import { cn } from "@/lib/utils";

/** A unified diff, colored by line. Skips the file header lines. */
export function DiffView({ diff, className }: { diff: string; className?: string }) {
  const lines = diff.split("\n").filter((l) => !/^(={3,}|-{3} |\+{3} |Index: )/.test(l));
  return (
    <pre className={cn("text-xs font-mono bg-zinc-950 rounded-md p-3 overflow-auto max-h-96 leading-5", className)}>
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre",
            l.startsWith("+") && "bg-green-950/60 text-green-300",
            l.startsWith("-") && "bg-red-950/60 text-red-300",
            l.startsWith("@@") && "text-sky-400 mt-2 first:mt-0",
            !/^[+\-@]/.test(l) && "text-zinc-400",
          )}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}
