/**
 * The section marks for a detail page.
 *
 * Each one is two or three flat shapes in the palette the rest of the app
 * uses, not a line icon: at 20px a single-stroke glyph reads as grey texture,
 * and the point of these is that somebody scanning the page finds "blockers"
 * without reading the word.
 *
 * They are decoration and are marked `aria-hidden`. Every one sits next to a
 * heading that says the same thing in words, so nothing is lost when they do
 * not render.
 */
export type SectionIcon = (props: { size?: number }) => React.ReactElement

const box = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  'aria-hidden': true,
})

/** A flag on a pole: a point on a route that somebody committed to. */
export const IconMilestone: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <path d="M5 3v18" stroke="var(--c1)" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M7 4.5h11l-2.6 3.6L18 11.7H7z" fill="var(--c2)" />
    <circle cx="5" cy="3" r="1.9" fill="var(--c1)" />
  </svg>
)

/** A pulse trace: how the thing is doing, not what it is. */
export const IconHealth: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <circle cx="12" cy="12" r="9" fill="var(--c5)" opacity=".18" />
    <path
      d="M4 12.5h3.2l2-4.4 2.6 8 2.2-5.1 1.3 1.5H20"
      stroke="var(--c5)"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Lines arriving: what has been said about this lately. */
export const IconUpdates: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <rect x="3" y="4.5" width="18" height="13" rx="2.6" fill="var(--c1)" opacity=".16" />
    <path d="M6.5 9h11M6.5 12.4h11M6.5 15.8h6.5" stroke="var(--c1)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="18.6" cy="17.6" r="3.4" fill="var(--c2)" />
  </svg>
)

/** A hand up: something is in the way and somebody has to move it. */
export const IconBlocker: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <path d="M8.6 2.7h6.8L20.3 7.6v6.8L15.4 19.3H8.6L3.7 14.4V7.6z" fill="var(--c3)" opacity=".22" />
    <path
      d="M8.6 2.7h6.8L20.3 7.6v6.8L15.4 19.3H8.6L3.7 14.4V7.6z"
      stroke="var(--c3)"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
    <path d="M12 7.3v4.6" stroke="var(--c3)" strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="12" cy="15.1" r="1.25" fill="var(--c3)" />
  </svg>
)

/** A fork in the road: two ways on, somebody has to pick. */
export const IconDecision: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <path
      d="M12 21v-5.5m0 0L6.5 10V6m5.5 9.5L17.5 10V6"
      stroke="var(--c4)"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="6.5" cy="4.4" r="2.6" fill="var(--c4)" />
    <circle cx="17.5" cy="4.4" r="2.6" fill="var(--c2)" />
  </svg>
)

/** A ticked box: somebody said they would do it. */
export const IconAction: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.2" fill="var(--c5)" opacity=".18" />
    <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.2" stroke="var(--c5)" strokeWidth="1.9" />
    <path d="M7.6 12.3l3 3 5.8-6.2" stroke="var(--c5)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Two links of a chain: this cannot move until that does. */
export const IconDependency: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <path
      d="M10 14.3a3.6 3.6 0 0 1 0-5l2.4-2.4a3.6 3.6 0 0 1 5 5l-1 1"
      stroke="var(--c1)"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
    <path
      d="M14 9.7a3.6 3.6 0 0 1 0 5l-2.4 2.4a3.6 3.6 0 0 1-5-5l1-1"
      stroke="var(--c2)"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
  </svg>
)

/** A checklist on a clipboard: the things that must be true before starting. */
export const IconReadiness: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <rect x="4" y="3.6" width="16" height="17" rx="2.6" fill="var(--c1)" opacity=".16" />
    <rect x="4" y="3.6" width="16" height="17" rx="2.6" stroke="var(--c1)" strokeWidth="1.8" />
    <rect x="8.6" y="1.9" width="6.8" height="3.6" rx="1.3" fill="var(--c1)" />
    <path d="M8 11.4l1.9 1.9 3.6-3.9" stroke="var(--c5)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 16.6h8" stroke="var(--c1)" strokeWidth="1.9" strokeLinecap="round" opacity=".55" />
  </svg>
)

/** A stack of cards: the initiatives grouped under an objective. */
export const IconInitiativesTile: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <rect x="3" y="7.4" width="18" height="13.2" rx="2.6" fill="var(--c1)" opacity=".18" />
    <rect x="3" y="7.4" width="18" height="13.2" rx="2.6" stroke="var(--c1)" strokeWidth="1.8" />
    <path d="M6 4.6h12M7.6 1.9h8.8" stroke="var(--c2)" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

/** Lanes running left to right: the projects delivering an initiative. */
export const IconProjectsTile: SectionIcon = ({ size = 20 }) => (
  <svg {...box(size)}>
    <rect x="2.6" y="4.4" width="12" height="4.2" rx="2.1" fill="var(--c5)" />
    <rect x="6.4" y="9.9" width="14" height="4.2" rx="2.1" fill="var(--c1)" opacity=".55" />
    <rect x="4.4" y="15.4" width="10" height="4.2" rx="2.1" fill="var(--c2)" opacity=".85" />
  </svg>
)
