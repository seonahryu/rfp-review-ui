import type { ReviewResponse, SearchHit, SearchResponse } from "@/lib/types"

export async function submitReview(file: File, items: string): Promise<ReviewResponse> {
  const form = new FormData()
  form.append("file", file)
  if (items.trim()) form.append("items", items.trim())

  const res = await fetch("/api/review", { method: "POST", body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error || `검토 요청이 실패했습니다. (${res.status})`)
  }
  return data as ReviewResponse
}

export async function searchDocument(documentId: string, q: string): Promise<SearchHit[]> {
  const res = await fetch(
    `/api/documents/${encodeURIComponent(documentId)}/search?q=${encodeURIComponent(q)}`,
  )
  const data: SearchResponse & { error?: string } = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error || `검색 요청이 실패했습니다. (${res.status})`)
  }
  return data.results || data.hits || data.matches || []
}
