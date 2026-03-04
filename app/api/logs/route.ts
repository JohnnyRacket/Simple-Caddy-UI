import { spawnStream } from "@/lib/exec";

export const dynamic = "force-dynamic";

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let proc: ReturnType<typeof spawnStream> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      proc = spawnStream("journalctl", [
        "-u", "caddy",
        "-f",
        "--no-pager",
        "-o", "short-iso",
      ]);

      const enc = new TextEncoder();

      proc.stdout?.on("data", (chunk: Buffer) => {
        chunk
          .toString()
          .split("\n")
          .filter(Boolean)
          .forEach((line: string) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ line })}\n\n`));
          });
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) {
          controller.enqueue(
            enc.encode(`data: ${JSON.stringify({ line: `[stderr] ${line}` })}\n\n`),
          );
        }
      });

      proc.on("close", () => {
        try { controller.close(); } catch { /* already closed */ }
      });

      proc.on("error", (err: Error) => {
        const msg = err.message.includes("ENOENT")
          ? "journalctl not found — is this a systemd system?"
          : err.message;
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ line: `[error] ${msg}` })}\n\n`),
        );
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      proc?.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
