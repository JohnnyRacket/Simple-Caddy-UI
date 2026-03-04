import { NextResponse } from "next/server";
import { validateCaddyfile } from "@/lib/caddyfile";

export async function POST() {
  try {
    const result = await validateCaddyfile();
    if (!result.ok) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
