/**
 * A Migration Plan (Scott, 23 November 2026): what one client becomes in
 * Insights Studio. Every fact in it comes from the data; the model only
 * chooses among options the code worked out, and reviews the result.
 */
import type { MediaChange } from '../media-map'
import type { Platform } from '../types'
import type { AccountType, CountryCode, Role, SetKey } from './catalog'

export const PLAN_VERSION = 2

/** A choice and why it was made. */
export interface Reasoned<T> {
  value: T
  why: string
}

export interface PlanMedia {
  id: number
  name: string
  type: string
  /** kept: they have it today; added: new to them; premium: kept because they have it today. */
  status: 'kept' | 'added' | 'premium'
}

/** One Insights Studio client account under the organization. */
export interface PlanAccount {
  key: string
  name: string
  type: Reasoned<AccountType>
  /** The legacy accounts it replaces, "platform:id". */
  from: Array<{ key: string; platform: Platform; name: string; activeUsers: number }>
  why: string
  contract: { lookbackYears: Reasoned<number>; includePreliminary: Reasoned<boolean> }
  packages: Array<{ key: string; name: string; kind: 'base' | 'add_on'; why: string }>
  coverage: {
    media: PlanMedia[]
    /** Media in Insights Studio's catalogue but left out: premium they lack today. */
    withheld: Array<{ name: string; why: string }>
    countries: Array<{ code: CountryCode; name: string; why: string }>
    /** Restrictions today that the plan does not carry into the entitlement (they become workspaces). */
    widened: string[]
  }
  seats: number
}

export interface PlanUser {
  key: string
  name: string
  email: string | null
  account: string | null
  role: Reasoned<Role>
  create: Reasoned<boolean>
  lastSeen: string | null
  logins: Array<{ platform: Platform; account: string; login: string | null; lastSeen: string | null; active: boolean }>
}

export interface PlanWorkspaceItem {
  entityType: number
  name: string
  /** Where it came from: platform, the legacy list and id. */
  legacy: { platform: Platform; list: string; id: string }
  /** The Insights Studio (GPC) id, when it could be matched; null otherwise. */
  gpc: { id: string; name: string; how: string; guess?: boolean } | null
}

export interface PlanWorkspace {
  key: string
  account: string
  name: string
  source: string
  users: string[]
  sets: Array<{ set: SetKey; items: PlanWorkspaceItem[]; more: number }>
  why: string
}

export interface PlanImpact {
  media: Array<{ platform: Platform; change: MediaChange }>
  gains: string[]
  losses: string[]
  /** What Insights Studio V1 cannot express that they have today. */
  notInV1: string[]
}

export interface PlanReview {
  verdict: 'ok' | 'check' | 'problem'
  issues: string[]
  model: string | null
}

export interface MigrationPlan {
  version: number
  clientId: string
  client: string
  built: string
  depth: 'full' | 'light'
  summary: string[]
  organization: { name: string; why: string }
  accounts: PlanAccount[]
  users: PlanUser[]
  workspaces: PlanWorkspace[]
  impact: PlanImpact
  checklist: string[]
  review: PlanReview
  /** Advertisers to lead the Impact Deck with, per platform: the legacy ids the plan found most used. */
  deckFocus: Array<{ platform: Platform; taxonomy: 'VX1' | 'VX2'; items: Array<{ id: string; name: string }> }>
  notes: string[]
}
