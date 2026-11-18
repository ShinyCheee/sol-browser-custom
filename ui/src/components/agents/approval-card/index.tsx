// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.
import { Check, CircleHelp, LoaderCircle, MessageSquareText, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { ActionSwapRollText } from "@/components/motion/action-swap-roll";
import { t, useLang } from "@/i18n";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { ApprovalActions } from "./actions";
import {
  EMPTY_ANSWER,
  getStatusBadgeClass,
  getStatusClass,
  getStatusLabel,
  QuestionOptions,
} from "./parts";
import type {
  ApprovalCardAnswer,
  ApprovalCardAnswers,
  ApprovalCardProps,
} from "./types";

export type * from "./types";

export function ApprovalCard({
  title,
  description,
  children,
  questions = [],
  status = "pending",
  answers,
  defaultAnswers = {},
  onAnswersChange,
  step,
  defaultStep = 0,
  onStepChange,
  onSubmit,
  onApprove,
  onReject,
  onRequestChanges,
  onDismiss,
  approveLabel,
  rejectLabel,
  pendingLabel,
  submitLabel,
  result,
  className,
}: ApprovalCardProps) {
  useLang();
  const resolvedTitle = title ?? t("Accord requis", "Approval required");
  const resolvedApproveLabel = approveLabel ?? t("Autoriser", "Approve");
  const resolvedRejectLabel = rejectLabel ?? t("Refuser", "Reject");
  const resolvedSubmitLabel = submitLabel ?? t("Envoyer la réponse", "Submit response");
  const reduce = useReducedMotion() ?? false;
  const [internalAnswers, setInternalAnswers] = useState<ApprovalCardAnswers>(defaultAnswers);
  const [internalStep, setInternalStep] = useState(defaultStep);
  const autoAdvanceTimer = useRef<number | undefined>(undefined);
  const currentAnswers = answers ?? internalAnswers;
  const currentStep = Math.min(Math.max(0, step ?? internalStep), Math.max(0, questions.length - 1));
  const question = questions[currentStep];
  const questionMode = questions.length > 0;
  const multipleQuestions = questions.length > 1;
  const pending = status === "pending";
  const busy = status === "submitting";
  const interactive = pending || busy;
  const currentAnswer = question ? (currentAnswers[question.id] ?? EMPTY_ANSWER) : EMPTY_ANSWER;
  const displayTitle = question?.title ?? resolvedTitle;
  const titleKey = question?.id ?? String(status);
  const statusLabel = status === "pending" && pendingLabel ? pendingLabel : getStatusLabel(status);

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer.current === undefined) return;
    window.clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = undefined;
  }, []);

  useEffect(() => clearAutoAdvance, [clearAutoAdvance]);

  const setAnswers = useCallback(
    (next: ApprovalCardAnswers) => {
      if (answers === undefined) setInternalAnswers(next);
      onAnswersChange?.(next);
    },
    [answers, onAnswersChange],
  );

  const setStep = (next: number) => {
    clearAutoAdvance();
    if (step === undefined) setInternalStep(next);
    onStepChange?.(next);
  };

  const updateCurrentAnswer = (next: ApprovalCardAnswer) => {
    if (!question) return;
    setAnswers({ ...currentAnswers, [question.id]: next });
  };

  const continueQuestion = () => {
    if (currentStep < questions.length - 1) {
      setStep(currentStep + 1);
      return;
    }
    onSubmit?.(currentAnswers);
  };

  const queueAutoAdvance = () => {
    if (!question || question.multiple || question.autoAdvance === false || currentStep >= questions.length - 1 || busy) {
      return;
    }
    clearAutoAdvance();
    autoAdvanceTimer.current = window.setTimeout(() => setStep(currentStep + 1), 240);
  };

  return (
    <div data-state={status} aria-busy={busy} className={cn("w-full overflow-hidden rounded-2xl bg-muted p-4 text-sm", className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center text-muted-foreground", getStatusClass(status))}>
          {busy ? (
            <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
          ) : interactive ? (
            questionMode ? <CircleHelp className="size-4" /> : <MessageSquareText className="size-4" />
          ) : status === "rejected" ? (
            <X className="size-4" />
          ) : (
            <Check className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-3">
            <h3 className="min-w-0 flex-1 text-base font-medium leading-5 text-foreground">
              <ActionSwapRollText value={titleKey}>{displayTitle}</ActionSwapRollText>
            </h3>
            {questionMode && interactive ? (
              multipleQuestions ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground/65">
                  {currentStep + 1}/{questions.length}
                </span>
              ) : null
            ) : (
              <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors", getStatusBadgeClass(status))}>
                {statusLabel}
              </span>
            )}
            {onDismiss ? (
              <button
                type="button"
                aria-label={t("Fermer", "Dismiss")}
                onClick={onDismiss}
                className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <AgentDisclosure open={interactive}>
            {questionMode && question ? (
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={question.id}
                  initial={reduce ? { opacity: 1 } : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: -6 }}
                  transition={{ duration: reduce ? 0 : 0.2, ease: EASE_OUT }}
                >
                  {question.description ? <p className="mt-1 leading-5 text-muted-foreground">{question.description}</p> : null}
                  <QuestionOptions
                    question={question}
                    answer={currentAnswer}
                    disabled={busy}
                    onChange={updateCurrentAnswer}
                    onSingleSelect={queueAutoAdvance}
                  />
                </motion.div>
              </AnimatePresence>
            ) : (
              <div>
                {description ? <p className="mt-1 leading-5 text-muted-foreground">{description}</p> : null}
                {children ? <div className="mt-3">{children}</div> : null}
              </div>
            )}

            <ApprovalActions
              questionMode={questionMode}
              multipleQuestions={multipleQuestions}
              lastQuestion={currentStep === questions.length - 1}
              busy={busy}
              reduce={reduce}
              currentStep={currentStep}
              questionIds={questions.map((item) => item.id)}
              currentAnswer={currentAnswer}
              approveLabel={resolvedApproveLabel}
              rejectLabel={resolvedRejectLabel}
              submitLabel={resolvedSubmitLabel}
              onPrevStep={() => setStep(currentStep - 1)}
              onContinue={continueQuestion}
              onApprove={onApprove}
              onRequestChanges={onRequestChanges}
              onReject={onReject}
            />
          </AgentDisclosure>

          {!interactive ? <p className="mt-1 text-sm text-muted-foreground">{result ?? statusLabel}</p> : null}
        </div>
      </div>
    </div>
  );
}
