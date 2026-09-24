/**
 * /how-to-play (R46): the public guide. A static page (top level of
 * src/pages/, no providers): no sign-in, no network, no integration calls.
 */

import { Link } from 'react-router-dom'
import { APP_NAME } from '../constants'
import { HowToPlayContent } from '../components/HowToPlay'

export default function HowToPlayPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-12 max-w-[480px] items-center gap-4 px-4 md:max-w-3xl">
          <Link to="/" className="font-display text-xl font-bold tracking-tight">
            {APP_NAME}
          </Link>
          <div className="flex-1" />
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">
            Open a case
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[480px] space-y-6 px-4 py-8">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-primary">Case file · rules</p>
          <h1 className="font-display text-4xl font-bold tracking-tight">How to play</h1>
        </div>
        <HowToPlayContent />
      </main>
    </div>
  )
}
