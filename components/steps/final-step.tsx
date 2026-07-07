"use client"

import { CheckCircle2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StepHeader } from "@/components/step-header"
import { StatusBadge } from "@/components/status-badge"
import { CopyButton } from "@/components/copy-button"
import { normalizeStatus, type ReviewItem, type ReviewResponse } from "@/lib/types"

export function FinalStep({
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
  const results = response.results ?? []
  const targets = results.filter((r: ReviewItem) => r.is_target !== false)
  const opinion = response.review_opinion

  return (
    <div>
      <StepHeader
        step={6}
        title="최종 결과"
        description="HWP 표에 붙여넣기 쉽도록 구성된 최종 검토 결과입니다."
        actions={
          <>
            <CopyButton
              label="전체 검토결과 복사"
              text={response.review_result_column_text}
              variant="secondary"
            />
            <CopyButton label="검토의견 전체 복사" text={opinion?.copy_text} variant="secondary" />
            <Button variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
              <RotateCcw className="size-3.5" />
              새 검토
            </Button>
          </>
        }
      />
      <div className="mx-auto max-w-5xl px-8 py-6">
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">전체 검토결과 복사</span>는 HWP 표의 “법령준수 여부” 열에
            줄 단위로 붙여넣을 수 있습니다.
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-xs text-muted-foreground">
                <th className="w-12 border-r border-border px-3 py-2.5 font-medium">번호</th>
                <th className="border-r border-border px-3 py-2.5 font-medium">
                  법령준수 개선권고 주요항목
                </th>
                <th className="w-28 border-r border-border px-3 py-2.5 font-medium">법령준수 여부</th>
                <th className="border-r border-border px-3 py-2.5 font-medium">
                  개선권고 관련 법적 근거
                </th>
                <th className="w-40 px-3 py-2.5 font-medium">복사</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((item) => {
                const status = normalizeStatus(item)
                const legalBasis =
                  (item.evidence_pairs && item.evidence_pairs.length > 0
                    ? item.evidence_pairs.map((p) => `p.${p.page}: ${p.text}`).join("\n")
                    : item.evidence_text) || "-"
                return (
                  <tr key={String(item.item_no)} className="border-b border-border align-top last:border-0">
                    <td className="border-r border-border px-3 py-3 font-mono text-xs text-muted-foreground">
                      {item.item_no}
                    </td>
                    <td className="border-r border-border px-3 py-3">
                      <p className="font-medium text-foreground">{item.law_name}</p>
                      {item.compliance_content && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                          {item.compliance_content}
                        </p>
                      )}
                    </td>
                    <td className="border-r border-border px-3 py-3">
                      <StatusBadge status={status} />
                    </td>
                    <td className="border-r border-border px-3 py-3">
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                        {legalBasis}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1.5">
                        <CopyButton
                          label="검토결과 복사"
                          text={item.copy_texts?.review_result ?? item.normalized_result}
                        />
                        <CopyButton
                          label="권고내용 복사"
                          text={item.copy_texts?.compliance_content ?? item.compliance_content}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <section className="mt-6 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">검토의견</h3>
            <CopyButton label="검토의견 전체 복사" text={opinion?.copy_text} />
          </div>
          {opinion && (
            <p className="mt-2 text-xs text-muted-foreground">
              총 {opinion.total_count ?? targets.length}개 항목 중 {opinion.non_compliant_count ?? 0}개 항목 미준수 및{" "}
              {opinion.needs_revision_count ?? 0}개 항목 보완 권고
            </p>
          )}
          <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-4 font-sans text-sm leading-relaxed text-foreground">
            {opinion?.copy_text?.trim() || "검토의견이 없습니다."}
          </pre>
        </section>

        <div className="mt-6 flex items-center justify-end gap-3">
          {confirmed && (
            <span className="inline-flex items-center gap-1.5 text-sm text-status-compliant">
              <CheckCircle2 className="size-4" /> 최종 결과 확인 완료
            </span>
          )}
          <Button onClick={onConfirm} className="gap-1.5">
            <CheckCircle2 className="size-4" />
            최종 결과 확인 컨펌
          </Button>
        </div>
      </div>
    </div>
  )
}
