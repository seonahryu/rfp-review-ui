import { BACKEND_API_URL } from "@/lib/backend"
import { PDFDocument } from "pdf-lib"
import type {
  ReviewItem,
  ReviewResponse,
  SearchHit,
  SearchResponse,
  UserFeedback,
} from "@/lib/types"

const CHUNK_PARSE_CONCURRENCY = 3
const CHUNK_PARSE_RETRIES = 2

type ParsedPage = {
  page_no: number
  page_text: string
  text_length?: number
  rfp_printed_page_no?: number | null
  has_table_candidate?: boolean
  has_attachment_candidate?: boolean
  has_eval_table_candidate?: boolean
  has_toc_candidate?: boolean
  has_blind_candidate?: boolean
  has_commercial_sw_candidate?: boolean
  parser_warning?: string | null
}

type ChunkParseProgress = {
  completed: number
  total: number
  currentPage?: number
  startedPage?: number
  failedPage?: number
}

async function parseJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || `${fallbackMessage} (${res.status})`)
  }
  return data as T
}

function parseNetworkError(err: unknown, fallbackMessage: string): Error {
  if (err instanceof TypeError) {
    return new Error(`${fallbackMessage} 브라우저가 백엔드에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.`)
  }
  return err instanceof Error ? err : new Error(fallbackMessage)
}

export async function parsePdf(file: File): Promise<ReviewResponse> {
  const form = new FormData()
  form.append("file", file)

  try {
    const res = await fetch(`${BACKEND_API_URL}/api/parse`, {
      method: "POST",
      body: form,
    })
    return parseJsonResponse<ReviewResponse>(res, "PDF 파싱 요청에 실패했습니다.")
  } catch (err) {
    throw parseNetworkError(err, "PDF 파싱 요청에 실패했습니다.")
  }
}

export async function parsePdfInBrowserChunks(
  file: File,
  onProgress?: (progress: ChunkParseProgress) => void,
): Promise<ReviewResponse> {
  const sourceBytes = await file.arrayBuffer()
  const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
  const totalPages = sourcePdf.getPageCount()
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
  const pages: ParsedPage[] = []
  let completed = 0
  let cursor = 0

  async function nextPage(): Promise<void> {
    while (cursor < pageNumbers.length) {
      const pageNo = pageNumbers[cursor]
      cursor += 1
      onProgress?.({ completed, total: totalPages, startedPage: pageNo })
      const parsed = await parseSinglePdfPageWithRetry(sourcePdf, file.name, pageNo)
      pages.push(parsed)
      completed += 1
      onProgress?.({ completed, total: totalPages, currentPage: pageNo })
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_PARSE_CONCURRENCY, pageNumbers.length) }, () => nextPage()),
  )

  pages.sort((a, b) => a.page_no - b.page_no)
  return importParsedPages(file.name, totalPages, pages)
}

async function parseSinglePdfPageWithRetry(sourcePdf: PDFDocument, fileName: string, pageNo: number): Promise<ParsedPage> {
  let lastError: unknown
  for (let attempt = 0; attempt <= CHUNK_PARSE_RETRIES; attempt += 1) {
    try {
      return await parseSinglePdfPage(sourcePdf, fileName, pageNo)
    } catch (err) {
      lastError = err
      if (attempt < CHUNK_PARSE_RETRIES) {
        await wait(1000 * (attempt + 1))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`PDF ${pageNo}쪽 파싱에 실패했습니다.`)
}

async function parseSinglePdfPage(sourcePdf: PDFDocument, fileName: string, pageNo: number): Promise<ParsedPage> {
  const chunkPdf = await PDFDocument.create()
  const [copiedPage] = await chunkPdf.copyPages(sourcePdf, [pageNo - 1])
  chunkPdf.addPage(copiedPage)
  const chunkBytes = await chunkPdf.save()
  const blob = new Blob([chunkBytes], { type: "application/pdf" })
  const form = new FormData()
  form.append("page_numbers", JSON.stringify([pageNo]))
  form.append("file", blob, `${stripPdfExtension(fileName)}_page_${String(pageNo).padStart(4, "0")}.pdf`)

  const res = await fetch(`${BACKEND_API_URL}/api/parse/chunk`, {
    method: "POST",
    body: form,
  })
  const data = await parseJsonResponse<{ pages?: ParsedPage[] }>(res, `PDF ${pageNo}쪽 파싱에 실패했습니다.`)
  const page = data.pages?.[0]
  if (!page || Number(page.page_no) !== pageNo) {
    throw new Error(`PDF ${pageNo}쪽 파싱 응답이 올바르지 않습니다.`)
  }
  return page
}

async function importParsedPages(
  documentName: string,
  totalPages: number,
  pages: ParsedPage[],
): Promise<ReviewResponse> {
  const res = await fetch(`${BACKEND_API_URL}/api/parse/import-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_name: documentName,
      total_pages: totalPages,
      pages,
    }),
  })
  return parseJsonResponse<ReviewResponse>(res, "파싱 결과 등록에 실패했습니다.")
}

function stripPdfExtension(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "")
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export async function checkReview(documentId: string, items: string): Promise<ReviewResponse> {
  const body = JSON.stringify({
    document_id: Number(documentId),
    items: items.trim() || null,
  })

  try {
    const res = await fetch(`${BACKEND_API_URL}/api/review/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    return parseJsonResponse<ReviewResponse>(res, "검토 요청에 실패했습니다.")
  } catch (err) {
    try {
      const fallback = await fetch("/api/review/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      return parseJsonResponse<ReviewResponse>(fallback, "검토 요청에 실패했습니다.")
    } catch (fallbackErr) {
      throw parseNetworkError(fallbackErr || err, "검토 요청에 실패했습니다.")
    }
  }
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

  const res = await fetch("/api/recommendations", {
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
  const parsed = await parsePdfInBrowserChunks(file)
  return checkReview(String(parsed.document_id), items)
}

export async function searchDocument(documentId: string, q: string): Promise<SearchHit[]> {
  const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/search?q=${encodeURIComponent(q)}`)
  const data = await parseJsonResponse<SearchResponse>(res, "검색 요청에 실패했습니다.")
  return data.results || data.hits || data.matches || []
}
