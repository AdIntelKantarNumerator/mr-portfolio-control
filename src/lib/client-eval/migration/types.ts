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
  /** starting: the package the account's applications stand for (Competitive for 360/Classic, Creative for Magnifier), not a gain. */
  packages: Array<{ key: string; name: string; kind: 'base' | 'add_on'; why: string; starting?: boolean }>
  coverage: {
    media: PlanMedia[]
    /** Media in Insights Studio's catalogue but left out: premium they lack today. */
    withheld: Array<{ name: string; why: string }>
    countries: Array<{ code: CountryCode; name: string; why: string }>
    /** Restrictions today that the plan does not carry into the entitlement (they become workspaces). */
    widened: string[]
    /**
     * Restrictions kept on the entitlement (agency holding companies): the account sees only these advertisers
     * and categories in Insights Studio, Creative Intel included.
     */
    limits?: Array<{ label: string; items: string[]; total: number }>
    /** Why the account is limited, when it is for a reason beyond keeping today's restrictions. */
    limitsWhy?: string
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

/**
 * A Magnifier saved search saved or updated in 2026, to recreate as an Insights Studio saved view (Creative
 * Intel keeps saved views as isappdata.dashboard rows of type 4; Insights Studio has no "saved searches").
 */
export interface PlanSavedView {
  key: string
  /** The plan user it belongs to. */
  user: string
  account: string | null
  title: string
  report: string | null
  country: string | null
  period: string | null
  keyword: string | null
  shared: boolean
  updated: string | null
  filters: Array<{ label: string; items: string[]; excluded: string[]; total: number }>
  media: string[]
}

/**
 * A 360 report used in 2026, proposed for migration (Scott, 24 November 2026). It can move only once Insights
 * Studio has its report builder, which does not exist yet: the tab is the list to migrate then.
 */
export interface PlanReport {
  key: string
  user: string
  account: string | null
  name: string
  type: string
  lastUsed: string | null
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
  /** How the accounts were planned (holding company, market accounts, or the model's split), and why. */
  mode?: { kind: 'holding' | 'markets' | 'standard'; why: string }
  /** Legacy accounts left out: inactive, or dormant (no login in 12 months and nothing run in 2026). */
  notMigrated?: Array<{ name: string; platform: Platform; why: string }>
  /** Why the legacy accounts are one client: the grouping's links between them (Client Evaluation's matching). */
  grouping?: Array<{ a: string; b: string; why: string }>
  /** Absent on plans built before 24 November 2026. */
  savedViews?: PlanSavedView[]
  /** 360 reports used in 2026; absent on plans built before 24 November 2026. */
  reports?: PlanReport[]
  impact: PlanImpact
  checklist: string[]
  review: PlanReview
  /** Advertisers to lead the Impact Deck with, per platform: the legacy ids the plan found most used. */
  deckFocus: Array<{ platform: Platform; taxonomy: 'VX1' | 'VX2'; items: Array<{ id: string; name: string }> }>
  notes: string[]
}
