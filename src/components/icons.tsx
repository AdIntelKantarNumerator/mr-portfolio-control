/**
 * The navigation icon set.
 *
 * One family, one grid, one weight. They are drawn here rather than pulled
 * from an icon package because the set is fifteen glyphs and a dependency that
 * ships two thousand — most of them in a different visual language from these
 * — is a worse trade than forty lines of SVG.
 *
 * Rules that keep them looking like one set:
 *   - 16×16 viewBox, 1.6 stroke, round caps and joins, no fills.
 *   - currentColor only, so a nav item's active state recolours the icon with
 *     the label rather than needing a second rule.
 *   - Every glyph reads at 16px. A picture of the thing beats a clever
 *     metaphor at this size: Timeline is bars on a grid, not an hourglass.
 *
 * An icon is decorative here — the label beside it is the accessible name — so
 * each one is aria-hidden and the anchor carries the text.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Glyph({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Home — a roof over a door. */
export const IconHome = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.5 6.8 8 2.5l5.5 4.3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5z" />
    <path d="M6.5 13.5v-4h3v4" />
  </Glyph>
)

/** Activity — what moved, as a pulse. */
export const IconActivity = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M1.5 8h3l2-5 3 10 2-5h3" />
  </Glyph>
)

/** Initiatives — projects stacked into one thing. */
export const IconInitiatives = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 1.8 14.2 5 8 8.2 1.8 5z" />
    <path d="M1.8 8.4 8 11.6l6.2-3.2" />
    <path d="M1.8 11.6 8 14.8l6.2-3.2" />
  </Glyph>
)

/** Projects — a folder. */
export const IconProjects = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M1.8 12.4V3.6a.6.6 0 0 1 .6-.6h3.2l1.6 1.8h6.4a.6.6 0 0 1 .6.6v7a.6.6 0 0 1-.6.6H2.4a.6.6 0 0 1-.6-.6z" />
  </Glyph>
)

/** Workstreams — parallel lanes of work branching off. */
export const IconWorkstreams = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3.4 2.6v10.8" />
    <path d="M3.4 5.6h5a2 2 0 0 1 2 2v.8" />
    <path d="M3.4 10.4h5a2 2 0 0 0 2-2v-.8" />
    <circle cx="10.6" cy="8" r="1.9" />
  </Glyph>
)

/** Timeline — bars against a calendar grid. */
export const IconTimeline = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="1.8" y="2.6" width="12.4" height="11" rx="1.2" />
    <path d="M1.8 6h12.4" />
    <path d="M4.4 8.4h4.4M6.6 11h4.6" />
  </Glyph>
)

/** Register — decisions and blockers, as a clipboard. */
export const IconRegister = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5.6 3H3.9a.6.6 0 0 0-.6.6v9.8a.6.6 0 0 0 .6.6h8.2a.6.6 0 0 0 .6-.6V3.6a.6.6 0 0 0-.6-.6h-1.7" />
    <rect x="5.6" y="1.6" width="4.8" height="2.6" rx=".7" />
    <path d="M5.9 8.4h4.2M5.9 11h2.8" />
  </Glyph>
)

/** Decisions — a fork, and the two ways it could go. */
export const IconDecisions = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 14.4V9.2m0 0L4.4 5.6V3.4M8 9.2l3.6-3.6V3.4" />
    <circle cx="4.4" cy="2.4" r="1.4" />
    <circle cx="11.6" cy="2.4" r="1.4" />
  </Glyph>
)

/** Action items — a commitment, ticked. */
export const IconActions = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M5.4 8.2 7.2 10l3.4-3.8" />
  </Glyph>
)

/** Dependencies — one thing chained to another. */
export const IconDependencies = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1" />
  </Glyph>
)

/** Readiness — gates passed, as a shield with a tick. */
export const IconReadiness = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 1.8 13 3.6v4.1c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5V3.6z" />
    <path d="M5.9 7.9 7.4 9.4l2.8-3" />
  </Glyph>
)

/** Intake — something arriving in a tray. */
export const IconIntake = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M1.8 9.6h3.1l1 1.8h4.2l1-1.8h3.1" />
    <path d="M1.8 9.6 3.6 3.4a.6.6 0 0 1 .6-.5h7.6a.6.6 0 0 1 .6.5l1.8 6.2v3.2a.6.6 0 0 1-.6.6H2.4a.6.6 0 0 1-.6-.6z" />
  </Glyph>
)

/** Prioritization — ranked, as sliders. */
export const IconPrioritization = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.4 4.4h11.2M2.4 8h11.2M2.4 11.6h11.2" />
    <circle cx="5.6" cy="4.4" r="1.5" />
    <circle cx="10.4" cy="8" r="1.5" />
    <circle cx="6.8" cy="11.6" r="1.5" />
  </Glyph>
)

/** By application — the estate, as a grid of panels. */
export const IconApplications = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Glyph>
)

/** Contention & people — who is being pulled in two directions. */
export const IconPeople = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="6" cy="5.6" r="2.4" />
    <path d="M1.8 13.4c0-2.3 1.9-3.8 4.2-3.8s4.2 1.5 4.2 3.8" />
    <path d="M10.8 3.6a2.4 2.4 0 0 1 0 4.4" />
    <path d="M12 9.9c1.4.5 2.2 1.7 2.2 3.5" />
  </Glyph>
)

/** Conversations — where the evidence came from. */
export const IconConversations = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M13.8 9.4a1.4 1.4 0 0 1-1.4 1.4H5.6L2.2 13.6V3.4A1.4 1.4 0 0 1 3.6 2h8.8a1.4 1.4 0 0 1 1.4 1.4z" />
  </Glyph>
)

/** Templates — a page with a repeated shape. */
export const IconTemplates = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 1.9H4a.7.7 0 0 0-.7.7v10.8a.7.7 0 0 0 .7.7h8a.7.7 0 0 0 .7-.7V5.6z" />
    <path d="M9 1.9v3.7h3.7" />
    <path d="M5.7 9.2h4.6M5.7 11.6h2.8" />
  </Glyph>
)

/** The section disclosure caret. */
export const IconCaret = ({ open = false, ...p }: IconProps & { open?: boolean }) => (
  <Glyph
    {...p}
    size={p.size ?? 12}
    style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}
  >
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Glyph>
)

/** The sidebar collapse control. */
export const IconPanel = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2" y="2.6" width="12" height="10.8" rx="1.4" />
    <path d="M6.4 2.6v10.8" />
  </Glyph>
)
