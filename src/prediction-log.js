import fs from 'node:fs'
import path from 'node:path'

/**
 * Append-only prediction diagnostics. Metadata only, never message content.
 */
export class PredictionLog {
  constructor({ file, now = () => new Date() } = {}) {
    this.file = file
    this.now = now
    this.writes = 0
  }

  record({
    sessionId,
    requester,
    principal,
    source,
    profileId,
    predictionError,
    reason,
  } = {}) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const entry = {
        at: this.now().toISOString(),
        sessionId,
        requester,
        principal,
        source,
        profileId,
        ...(predictionError ? { predictionError: String(predictionError) } : {}),
        ...(reason ? { reason } : {}),
      }
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8')
      this.writes += 1
    } catch {
      // Diagnostics must never break agent creation.
    }
  }

  list(limit = 50) {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean)
      return lines.slice(-Math.max(0, limit)).map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }

  stats() {
    try {
      return { entries: fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).length }
    } catch {
      return { entries: 0 }
    }
  }
}
