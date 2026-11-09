/**
 * The views of Taxonomy Comparison (Scott, 9 November 2026): the advertiser
 * comparison it began as, and the Industry View. The Data Dictionary's tab
 * bar, so the two Reference screens read alike.
 */
import Link from 'next/link'

export type TaxonomyView = 'advertisers' | 'industry'

const VIEWS: { key: TaxonomyView; href: string; label: string }[] = [
  { key: 'advertisers', href: '/taxonomy-comparison', label: 'Advertiser Comparison' },
  { key: 'industry', href: '/taxonomy-comparison/industry', label: 'Industry View' },
]

export function TaxonomyTabs({ current }: { current: TaxonomyView }) {
  return (
    <nav className="dd-tabs" aria-label="Taxonomy Comparison views">
      {VIEWS.map((v) => (
        <Link key={v.key} href={v.href} className={v.key === current ? 'on' : ''} aria-current={v.key === current ? 'page' : undefined}>
          {v.label}
        </Link>
      ))}
    </nav>
  )
}
