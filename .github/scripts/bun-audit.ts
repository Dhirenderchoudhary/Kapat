// bun audit talks to the npm advisory API. GitHub runners often sit on
// "Timeout: audit request failed" for bun's full 5m client timeout, then fail
// the job before lint/test/build run. Retry only that class of failure; a real
// high/critical finding still fails the job on the first response.

const ATTEMPTS = 3
// Past bun's own ~5m client timeout, so a hung process is killed; a slow success is not.
const HANG_MS = 6 * 60_000
const TRANSIENT =
  /Timeout: audit request failed|audit request failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network is unreachable|TLS handshake/i

const readAndEcho = async (
  stream: ReadableStream<Uint8Array>,
  write: (chunk: string) => void,
): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    out += chunk
    write(chunk)
  }
  return out
}

const runOnce = async (): Promise<{ code: number; hung: boolean; output: string }> => {
  const proc = Bun.spawn(["bun", "audit", "--audit-level", "high"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })

  let hung = false
  let forceKill: ReturnType<typeof setTimeout> | undefined
  const killer = setTimeout(() => {
    hung = true
    proc.kill("SIGTERM")
    forceKill = setTimeout(() => proc.kill("SIGKILL"), 5_000)
  }, HANG_MS)

  const [stdout, stderr, code] = await Promise.all([
    readAndEcho(proc.stdout, (c) => process.stdout.write(c)),
    readAndEcho(proc.stderr, (c) => process.stderr.write(c)),
    proc.exited,
  ])
  clearTimeout(killer)
  if (forceKill) clearTimeout(forceKill)

  return { code: code ?? 1, hung, output: `${stdout}${stderr}` }
}

const main = async () => {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { code, hung, output } = await runOnce()
    if (code === 0) return

    const transient = hung || TRANSIENT.test(output)
    if (!transient) process.exit(code)
    if (attempt === ATTEMPTS) {
      console.error(`bun audit: registry still unreachable after ${ATTEMPTS} attempts`)
      process.exit(1)
    }

    console.error(
      `bun audit: transient failure (attempt ${attempt}/${ATTEMPTS}, exit ${code}); retrying...`,
    )
    await Bun.sleep(5_000 * attempt)
  }
}

await main()

export {}
