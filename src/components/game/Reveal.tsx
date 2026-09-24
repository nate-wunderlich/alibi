/**
 * REVEAL (R30) and SERIES END, each on one screen that never scrolls (R47):
 * a compact top strip, the active step, and a bottom step bar.
 *  - Verdict: who won the round, the accusation and whether it was right, the envelope.
 *  - Confession: the text and its Play control (the audio stays mounted on every step, so R36's
 *    autoplay on arrival still works).
 *  - Hands: both hands and both players' answers, up to two lines each.
 *  - Next case (reveal only): my questions for the next case, and the host's Next case button.
 *  - Result (series end only): the winner and the round-by-round results.
 * Everything here comes from the round's revealed* fields, copied by the server at the reveal;
 * the secret collections stay closed.
 */

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAction } from '@/lib/actions'
import type { Triple } from '../../game/rules'
import { SETTINGS } from '../../game/settings'
import { CardChip, InlineError } from './CardView'
import { useNarration, type Narration } from './NarrationAudio'
import { answeredFlags, QuestionsPanel, WritingCase } from './QuestionsPanel'
import { Scoreboard } from './Scoreboard'
import type { GameView, Round, StoredAnswer } from './useGameData'

interface Accusation extends Triple {
  byUserId: string
  correct: boolean
}

const parse = <T,>(text: string, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{children}</p>
}

/** The bottom step bar (role=tablist), like the table's tabs. */
function StepBar<T extends string>({
  steps,
  active,
  onChange,
}: {
  steps: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" aria-label="Steps" className="-mx-3 grid shrink-0 border-t border-border bg-background" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          data-testid={`step-${s.id}`}
          aria-selected={active === s.id}
          onClick={() => onChange(s.id)}
          className={cn(
            'relative h-12 font-mono text-[11px] uppercase tracking-widest',
            active === s.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {s.label}
          {active === s.id && <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 bg-primary" />}
        </button>
      ))}
    </div>
  )
}

/** The three steps every reveal shows (Verdict, Confession, Hands), for one round. */
function useRoundSteps(view: GameView, round: Round) {
  const envelope = parse<Triple | null>(round.revealedSolution, null)
  const hands = parse<Record<string, string[]>>(round.revealedHands, {})
  const accusation = parse<Accusation | null>(round.revealedAccusation, null)
  const answers = parse<Record<string, StoredAnswer[]>>(round.revealedAnswers, {})
  const card = (id: string) => view.cardsById.get(id)
  const name = (id: string) => card(id)?.name ?? '?'

  const verdict = (
    <div className="space-y-3">
      <p data-testid="round-winner" className="font-display text-2xl font-bold leading-tight">
        {round.winnerUserId === view.myId ? 'You win this case.' : `${view.nameOf(round.winnerUserId)} wins this case.`}
      </p>
      {accusation && (
        <p data-testid="reveal-accusation" className="text-sm">
          <span className="font-semibold">{view.nameOf(accusation.byUserId)}</span> accused {name(accusation.suspect)}, with{' '}
          {name(accusation.weapon)}, in {name(accusation.location)}.{' '}
          <span className={accusation.correct ? 'font-semibold text-primary' : 'font-semibold'}>
            {accusation.correct ? 'Right.' : 'Wrong.'}
          </span>
        </p>
      )}
      <div>
        <SmallLabel>The envelope</SmallLabel>
        <div data-testid="reveal-envelope" className="space-y-1.5">
          {envelope &&
            [envelope.suspect, envelope.weapon, envelope.location].map((id) => (
              <CardChip key={id} card={card(id)} className="border-primary" />
            ))}
        </div>
      </div>
    </div>
  )

  const confession = (narration: Narration) => (
    <div data-testid="reveal-confession" className="space-y-2">
      <SmallLabel>The confession</SmallLabel>
      {round.confession ? (
        <blockquote className="border-l-2 border-primary pl-3 text-sm italic leading-relaxed">{round.confession}</blockquote>
      ) : (
        <p className="text-sm text-muted-foreground">The confession is being written.</p>
      )}
      {narration.button('Play the confession', 'play-confession')}
    </div>
  )

  const handsStep = (
    <div className="space-y-3">
      {Object.entries(hands).map(([userId, ids]) => (
        <div key={userId} data-testid="reveal-hand">
          <SmallLabel>{userId === view.myId ? 'Your hand' : `${view.nameOf(userId)}'s hand`}</SmallLabel>
          <div className="grid grid-cols-2 gap-1.5">
            {ids.map((id) => (
              <CardChip key={id} card={card(id)} />
            ))}
          </div>
        </div>
      ))}
      {Object.keys(answers).length > 0 && (
        <div data-testid="reveal-answers">
          <SmallLabel>The answers that shaped this case</SmallLabel>
          <ul className="space-y-1 text-sm">
            {Object.entries(answers).flatMap(([userId, list]) =>
              list.map((a) => (
                <li key={`${userId}-${a.questionId}`} className="line-clamp-2 leading-snug" title={`${a.question} ${a.answer}`}>
                  <span className="text-muted-foreground">{view.nameOf(userId)}: </span>
                  <span className="text-muted-foreground">{a.question}</span> <span className="font-semibold">{a.answer}</span>
                </li>
              )),
            )}
          </ul>
        </div>
      )}
    </div>
  )

  return { verdict, confession, hands: handsStep }
}

/** The compact top strip: score, and the case (or series) heading. */
function TopStrip({ view, kicker, title }: { view: GameView; kicker: string; title: string }) {
  return (
    <header className="shrink-0 space-y-1 border-b border-border pb-2">
      <Scoreboard view={view} compact />
      <p className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{kicker}</p>
      <h1 className="truncate font-display text-xl font-bold leading-tight" title={title}>
        {title}
      </h1>
    </header>
  )
}

type RevealStep = 'verdict' | 'confession' | 'hands' | 'next'

/**
 * REVEAL screen between rounds: Verdict, Confession, Hands, and Next case (my questions for the
 * next case, and "Next case" for the host once both players have answered).
 */
export function Reveal({ view, round }: { view: GameView; round: Round }) {
  const [step, setStep] = useState<RevealStep>('verdict')
  const next = useAction()
  const setting = SETTINGS.find((s) => s.id === round.settingId)
  const prep = view.prepRound
  const writing = prep?.status === 'generating'
  const bothAnswered = prep ? answeredFlags(view, prep).both : false
  const steps = useRoundSteps(view, round)
  // R36: the audio element stays mounted on every step; autoplay on arrival still works.
  const narration = useNarration(round.confessionAudioUrl, true)

  return (
    <section data-testid="reveal" className="flex min-h-0 flex-1 flex-col gap-2">
      <TopStrip view={view} kicker={`Case ${round.number} · ${setting?.name ?? ''} · closed`} title={round.caseTitle} />
      {narration.element}
      <div role="tabpanel" data-testid={`steppanel-${step}`} className="flex min-h-0 flex-1 flex-col">
        {step === 'verdict' && steps.verdict}
        {step === 'confession' && steps.confession(narration)}
        {step === 'hands' && steps.hands}
        {step === 'next' && (
          <div className="space-y-3">
            {writing ? <WritingCase /> : prep && <QuestionsPanel key={prep.id} view={view} round={prep} />}
            {!writing &&
              (view.mySeat === 'host' ? (
                <div>
                  <Button
                    data-testid="next-case"
                    className="w-full"
                    disabled={!bothAnswered}
                    loading={next.pending}
                    onClick={() => next.run('nextRound', { gameId: view.gameId })}
                  >
                    Next case
                  </Button>
                  {!bothAnswered && <p className="mt-1 text-xs text-muted-foreground">You can open it once you both have answered.</p>}
                  <InlineError message={next.error} />
                </div>
              ) : (
                <p data-testid="next-case-waiting" className="text-sm text-muted-foreground">
                  Waiting for {view.game ? view.nameOf(view.game.host) : 'the host'} to open the next case.
                </p>
              ))}
          </div>
        )}
      </div>
      <StepBar
        steps={[
          { id: 'verdict', label: 'Verdict' },
          { id: 'confession', label: 'Confession' },
          { id: 'hands', label: 'Hands' },
          { id: 'next', label: 'Next case' },
        ]}
        active={step}
        onChange={setStep}
      />
    </section>
  )
}

type EndStep = 'result' | 'verdict' | 'confession' | 'hands'

/** SERIES END: Result (the winner and each case), then Verdict, Confession, and Hands for the last case. */
export function SeriesEnd({ view }: { view: GameView }) {
  const { game, round } = view
  const [step, setStep] = useState<EndStep>('result')
  const narration = useNarration(round?.confessionAudioUrl ?? '', true)
  if (!game) return null
  const iWon = game.seriesWinner === view.myId

  return (
    <section data-testid="series-end" className="flex min-h-0 flex-1 flex-col gap-2">
      <TopStrip view={view} kicker="Series closed" title={round?.caseTitle ?? ''} />
      {narration.element}
      <div role="tabpanel" data-testid={`steppanel-${step}`} className="flex min-h-0 flex-1 flex-col">
        {step === 'result' && (
          <div className="space-y-3">
            <h2 data-testid="series-winner" className="font-display text-2xl font-bold leading-tight">
              {iWon ? 'You solved the series.' : `${view.nameOf(game.seriesWinner)} solved the series.`}
            </h2>
            <div>
              <SmallLabel>Case by case</SmallLabel>
              <ol className="space-y-1">
                {view.rounds.map((r) => (
                  <li key={r.id} data-testid="series-round" className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-muted-foreground">{r.number}.</span> {r.caseTitle}
                    </span>
                    <span className="shrink-0 font-semibold">{view.nameOf(r.winnerUserId)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <Link to="/home" data-testid="back-home" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
              Back home
            </Link>
          </div>
        )}
        {round && <LastCaseStep view={view} round={round} step={step} narration={narration} />}
      </div>
      <StepBar
        steps={[
          { id: 'result', label: 'Result' },
          { id: 'verdict', label: 'Verdict' },
          { id: 'confession', label: 'Confession' },
          { id: 'hands', label: 'Hands' },
        ]}
        active={step}
        onChange={setStep}
      />
    </section>
  )
}

/** The last case's Verdict, Confession, or Hands on the series end. */
function LastCaseStep({ view, round, step, narration }: { view: GameView; round: Round; step: EndStep; narration: Narration }) {
  const steps = useRoundSteps(view, round)
  if (step === 'verdict') return steps.verdict
  if (step === 'confession') return steps.confession(narration)
  if (step === 'hands') return steps.hands
  return null
}
