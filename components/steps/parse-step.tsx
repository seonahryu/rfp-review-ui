"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { StepHeader } from "@/components/step-header"
import type { ReviewResponse } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ParseStep({
  response,
  confirmed,
  onConfirm,
  onReset,
}: {
  response: ReviewResponse
  confirmed: boolean
  onConfirm: () => void
  onReset: () => void
}) {
  const [note, setNote] = useState("")
  const warnings = response.audit_warnings ?? []
  const needsAttention = response.parse_needs_user_confirmation === true
  const score = response.audit_score
  const lowScore = typeof score === "number" && score < 0.7
  const hasProblem = needsAttention || warnings.length > 0 || lowScore

  const scorePct = typeof score === "number" ? Math.round((score <= 1 ? score * 100 : score)) : null

  return (
    <div>
      <StepHeader
        step={2}
        title="PDF 파싱 검증"
        description="파싱 상태와 신뢰도를 확인한 뒤 다음 단계로 진행합니다."
        actions={
          <Button variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
            <RotateCcw className="size-3.5" />
            처음부터
          </Button>
        }
      />
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border p-4",
            needsAttention || lowScore
              ? "border-status-attention/40 bg-status-attention-bg"
              : "border-status-compliant/30 bg-status-compliant-bg",
          )}
        >
          {needsAttention || lowScore ? (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-status-attention" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-status-compliant" />
          )}
          <div>
            <p className="text-sm font-semibold text-foreground">
              {needsAttention || lowScore
                ? "파싱 결과에 사용자 확인이 필요합니다."
                : "파싱이 정상적으로 완료되었습니다."}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {needsAttention || lowScore
                ? "신뢰도가 낮거나 경고가 있습니다. 아래 내용을 확인하세요."
                : "특이 사항 없이 문서가 처리되었습니다."}
            </p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs font-medium text-muted-foreground">파싱 상태 (parse_status)</dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {response.parse_status ?? "-"}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs font-medium text-muted-foreground">감사 점수 (audit_score)</dt>
            <dd
              className={cn(
                "mt-1 text-sm font-semibold",
                lowScore ? "text-status-attention" : "text-foreground",
              )}
            >
              {scorePct !== null ? `${scorePct}%` : "-"}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs font-medium text-muted-foreground">문서 ID</dt>
            <dd className="mt-1 truncate font-mono text-xs text-foreground">
              {response.document_id}
            </dd>
          </div>
        </dl>

        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            감사 경고 (audit_warnings)
            <span className="ml-2 text-xs text-muted-foreground">{warnings.length}건</span>
          </p>
          {warnings.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-status-attention/30 bg-status-attention-bg px-3 py-2 text-sm text-foreground"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-attention" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">경고가 없습니다.</p>
          )}
        </div>

        {hasProblem && (
          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <Label htmlFor="parse-note" className="text-sm font-medium">
              수정 의견 입력
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              파싱 결과에 문제가 있다고 판단되면 확인 내용을 기록해 두세요.
            </p>
            <Textarea
              id="parse-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 12페이지 표가 누락된 것으로 보입니다."
              className="mt-2 min-h-24"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          {confirmed && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-sm text-status-compliant">
              <CheckCircle2 className="size-4" /> 확인 완료됨
            </span>
          )}
          <Button onClick={onConfirm} className="gap-1.5">
            <CheckCircle2 className="size-4" />
            파싱 결과 확인 완료
          </Button>
        </div>
      </div>
    </div>
  )
}
