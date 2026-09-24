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
import { FileLabel, InlineError } from './CardView'
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

export function QuestionsPanel({ view, round }: { view: GameView; round: Round }) {
  const [picks, setPicks] = useState<Record<string, string>>({})
  const submit = useAction()
  const { iAnswered, opponentAnswered } = answeredFlags(view, round)
  // Only my own rows arrive (owner-only; R29).
  const questionRows = useQuery<{ questions: string }>('questions', { where: { roundId: round.id } })
  const answerRows = useQuery<{ answers: string }>('answers', { where: { roundId: round.id } })
  const questions: StoredQuestion[] = questionRows.records[0] ? JSON.parse(questionRows.records[0].data.questions) : []
  const myAnswers: StoredAnswer[] = answerRows.records[0] ? JSON.parse(answerRows.records[0].data.answers) : []
  const complete = questions.length > 0 && questions.every((q) => picks[q.id])

  return (
    <div data-testid="questions-panel" className="space-y-3">
      <FileLabel>Your questions for the next case</FileLabel>

      {iAnswered ? (
        <ul data-testid="my-answers" className="space-y-2">
          {myAnswers.map((a) => (
            <li key={a.questionId} className="rounded-sm border border-border bg-card px-3 py-2 text-sm">
              <div className="text-muted-foreground">{a.question}</div>
              <div className="font-semibold">{a.answer}</div>
            </li>
          ))}
          <li className="font-mono text-[11px] uppercase tracking-widest text-primary">Locked in</li>
        </ul>
      ) : questions.length === 0 ? (
        <div aria-busy="true" className="space-y-2">
          <div className="h-16 animate-pulse rounded-sm bg-muted" />
          <div className="h-16 animate-pulse rounded-sm bg-muted" />
        </div>
      ) : (
        <>
          {questions.map((q) => (
            // A <fieldset>'s <legend> always renders first, which put the beat under the
            // question (D40). A labelled group keeps the order: beat, question, answers.
            <div
              key={q.id}
              role="group"
              aria-labelledby={`question-${round.id}-${q.id}`}
              data-testid="question"
              className="space-y-2"
            >
              {q.beat && (
                <p data-testid="question-beat" className="text-sm italic leading-relaxed text-muted-foreground">
                  {q.beat}
                </p>
              )}
              <p id={`question-${round.id}-${q.id}`} data-testid="question-text" className="mb-1 font-semibold">
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
                    onClick={() => setPicks({ ...picks, [q.id]: answer })}
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
