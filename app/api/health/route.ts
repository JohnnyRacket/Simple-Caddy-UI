import { NextResponse } from "next/server";
import pkg from "@/package.json";

export const dynamic = "force-dynamic";

// Lets deploys (and tooling) confirm exactly which build is serving
export async function GET() {
  return NextResponse.json({
    ok: true,
    version: pkg.version,
    commit: process.env.GIT_COMMIT ?? "unknown",
  });
}
