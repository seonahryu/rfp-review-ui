import { NextResponse } from "next/server"
import { BACKEND_API_URL } from "@/lib/backend"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null)
    if (!payload || typeof payload.document_id !== "number" || !Array.isArray(payload.results)) {
      return NextResponse.json({ error: "document_id와 results가 필요합니다." }, { status: 400 })
    }

    const res = await fetch(`${BACKEND_API_URL}/api/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const text = await res.text()

    if (!res.ok) {
      return NextResponse.json(
        { error: `권고 문장 생성 요청이 실패했습니다. (${res.status})`, detail: text.slice(0, 2000) },
        { status: res.status },
      )
    }

    try {
      return NextResponse.json(JSON.parse(text))
    } catch {
      return NextResponse.json(
        { error: "권고 문장 생성 응답을 해석할 수 없습니다.", detail: text.slice(0, 2000) },
        { status: 502 },
      )
    }
  } catch (err) {
    return NextResponse.json(
      { error: "권고 문장 생성 중 오류가 발생했습니다.", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
