import { PDFDocument } from "pdf-lib"
import { BACKEND_API_URL } from "@/lib/backend"
import type { ReviewItem, ReviewResponse, SearchHit, SearchResponse, UserFeedback } from "@/lib/types"

const CHUNK_PARSE_CONCURRENCY = 3
const CHUNK_PARSE_RETRIES = 2

type ParsedPage = {
  page_no: number
  page_text: string
  printed_page_no?: string | null
  markdown?: string | null
  tables?: unknown[]
  headings?: string[]
  visual_notes?: string[]
  parse_warnings?: string[]
  [key: string]: unknown
}

export type ChunkParseProgress = {
  completed: number
  total: number
  currentPage?: number
  startedPage?: number
  failedPage?: number
  failedPages?: number[]
}

export type ParseProgress = {
  completed: number
  total: number
  currentPage?: number | null
  status?: string
}

type ParseJobResponse = {
  job_id: string
  document_id: number | string
  total_pages: number
  status: string
  processed_pages: number
  failed_pages: number
  current_page?: number | null
  error?: string
  is_terminal?: boolean
  document?: ReviewResponse
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withPdfSuffix(name: string, pageNo: number): string {
  const base = name.replace(/\.pdf$/i, "") || "rfp"
  return `${base}_page_${String(pageNo).padStart(4, "0")}.pdf`
}

async function parsePageChunk(
  fileName: string,
  sourcePdf: PDFDocument,
  pageNo: number,
  totalPages: number,
): Promise<ParsedPage> {
  const chunkPdf = await PDFDocument.create()
  const [copiedPage] = await chunkPdf.copyPages(sourcePdf, [pageNo - 1])
  chunkPdf.addPage(copiedPage)
  const chunkBytes = await chunkPdf.save()
  const chunkFile = new Blob([chunkBytes], { type: "application/pdf" })

  const form = new FormData()
  form.append("file", chunkFile, withPdfSuffix(fileName, pageNo))
  form.append("page_numbers", JSON.stringify([pageNo]))
  form.append("total_pages", String(totalPages))

  const res = await fetch(`${BACKEND_API_URL}/api/parse/chunk`, {
    method: "POST",
    body: form,
  })
  const data = await parseJsonResponse<{ pages: ParsedPage[] }>(res, `${pageNo}쪽 파싱에 실패했습니다.`)
  const page = data.pages?.[0]
  if (!page) {
    throw new Error(`${pageNo}쪽 파싱 결과가 비어 있습니다.`)
  }
  return { ...page, page_no: pageNo }
}

async function parsePageChunkWithRetry(
  fileName: string,
  sourcePdf: PDFDocument,
  pageNo: number,
  totalPages: number,
): Promise<ParsedPage> {
  let lastError: unknown
  for (let attempt = 0; attempt <= CHUNK_PARSE_RETRIES; attempt += 1) {
    try {
      return await parsePageChunk(fileName, sourcePdf, pageNo, totalPages)
    } catch (err) {
      lastError = err
      if (attempt < CHUNK_PARSE_RETRIES) {
        await sleep(1000 * (attempt + 1))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${pageNo}쪽 파싱에 실패했습니다.`)
}

function failedParsedPage(pageNo: number, reason: string): ParsedPage {
  const pageText = `[parse_chunk_failed] PDF page ${pageNo} could not be parsed automatically.`
  return {
    page_no: pageNo,
    page_text: pageText,
    text_length: pageText.length,
    rfp_printed_page_no: null,
    has_table_candidate: false,
    has_attachment_candidate: false,
    has_eval_table_candidate: false,
    has_toc_candidate: false,
    has_blind_candidate: false,
    has_commercial_sw_candidate: false,
    parser_warning: `parse_chunk_failed: ${reason}`,
  }
}

export async function parsePdf(file: File, onProgress?: (progress: ParseProgress) => void): Promise<ReviewResponse> {
  const form = new FormData()
  form.append("file", file)

  try {
    const res = await fetch(`${BACKEND_API_URL}/api/parse/jobs`, {
      method: "POST",
      body: form,
    })
    const started = await parseJsonResponse<ParseJobResponse>(res, "PDF parse job creation failed.")
    if (!started.job_id) {
      throw new Error("PDF parse job id was not returned.")
    }

    onProgress?.({
      completed: started.processed_pages || 0,
      total: started.total_pages || 0,
      currentPage: started.current_page,
      status: started.status,
    })

    const deadline = Date.now() + 45 * 60 * 1000
    while (Date.now() < deadline) {
      await sleep(2500)
      const statusRes = await fetch(`${BACKEND_API_URL}/api/parse/jobs/${encodeURIComponent(started.job_id)}`, {
        cache: "no-store",
      })
      const job = await parseJsonResponse<ParseJobResponse>(statusRes, "PDF parse job status check failed.")
      onProgress?.({
        completed: job.processed_pages || 0,
        total: job.total_pages || 0,
        currentPage: job.current_page,
        status: job.status,
      })

      if (job.status === "succeeded") {
        if (!job.document) {
          throw new Error("PDF parsing finished but no document result was returned.")
        }
        return job.document
      }
      if (job.status === "failed" || job.status === "canceled") {
        throw new Error(job.error || "PDF parse job failed.")
      }
    }

    throw new Error("PDF parsing is taking too long. Please try again later.")
  } catch (err) {
    throw parseNetworkError(err, "PDF parse request failed.")
  }
}

export async function parsePdfInBrowserChunks(
  file: File,
  onProgress?: (progress: ChunkParseProgress) => void,
): Promise<ReviewResponse> {
  try {
    const sourceBytes = await file.arrayBuffer()
    const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
    const totalPages = sourcePdf.getPageCount()
    const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
    const pages: ParsedPage[] = []
    const failedPages: number[] = []
    let cursor = 0
    let completed = 0

    async function worker() {
      while (cursor < pageNumbers.length) {
        const pageNo = pageNumbers[cursor]
        cursor += 1
        onProgress?.({ completed, total: totalPages, startedPage: pageNo })
        const page = await parsePageChunk(file.name, sourcePdf, pageNo, totalPages).catch((err) => {
          failedPages.push(pageNo)
          return failedParsedPage(pageNo, err instanceof Error ? err.message : "알 수 없는 파싱 오류")
        })
        pages.push(page)
        completed += 1
        onProgress?.({
          completed,
          total: totalPages,
          currentPage: pageNo,
          failedPage: failedPages.includes(pageNo) ? pageNo : undefined,
          failedPages: [...failedPages].sort((a, b) => a - b),
        })
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CHUNK_PARSE_CONCURRENCY, totalPages) }, () => worker()),
    )

    pages.sort((a, b) => a.page_no - b.page_no)

    const res = await fetch(`${BACKEND_API_URL}/api/parse/import-pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_name: file.name,
        total_pages: totalPages,
        pages,
      }),
    })
    const parsed = await parseJsonResponse<ReviewResponse>(res, "파싱 결과 저장에 실패했습니다.")
    const sortedFailedPages = [...failedPages].sort((a, b) => a - b)
    return {
      ...parsed,
      chunk_parse_summary: {
        total_pages: totalPages,
        successful_pages: totalPages - sortedFailedPages.length,
        failed_pages: sortedFailedPages,
      },
      parse_status: sortedFailedPages.length > 0 ? "warning" : parsed.parse_status,
      parse_needs_user_confirmation:
        sortedFailedPages.length > 0 ? true : parsed.parse_needs_user_confirmation,
    }
  } catch (err) {
    throw parseNetworkError(err, "PDF 병렬 파싱에 실패했습니다.")
  }
}

export async function retryFailedPdfPages(
  file: File,
  documentId: string | number,
  pageNumbers: number[],
  onProgress?: (progress: ChunkParseProgress) => void,
): Promise<ReviewResponse> {
  try {
    const sourceBytes = await file.arrayBuffer()
    const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
    const totalPages = sourcePdf.getPageCount()
    const uniquePageNumbers = [...new Set(pageNumbers)].sort((a, b) => a - b)
    const pages: ParsedPage[] = []
    const failedPages: number[] = []
    let completed = 0

    for (const pageNo of uniquePageNumbers) {
      onProgress?.({ completed, total: uniquePageNumbers.length, startedPage: pageNo })
      const page = await parsePageChunkWithRetry(file.name, sourcePdf, pageNo, totalPages).catch((err) => {
        failedPages.push(pageNo)
        return failedParsedPage(pageNo, err instanceof Error ? err.message : "알 수 없는 파싱 오류")
      })
      pages.push(page)
      completed += 1
      onProgress?.({
        completed,
        total: uniquePageNumbers.length,
        currentPage: pageNo,
        failedPage: failedPages.includes(pageNo) ? pageNo : undefined,
        failedPages: [...failedPages].sort((a, b) => a - b),
      })
    }

    const res = await fetch(`${BACKEND_API_URL}/api/parse/documents/${encodeURIComponent(String(documentId))}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages }),
    })
    const parsed = await parseJsonResponse<ReviewResponse>(res, "실패 페이지 재파싱 결과 저장에 실패했습니다.")
    const sortedFailedPages = [...failedPages].sort((a, b) => a - b)
    return {
      ...parsed,
      chunk_parse_summary: {
        total_pages: parsed.total_pages || totalPages,
        successful_pages: (parsed.total_pages || totalPages) - sortedFailedPages.length,
        failed_pages: sortedFailedPages,
      },
      parse_status: sortedFailedPages.length > 0 ? "warning" : parsed.parse_status,
      parse_needs_user_confirmation:
        sortedFailedPages.length > 0 ? true : parsed.parse_needs_user_confirmation,
    }
  } catch (err) {
    throw parseNetworkError(err, "실패 페이지 재파싱에 실패했습니다.")
  }
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
    detailed_assessment: item.detailed_assessment ?? null,
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
  const parsed = await parsePdf(file)
  return checkReview(String(parsed.document_id), items)
}

export async function searchDocument(documentId: string, q: string): Promise<SearchHit[]> {
  const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/search?q=${encodeURIComponent(q)}`)
  const data = await parseJsonResponse<SearchResponse>(res, "검색 요청에 실패했습니다.")
  return data.results || data.hits || data.matches || []
}
