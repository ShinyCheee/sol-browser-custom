// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/motion/button/base";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { isAnswered, ProgressDots } from "./parts";
import type { ApprovalCardAnswer } from "./types";

export function ApprovalActions({
  questionMode,
  multipleQuestions,
  lastQuestion,
  busy,
  reduce,
  currentStep,
  questionIds,
  currentAnswer,
  approveLabel,
  rejectLabel,
  submitLabel,
  onPrevStep,
  onContinue,
  onApprove,
  onRequestChanges,
  onReject,
}: {
  questionMode: boolean;
  multipleQuestions: boolean;
  lastQuestion: boolean;
  busy: boolean;
  reduce: boolean;
  currentStep: number;
  questionIds: string[];
  currentAnswer: ApprovalCardAnswer;
  approveLabel: ReactNode;
  rejectLabel: ReactNode;
  submitLabel: ReactNode;
  onPrevStep: () => void;
  onContinue: () => void;
  onApprove?: () => void;
  onRequestChanges?: () => void;
  onReject?: () => void;
}) {
  if (questionMode) {
    const submitAriaLabel =
      typeof submitLabel === "string"
        ? submitLabel
        : t("Envoyer la réponse", "Submit response");

    return (
      <div className="mt-4 flex items-center gap-3">
        {multipleQuestions ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Question précédente", "Previous question")}
              disabled={busy || currentStep === 0}
              onClick={onPrevStep}
              className="rounded-full"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <ProgressDots current={currentStep} ids={questionIds} />
          </>
        ) : null}
        <Button
          size={lastQuestion ? "sm" : "icon"}
          aria-label={
            lastQuestion
              ? submitAriaLabel
              : t("Question suivante", "Next question")
          }
          disabled={busy || !isAnswered(currentAnswer)}
          onClick={onContinue}
          className="ml-auto rounded-full"
        >
          {busy ? (
            <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
          ) : lastQuestion ? (
            <>
              {submitLabel}
              <ArrowRight className="size-3.5" />
            </>
          ) : (
            <ArrowRight className="size-4" />
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy} onClick={onApprove} className="rounded-full sol-approve">
        {approveLabel}
      </Button>
      {onRequestChanges ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onRequestChanges} className="rounded-full">
          {t("Demander des modifications", "Request changes")}
        </Button>
      ) : null}
      {onReject ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onReject}
          className="rounded-full sol-reject text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
        >
          {rejectLabel}
        </Button>
      ) : null}
    </div>
  );
}
