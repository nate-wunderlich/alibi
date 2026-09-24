/**
 * My 2 case questions for the next case, as tap answers (GAME_RULES.md
 * "Before every round"). Shown in the LOBBY for round 1 and on the REVEAL for
 * the next case. My answers stay hidden from my opponent until that case's
 * reveal; they only see that I have answered.
 *
 * This panel owns the questions and answers subscriptions, and callers render
 * it with key={round.id}: each subscription is created once, for a known
 * round id, and never has to follow a changing `where` (D19).
 */

import { useState } from 'react'
import { useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAction } from '@/lib/actions'
import { InlineError } from './CardView'
import type { GameView, Round, StoredAnswer, StoredQuestion } from './useGameData'

/** Whether each seat has locked in its answers for a round. */
export function answeredFlags(view: GameView, round: Round) {
  const mine = view.mySeat === 'host' ? round.hostAnswered : round.guestAnswered
  const theirs = view.mySeat === 'host' ? round.guestAnswered : round.hostAnswered
  return { iAnswered: mine === 1, opponentAnswered: theirs === 1, both: round.hostAnswered === 1 && round.guestAnswered === 1 }
}

/** The "Writing your case..." state while the AI writes the case. */
export function WritingCase() {
  return (
    <div data-testid="writing-case" aria-busy="true" className="space-y-2 rounded-sm border border-primary bg-card p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-primary">Writing your case...</p>
      <p className="text-sm text-muted-foreground">
        Your answers are going into a brand-new case. This takes a few seconds.
      </p>
      <div className="h-3 w-2/3 animate-pulse rounded-sm bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded-sm bg-muted" />
    </div>
  )
}

/**
 * R47: one question at a time ("Question 1 of 2"); tapping an answer moves on,
 * Back goes to the previous one. After the last, a one-line summary of my
 * picks and Lock in. Both questions stay in the page (the one not in view is
 * hidden), so they arrive live together (D19) and keep their order (D40).
 */
export function QuestionsPanel({ view, round }: { view: GameView; round: Round }) {
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const submit = useAction()
  const { iAnswered, opponentAnswered } = answeredFlags(view, round)
  // Only my own rows arrive (owner-only; R29).
  const questionRows = useQuery<{ questions: string }>('questions', { where: { roundId: round.id } })
  const answerRows = useQuery<{ answers: string }>('answers', { where: { roundId: round.id } })
  const questions: StoredQuestion[] = questionRows.records[0] ? JSON.parse(questionRows.records[0].data.questions) : []
  const myAnswers: StoredAnswer[] = answerRows.records[0] ? JSON.parse(answerRows.records[0].data.answers) : []
  const complete = questions.length > 0 && questions.every((q) => picks[q.id])
  const summary = questions.length > 0 && step >= questions.length

  return (
    <div data-testid="questions-panel" className="space-y-2">
      {iAnswered ? (
        <div data-testid="my-answers" className="rounded-sm border border-border bg-card px-3 py-2 text-sm">
          <span className="font-mono text-[10px] uppercase tracking-widest text-primary">Locked in</span>{' '}
          <span className="font-semibold">{myAnswers.map((a) => a.answer).join(' · ')}</span>
        </div>
      ) : questions.length === 0 ? (
        <div aria-busy="true" className="space-y-2">
          <div className="h-16 animate-pulse rounded-sm bg-muted" />
          <div className="h-16 animate-pulse rounded-sm bg-muted" />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p data-testid="question-step" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {summary ? 'Your picks' : `Question ${step + 1} of ${questions.length}`}
            </p>
            {step > 0 && (
              <Button data-testid="question-back" variant="link" className="h-auto px-0 text-sm" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
          </div>
          {questions.map((q, i) => (
            // A <fieldset>'s <legend> always renders first, which put the beat under the
            // question (D40). A labelled group keeps the order: beat, question, answers.
            <div
              key={q.id}
              role="group"
              aria-labelledby={`question-${round.id}-${q.id}`}
              data-testid="question"
              hidden={i !== step}
              className="space-y-2"
            >
              {q.beat && (
                <p data-testid="question-beat" className="text-sm italic leading-relaxed text-muted-foreground">
                  {q.beat}
                </p>
              )}
              <p id={`question-${round.id}-${q.id}`} data-testid="question-text" className="font-semibold">
                {q.text}
              </p>
              <div role="radiogroup" aria-label={q.text} className="grid grid-cols-2 gap-2">
                {q.answers.map((answer) => (
                  <button
                    key={answer}
                    type="button"
                    role="radio"
                    aria-checked={picks[q.id] === answer}
                    data-testid="answer-option"
                    onClick={() => {
                      setPicks({ ...picks, [q.id]: answer })
                      setStep(i + 1)
                    }}
                    className={cn(
                      'rounded-sm border px-3 py-2 text-left text-sm transition-colors',
                      picks[q.id] === answer
                        ? 'border-primary bg-card font-semibold text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {answer}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {summary && (
            <div className="space-y-2">
              <p data-testid="my-picks" className="truncate text-sm font-semibold">
                {questions.map((q) => picks[q.id]).join(' · ')}
              </p>
              <Button
                data-testid="submit-answers"
                className="w-full"
                disabled={!complete}
                loading={submit.pending}
                onClick={() =>
                  submit.run('submitAnswers', {
                    roundId: round.id,
                    answers: questions.map((q) => ({ questionId: q.id, answer: picks[q.id] })),
                  })
                }
              >
                Lock in my answers
              </Button>
              <InlineError message={submit.error} />
            </div>
          )}
        </>
      )}

      <p
        data-testid="opponent-answered"
        data-answered={opponentAnswered ? 'true' : 'false'}
        className="text-sm text-muted-foreground"
      >
        {opponentAnswered
          ? `${view.nameOf(view.opponentId)} has answered.`
          : `${view.opponentId ? view.nameOf(view.opponentId) : 'Your opponent'} has not answered yet.`}
      </p>
    </div>
  )
}
