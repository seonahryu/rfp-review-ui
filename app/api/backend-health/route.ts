import { NextResponse } from "next/server"
import { BACKEND_API_URL } from "@/lib/backend"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const startedAt = Date.now()

  try {
    const res = await fetch(`${BACKEND_API_URL}/health`, {
      cache: "no-store",
    })
    const text = await res.text()

    return NextResponse.json({
      backendUrl: BACKEND_API_URL,
      ok: res.ok,
      status: res.status,
      elapsedMs: Date.now() - startedAt,
      body: text.slice(0, 1000),
    })
  } catch (err) {
    return NextResponse.json(
      {
        backendUrl: BACKEND_API_URL,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    )
  }
}
