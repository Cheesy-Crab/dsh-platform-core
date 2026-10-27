import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Read a session's own events from `fromSeq` to the head. Platform delivery
 * uses the raw log because host bookkeeping events may be hidden from the
 * surface snapshot.
 */
export function sessionEventsFrom(session, fromSeq) {
  if (!session) return []
  try {
    if (typeof session.ownEvents === 'function') {
      const events = session.ownEvents()
      if (Array.isArray(events) && events.length > 0) {
        const from = Number.isFinite(fromSeq) ? fromSeq : 0
        return events.filter((event) => Number.isFinite(event?.seq) ? event.seq >= from : true)
      }
    }
  } catch {
    // fall through to the public snapshot
  }
  try {
    const events = session.snapshotEvents(fromSeq)
    return Array.isArray(events) ? events : []
  } catch {
    return []
  }
}

/**
 * Append one diagnostic line to `<DSH_HOME>/logs/platform.log` when
 * `DSH_PLATFORM_TRACE=1`. Diagnostics must never break delivery.
 */
export function trace(label, data) {
  if (process.env.DSH_PLATFORM_TRACE !== '1') return
  try {
    const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
    const dir = path.join(home, 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const line = `${new Date().toISOString()} ${label} ${JSON.stringify(data)}\n`
    fs.appendFileSync(path.join(dir, 'platform.log'), line)
  } catch {
    // diagnostics must never break delivery
  }
}
