import { BACKEND_API_URL } from "@/lib/backend"
import type {
  ParseJobStartResponse,
  ParseJobStatusResponse,
  ReviewItem,
  ReviewResponse,
  SearchHit,
  SearchResponse,
  UserFeedback,
} from "@/lib/types"

async function parseJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || `${fallbackMessage} (${res.status})`)
  }
  return data as T
}

export async function parsePdf(file: File): Promise<ReviewResponse> {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch(`${BACKEND_API_URL}/api/parse/start`, {
    method: "POST",
    body: form,
  })
  const started = await parseJsonResponse<ParseJobStartResponse>(res, "PDF 파싱 시작 요청에 실패했습니다.")
  return pollParseJob(started.job_id)
}

async function pollParseJob(jobId: string): Promise<ReviewResponse> {
  const deadline = Date.now() + 45 * 60 * 1000

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const res = await fetch(`${BACKEND_API_URL}/api/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    })
    const job = await parseJsonResponse<ParseJobStatusResponse>(res, "PDF 파싱 상태 확인에 실패했습니다.")
    if (job.status === "succeeded" && job.result) return job.result
    if (job.status === "failed") throw new Error(job.error || "PDF 파싱 작업이 실패했습니다.")
  }

  throw new Error("PDF 파싱 시간이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.")
}

export async function checkReview(documentId: string, items: string): Promise<ReviewResponse> {
  const res = await fetch(`${BACKEND_API_URL}/api/review/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: Number(documentId),
      items: items.trim() || null,
    }),
  })
  return parseJsonResponse<ReviewResponse>(res, "검토 요청에 실패했습니다.")
}

export async function generateRecommendations(
  documentId: string,
  results: ReviewItem[],
  feedback: Record<string, UserFeedback>,
): Promise<ReviewResponse> {
  const payloadResults = results.map((item) => ({
    item_no: String(item.item_no),
    review_result: item.review_result || "",
    normalized_result: item.normalized_result || "",
    final_status: item.final_status || "",
    is_target: item.is_target ?? null,
    confidence: item.confidence || 0,
    reason: item.reason || "",
    recommendation: item.recommendation || "",
    evidence_pages: item.evidence_pages || [],
    evidence_text: item.evidence_text || [],
    user_feedback: feedback[String(item.item_no)] || item.user_feedback || null,
  }))

  const res = await fetch(`${BACKEND_API_URL}/api/recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: Number(documentId),
      results: payloadResults,
    }),
  })
  return parseJsonResponse<ReviewResponse>(res, "권고 문장 생성 요청에 실패했습니다.")
}

export async function submitReview(file: File, items: string): Promise<ReviewResponse> {
  const parsed = await parsePdf(file)
  return checkReview(String(parsed.document_id), items)
}

export async function searchDocument(documentId: string, q: string): Promise<SearchHit[]> {
  const res = await fetch(
    `${BACKEND_API_URL}/api/documents/${encodeURIComponent(documentId)}/search?q=${encodeURIComponent(q)}`,
  )
  const data = await parseJsonResponse<SearchResponse>(res, "검색 요청에 실패했습니다.")
  return data.results || data.hits || data.matches || []
}
