'use client'

/**
 * The top of a detail page: which tier you are on, what this thing is
 * called, what state it is in, and what it belongs to.
 *
 * WHY ALL THREE TIERS SHARE ONE OF THESE
 *
 * The objective page had a tier kicker and a heading; the initiative and
 * project pages had a small backlink and a breadcrumb that also carried a
 * link to the Timeline. The same three facts were presented three ways, and
 * only one of them told you where you were without reading the URL.
 *
 * WHY THE STATUS IS A BUTTON AND NOT A BADGE WITH A BUTTON UNDER IT
 *
 * There was a pill saying "active" and, on the line below, a control called
 * "Change status…". Two elements for one fact, and the reader had to work out
 * that they were about the same thing. The pill is the control now.
 *
 * The theme and application-area kickers that used to sit here are gone. They
 * named a taxonomy nobody navigates by, in the most valuable line on the
 * page.
 */
import Link from 'next/link'
import { Kicker } from './ui'
import { Editable } from './editable'

export interface DetailHeadProps {
  /** The tier, and where its list lives: shown as the kicker. */
  tier: { label: string; href: string }
  name: string
  /** What this rolls up to. Null renders the gap, which is worth seeing. */
  parent?: { label: string; name: string; href: string } | null
  /** Said when there is no parent — "not in an objective" is a real state. */
  orphan?: string
  /** The editable status, shown as a pill beside the name. */
  status?: {
    level: 'objective' | 'initiative' | 'project'
    id: string
    value: string
    label: string
    tone: string
    options: { value: string; label: string }[]
  }
  /** Anything else that belongs on the title line: priority, source links. */
  pills?: React.ReactNode
  /** The edit-details control, when this reader can write. */
  edit?: React.ReactNode
  children?: React.ReactNode
}

export function DetailHead({ tier, name, parent, orphan, status, pills, edit, children }: DetailHeadProps) {
  return (
    <div className="dhead">
      {/* Singular: this is one of them, not the list. The link still goes to
          the list, which the title attribute says out loud. */}
      <Kicker>
        <Link href={tier.href} title={`All ${tier.label.toLowerCase()}s`}>
          {tier.label}
        </Link>
      </Kicker>

      <div className="dhead-line">
        <h1>{name}</h1>
        {status && (
          <Editable
            level={status.level}
            id={status.id}
            field="status"
            kind="choice"
            options={status.options}
            raw={status.value}
            value={status.label}
            className="dstatus"
            before={<i style={{ background: status.tone }} aria-hidden="true" />}
          />
        )}
        {pills}
        {edit ? <span className="dhead-right">{edit}</span> : null}
      </div>

      {(parent || orphan) && (
        <p className="parentline">
          {parent ? (
            <>
              <span>{parent.label}</span>
              <Link href={parent.href}>{parent.name}</Link>
            </>
          ) : (
            <span className="orphan">{orphan}</span>
          )}
        </p>
      )}

      {children}
    </div>
  )
}
