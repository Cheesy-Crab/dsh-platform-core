import { sessionEventsFrom } from './events.js'
import { adaptToolResult } from './plugin-adapter.js'

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i

/**
 * Collect media outputs and provider cost from any tool result.
 * Native `meta.dsh.outputs` / `meta.dsh.cost` are preferred; legacy
 * `savedTo` / `cost.total` shapes are adapted during migration.
 */
function collectRecords(value, records) {
  const adapted = adaptToolResult(value)
  for (const output of adapted.outputs) {
    if (output.kind !== 'image' || typeof output.path !== 'string' || !IMAGE_RE.test(output.path)) continue
    const cost = adapted.cost
    const recordCost = cost !== undefined
      && typeof cost.amount === 'number'
      && (cost.unit === undefined || cost.unit === 'buzz')
      ? {
          total: cost.amount,
          ...(typeof cost.base === 'number' ? { base: cost.base } : {}),
        }
      : undefined
    if (recordCost !== undefined) records.set(output.path, recordCost)
    else if (!records.has(output.path)) records.set(output.path, {})
  }
}

export function generatedImageRecords(session, fromSeq, log) {
  const records = new Map()
  try {
    for (const event of sessionEventsFrom(session, fromSeq)) {
      if (event?.type !== 'tool/result') continue
      collectRecords(event.data?.meta, records)
    }
  } catch (error) {
    log?.('warn', `could not read generated images: ${error?.message ?? error}`)
  }
  return [...records].map(([file, cost]) => ({ file, cost }))
}

export function generatedImages(session, fromSeq, log) {
  return generatedImageRecords(session, fromSeq, log).map((record) => record.file)
}

function buzz(value) {
  if (value === undefined) return '?'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

/**
 * Deliver media outputs produced by any capability. The platform owns
 * selection, cost accounting and delivery callbacks; it does not know
 * which plugin produced the output.
 *
 * `optionsForChat` is supplied by the communication surface (for example QQ
 * mention options) so this module stays surface-neutral.
 */
export async function forwardMediaOutputs({
  sendImage,
  sendText,
  charge,
  chat,
  session,
  state,
  fromSeq,
  log,
  optionsForChat,
  presentedFor,
  archive,
}) {
  const records = generatedImageRecords(session, fromSeq, log)
  const presented = new Set(presentedFor?.(session, fromSeq, log) ?? [])
  const sent = []
  for (const record of records) {
    const options = optionsForChat?.(chat) ?? {}
    let billing
    const cost = record.cost?.total
    if (typeof cost === 'number' && cost > 0 && charge) {
      try {
        billing = await charge({ chat, state, cost })
      } catch (error) {
        log?.('warn', `could not charge image quota: ${error?.message ?? error}`)
      }
    }
    if (!presented.has(record.file)) {
      try {
        const file = archive ? await archive(record.file, { session, state, log }) : record.file
        await sendImage?.(chat, file, options)
        sent.push(file)
      } catch (error) {
        log?.('warn', `could not forward generated image ${record.file}: ${error?.message ?? error}`)
      }
    }
    if (billing && sendText) {
      const suffix = billing.overdraw ? '（额度已用尽）' : ''
      const text = `本次生图消耗 ${buzz(billing.spent)} Buzz，剩余额度 ${buzz(billing.remaining)} Buzz${suffix}`
      try {
        await sendText(chat, text, options)
      } catch (error) {
        log?.('warn', `could not send image quota: ${error?.message ?? error}`)
      }
    }
  }
  return sent
}

// Compatibility alias for callers migrated from the QQ-specific module.
export const forwardGeneratedImages = forwardMediaOutputs
