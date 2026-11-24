import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { UtilityProcessTransport, type ServerProc } from '../src/main/m365/serverProcess'

/** a utility process that answers each request with the same id, and can say things on stderr or stop */
function fakeProc() {
  const ev = new EventEmitter(), stdout = new PassThrough(), stderr = new PassThrough()
  const posted: unknown[] = []
  let env: Record<string, string> = {}
  const proc: ServerProc = {
    stdout, stderr,
    postMessage: (m) => {
      posted.push(m)
      if (typeof m !== 'string') return
      for (const line of m.split('\n').filter(Boolean)) {
        const req = JSON.parse(line) as { id?: number; method: string }
        if (req.id !== undefined) stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { echo: req.method } }) + '\n')
      }
    },
    kill: () => { ev.emit('exit', 0); return true },
    once: (e, l) => ev.once(e, l),
    on: (e, l) => ev.on(e, l),
  }
  return { proc, posted, ev, stderr, env: () => env, fork: (_w: string, e: Record<string, string>) => { env = e; setTimeout(() => ev.emit('spawn'), 0); return proc } }
}

describe('the Microsoft 365 server in a utility process (the installed app has no run-as-Node)', () => {
  it('sends messages as stdin lines and reads the answers from stdout', async () => {
    const f = fakeProc(), lines: string[] = []
    const t = new UtilityProcessTransport({ worker: '/out/main/m365.js', script: '/srv/index.js', args: ['--read-only'], env: { A: '1' }, stderr: (l) => lines.push(l), fork: f.fork })
    const got: unknown[] = []
    t.onmessage = (m) => got.push(m)
    await t.start()
    // the worker learns which server to run and with what, then the env goes on unchanged
    expect(f.env()).toMatchObject({ A: '1', FAISSELLE_M365_SCRIPT: '/srv/index.js', FAISSELLE_M365_ARGS: '["--read-only"]' })
    await t.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    await new Promise((r) => setTimeout(r, 10))
    expect(f.posted[0]).toBe('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n')
    expect(got).toEqual([{ jsonrpc: '2.0', id: 1, result: { echo: 'tools/list' } }])
  })

  it("keeps what the server says on stderr, and says when it stopped", async () => {
    const f = fakeProc(), lines: string[] = [], errors: string[] = []
    const t = new UtilityProcessTransport({ worker: 'w', script: 's', args: [], env: {}, stderr: (l) => lines.push(l), fork: f.fork })
    let closed = false
    t.onerror = (e) => errors.push(e.message)
    t.onclose = () => { closed = true }
    await t.start()
    f.stderr.write('the auth cache could not be read\nhalf a li')
    f.stderr.write('ne\n')
    await new Promise((r) => setTimeout(r, 10))
    f.ev.emit('exit', 1)
    expect(lines).toEqual(['the auth cache could not be read', 'half a line'])
    expect(errors).toEqual(['The Microsoft 365 server stopped (exit code 1)'])
    expect(closed).toBe(true)
    await expect(t.send({ jsonrpc: '2.0', id: 2, method: 'x' })).rejects.toThrow('not running')
  })

  it('ends the server on close', async () => {
    const f = fakeProc()
    const t = new UtilityProcessTransport({ worker: 'w', script: 's', args: [], env: {}, stderr: () => {}, fork: f.fork })
    await t.start()
    await t.close()
    expect(f.posted.at(-1)).toBeNull()
  })
})
