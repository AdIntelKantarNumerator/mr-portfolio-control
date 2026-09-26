/**
 * Branding.
 *
 * Edit these three strings to re-badge the app. That is the whole mechanism —
 * they are deliberately not database settings, because the name in the header
 * changes roughly never and making it configurable only added a setup step
 * that could silently fail.
 *
 * The mark itself is in src/components/logo.tsx.
 */
export const BRAND_NAME = 'MR Portfolio Control'
export const BRAND_TAGLINE = "Yael's Always Right"

/**
 * Only the sign-in page still says who this belongs to.
 *
 * It was in the header of every screen, where it was read once by each person
 * and then occupied the top of the page forever. On the sign-in page it is
 * doing a job: telling somebody who landed on a URL they do not recognise
 * whose tool this is.
 */
export const BRAND_ORG = 'Program Management · MediaRadar Product & Tech'
