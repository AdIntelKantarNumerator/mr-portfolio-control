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

/**
 * The joke, at the foot of the rail rather than under the name.
 *
 * In the header it sat directly beneath the product name, where a reader
 * trying to work out what this app is had to get past it first. At the bottom
 * of the navigation it is found by anyone who looks and is in nobody's way,
 * which is where a joke belongs.
 */
export const BRAND_CREDIT = 'Site Powered by Yaara'
export const BRAND_CREDIT_TAG = "Yael's Absolutely Always Right Actually"

/**
 * Only the sign-in page still says who this belongs to.
 *
 * It was in the header of every screen, where it was read once by each person
 * and then occupied the top of the page forever. On the sign-in page it is
 * doing a job: telling somebody who landed on a URL they do not recognise
 * whose tool this is.
 */
export const BRAND_ORG = 'Program Management · MediaRadar Product & Tech'
