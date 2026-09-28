'use client'

/**
 * "This isn't ours."
 *
 * The control that turns a reader noticing a wrong attribution into something
 * that stops it happening again. It sits on the update itself, because the
 * only moment anyone knows an attribution is wrong is the moment they are
 * looking at it — a correction that has to be made on another screen is one
 * that gets made after the meeting, or never.
 *
 * WHY IT SAYS "FROM HER NEXT PASS" RATHER THAN "DONE"
 *
 * The correction becomes a routing rule when Yaara next runs, and the wrong
 * line is still on the card until then. A control that claimed to have fixed
 * something still visibly broken an hour later would be the second thing on
 * this page nobody trusts.
 *
 * WHY THE DESTINATION IS OPTIONAL
 *
 * "This is not ours" and "this is Ratings'" are different things to know, and
 * only the second is safe to generalise. Somebody who knows a channel is not
 * theirs usually does not know whose it is, and making them pick would make
 * them guess — which is the failure this exists to fix, one step along.
 */
import { useEffect, useState } from 'react'
import { correctionTargets, recordCorrection, type CorrectionState } from '@/app/correction-actions'

export interface Misroute {
  /** Which system it came from, and where inside it. The rule matches on these. */
  source: string
  location?: string | null
  author?: string | null
  evidenceId?: string | null
  evidenceTitle?: string | null
}

export function MisroutedButton({
  item,
  entityType,
  entityId,
  label,
}: {
  item: Misroute
  entityType: string
  entityId: string
  /** What this line is, for the dialog's first sentence. */
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<Array<{ value: string; label: string }> | null>(null)
  const [belongsTo, setBelongsTo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  // Loaded when the dialog opens, not with the page: this is a rarely used
  // control and the list is every record in the portfolio.
  useEffect(() => {
    if (!open || targets) return
    let live = true
    void correctionTargets().then((rows) => {
      if (live) setTargets(rows)
    })
    return () => {
      live = false
    }
  }, [open, targets])

  const where = item.location ?? item.author ?? item.source

  async function submit() {
    setBusy(true)
    const res = await recordCorrection({
      wrongEntityType: entityType,
      wrongEntityId: entityId,
      belongsTo,
      source: item.source,
      location: item.location ?? null,
      author: item.author ?? null,
      evidenceId: item.evidenceId ?? null,
      evidenceTitle: item.evidenceTitle ?? null,
      note,
    }).catch(
      (): CorrectionState => ({ error: 'That could not be recorded. Try again in a moment.' }),
    )
    setBusy(false)
    setSaid({ ok: !res.error, text: res.error ?? res.message ?? 'Noted.' })
  }

  return (
    <>
      <button
        type="button"
        className="misroute"
        onClick={() => setOpen(true)}
        title={`Say this does not belong here (${where})`}
        aria-label="This does not belong here"
      >
        ⤫
      </button>

      {open && (
        <div
          className="modal-scrim"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Where does this belong?">
            <div className="modal-head">
              <h3>Where does this belong?</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            {said ? (
              <>
                <p className={said.ok ? 'mr-said' : 'mr-said mr-bad'}>{said.text}</p>
                <div className="mr-row">
                  <button type="button" className="mr-go" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mr-lead">{label}</p>
                <p className="mr-from">
                  Read from <b>{where}</b>
                  {item.location && item.author ? <> · {item.author}</> : null}
                </p>

                <label className="mr-label" htmlFor="mr-target">
                  It belongs to
                </label>
                <select
                  id="mr-target"
                  value={belongsTo}
                  onChange={(e) => setBelongsTo(e.target.value)}
                  disabled={!targets}
                >
                  <option value="">— nothing in the portfolio —</option>
                  {(targets ?? []).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>

                <label className="mr-label" htmlFor="mr-note">
                  Why (optional, but it is what makes the rule removable later)
                </label>
                <input
                  id="mr-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="this channel is GPC, not Ratings"
                />

                <div className="mr-row">
                  <button type="button" className="mr-go" onClick={submit} disabled={busy}>
                    {busy ? 'Recording…' : 'Tell Yaara'}
                  </button>
                  <span className="mr-hint">
                    She turns this into a standing rule on her next pass, so it stops happening rather than
                    being fixed once.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
