'use server'

import { revalidatePath } from 'next/cache'
import { actorPersonId } from '@/lib/auth/current-user'
import { markAssessmentReviewed } from '@/lib/observations'

/**
 * Record that a person has read a machine-written assessment and stands behind
 * it. A review with no named reviewer is not a review, so this refuses when the
 * signed-in account has no person record rather than writing an anonymous one.
 */
export async function reviewAssessment(assessmentId: string) {
  const personId = await actorPersonId()
  if (!personId) {
    throw new Error('No person record for the signed-in account, so this review cannot be attributed.')
  }
  await markAssessmentReviewed(assessmentId, personId)
  revalidatePath('/initiatives')
  revalidatePath('/projects')
}
