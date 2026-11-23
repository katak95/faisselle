import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'

/**
 * The Microsoft 365 MCP server's process (Softeria ms-365-mcp-server), started by main/m365/serverProcess.ts as an
 * Electron utility process. The installed app can't run its own binary as Node (electron-builder.yml turns the
 * runAsNode fuse off), so the server runs here instead, unchanged: it reads MCP messages on its standard input and
 * answers on its standard output, as over stdio. A utility process has no standard input of its own, so the main
 * process posts the messages and they are fed to the server's stdin from here; its stdout and stderr go back by pipe.
 *
 * FAISSELLE_M365_SCRIPT: the server's entry point; FAISSELLE_M365_ARGS: its command line, as JSON.
 */
const stdin = new PassThrough()
Object.defineProperty(process, 'stdin', { configurable: true, get: () => stdin })
process.parentPort.on('message', ({ data }: { data: unknown }) => {
  if (data === null) stdin.end()
  else stdin.write(String(data))
})

const script = process.env.FAISSELLE_M365_SCRIPT ?? ''
const args = JSON.parse(process.env.FAISSELLE_M365_ARGS ?? '[]') as string[]
delete process.env.FAISSELLE_M365_SCRIPT
delete process.env.FAISSELLE_M365_ARGS
// the server reads its options from the command line, as `node index.js --read-only …`
process.argv = [process.execPath, script, ...args]
import(pathToFileURL(script).href).catch((e: unknown) => {
  process.stderr.write(`the Microsoft 365 server did not load: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`)
  process.exit(1)
})
