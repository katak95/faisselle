import { utilityProcess } from 'electron'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

/** what this transport needs from a utility process (a stand-in in tests) */
export type ServerProc = {
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  postMessage(message: unknown): void
  kill(): boolean
  once(event: 'spawn', listener: () => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
}
export type Fork = (worker: string, env: Record<string, string>) => ServerProc

const electronFork: Fork = (worker, env) => utilityProcess.fork(worker, [], { env, stdio: 'pipe', serviceName: 'Faisselle Microsoft 365' }) as unknown as ServerProc

/**
 * The Microsoft 365 MCP server over a utility process (src/m365/worker.ts), as the MCP client sees a stdio server:
 * messages go to the worker by postMessage (its stdin there), answers come back on its stdout, one JSON per line.
 * The installed app can't start its own binary as Node (the runAsNode fuse is off), which StdioClientTransport needs.
 */
export class UtilityProcessTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void
  onerror?: (error: Error) => void
  onclose?: () => void
  private proc: ServerProc | undefined
  private readonly buffer = new ReadBuffer()

  constructor(private readonly o: { worker: string; script: string; args: string[]; env: Record<string, string>
    /** what the server writes on stderr, line by line */
    stderr(line: string): void
    fork?: Fork }) {}

  async start(): Promise<void> {
    if (this.proc) throw new Error('The Microsoft 365 server is already started')
    const proc = (this.o.fork ?? electronFork)(this.o.worker, { ...this.o.env, FAISSELLE_M365_SCRIPT: this.o.script, FAISSELLE_M365_ARGS: JSON.stringify(this.o.args) })
    this.proc = proc
    proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk)
      for (;;) {
        let message: JSONRPCMessage | null
        try { message = this.buffer.readMessage() } catch (e) { this.onerror?.(e instanceof Error ? e : new Error(String(e))); continue }
        if (!message) break
        this.onmessage?.(message)
      }
    })
    let pending = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      pending += chunk.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) this.o.stderr(line.trim())
    })
    proc.on('exit', (code) => {
      if (pending.trim()) this.o.stderr(pending.trim())
      pending = ''
      const mine = this.proc === proc
      this.proc = undefined
      this.buffer.clear()
      if (mine && code !== 0) this.onerror?.(new Error(`The Microsoft 365 server stopped (exit code ${code})`))
      this.onclose?.()
    })
    await new Promise<void>((resolve) => { proc.once('spawn', () => resolve()) })
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.proc) throw new Error('The Microsoft 365 server is not running')
    this.proc.postMessage(serializeMessage(message))
  }

  async close(): Promise<void> {
    const proc = this.proc
    this.proc = undefined
    if (proc) { proc.postMessage(null); proc.kill() }
    this.buffer.clear()
    this.onclose?.()
  }
}
