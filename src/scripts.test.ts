import { describe, expect, it } from 'vitest'

// The project's types have no Node typings (a Workers app), so load child_process untyped.
type SpawnSync = (cmd: string, args: string[], opts: object) => { status: number | null; stdout: string; stderr: string }
const childProcess = 'node:child_process'

describe('npm run samples (R48)', () => {
  it('refuses without --yes, after printing the estimated paid calls, and before contacting anything', async () => {
    const { spawnSync } = (await import(/* @vite-ignore */ childProcess)) as { spawnSync: SpawnSync }
    const run = spawnSync(process.execPath, ['scripts/samples.mjs', '2'], { encoding: 'utf8', timeout: 20_000 })
    expect(run.status).not.toBe(0)
    expect(run.stdout + run.stderr).toMatch(/about \d+ paid text-AI calls/i)
    expect(run.stdout + run.stderr).toMatch(/--yes/)
    expect(run.stdout + run.stderr).not.toMatch(/No dev server/)
  })
})
