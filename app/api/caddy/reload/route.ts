import { NextResponse } from "next/server";
import { reloadCaddy } from "@/lib/caddyfile";

export async function POST() {
  try {
    await reloadCaddy();
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
