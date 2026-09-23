/**
 * MR Portfolio Control brand mark.
 *
 * Drawn as inline SVG rather than served as the source PNG so it stays crisp at
 * favicon size, recolours for dark mode, and costs no extra request. The raster
 * original is kept at /brand/mr-portfolio-control.png for decks and print.
 */
export const BRAND = {
  folder: '#e6b14b',
  folderDark: '#d49c33',
  check: '#1c3740',
  outline: '#14181c',
} as const

export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="MR Portfolio Control"
    >
      {/* Back panel of the folder, with the tab. */}
      <path
        d="M6 16a5 5 0 0 1 5-5h13.8a5 5 0 0 1 3.53 1.46l3.34 3.32A5 5 0 0 0 35.2 17.2H46a5 5 0 0 1 5 5v6H6z"
        fill={BRAND.folderDark}
        stroke={BRAND.outline}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Inner sheet peeking above the front flap. */}
      <path
        d="M15 22h27v13H15z"
        fill="#fff"
        stroke={BRAND.outline}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Front flap. */}
      <path
        d="M6 26h45a4 4 0 0 1 3.9 4.92l-4.2 18A5 5 0 0 1 45.83 53H11a5 5 0 0 1-5-5z"
        fill={BRAND.folder}
        stroke={BRAND.outline}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* The check — the whole point of the mark. */}
      <path
        d="M17.5 36.5 25 44l14-14.5"
        stroke={BRAND.check}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
