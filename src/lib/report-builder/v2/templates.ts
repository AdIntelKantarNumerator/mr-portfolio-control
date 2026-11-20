/**
 * Report Builder V2's templates (20 November 2026), from the "templates" tab
 * of the Report Builder priority sheet (PRD: IS Report Builder). Plain specs,
 * the same shape as the engine's own templates, so the engine validates and
 * runs them like any other. The live engine lists them in its catalog; V1
 * never offers them (tools.ts MODE_TEMPLATES), V2 does (MODE_TEMPLATES_V2).
 *
 * What the sheet asks for that GPC does not carry yet is left out and said so
 * in the description: the TV/CTV schedule has day, program and ad, not time
 * of day or pod position.
 */
type TimeSpec = { mode?: string; unit?: string; count?: number }

export const V2_TEMPLATES = (recent: TimeSpec, weeks: TimeSpec, noCompare: object, noZero: object) => [
  // Competitive Intel, buy side
  { id: 'competitive_media_mix', label: 'Competitive media mix', description: "Where each competitor's brands and products run, by media", spec: { template: 'competitive_media_mix', rows: ['top_parent', 'advertiser', 'product'], columns: 'media_type', measures: ['spend', 'impressions', 'occurrences'], compare: noCompare, time: recent } },
  { id: 'local_market_footprint', label: 'Local market footprint', description: 'Where competitors advertise by market, and how much is local vs. national', spec: { template: 'local_market_footprint', rows: ['advertiser', 'market'], columns: 'media_type', measures: ['spend', 'impressions', 'occurrences'], compare: noCompare, time: recent } },
  { id: 'category_competitive_view', label: 'Category competitive view', description: 'Who advertises in a category, and in which media', spec: { template: 'category_competitive_view', rows: ['category', 'advertiser'], columns: 'media_type', measures: ['spend', 'impressions', 'occurrences'], time: recent } },
  { id: 'tv_schedule', label: 'TV/CTV schedule', description: 'Spot-level list: day, program and ad, by network', spec: { template: 'tv_schedule', rows: ['property', 'day', 'program', 'creative'], measures: ['occurrences', 'impressions'], time: weeks, output: 'csv' } },
  // Competitive Intel, sell side (publishers)
  { id: 'local_market_prospecting', label: 'Local market prospecting', description: 'Which advertisers are active in my markets, and in which media', spec: { template: 'local_market_prospecting', rows: ['advertiser', 'market'], columns: 'media_type', measures: ['occurrences', 'impressions', 'spend'], time: recent } },
  { id: 'category_prospecting', label: 'Category prospecting over time', description: "Who's spending in a category and how that's trending", spec: { template: 'category_prospecting', rows: ['category', 'advertiser'], columns: 'month', measures: ['spend'], time: recent } },
  { id: 'advertisers_on_my_properties', label: 'Advertisers on my properties', description: 'Who runs on my properties, by property and media', spec: { template: 'advertisers_on_my_properties', rows: ['advertiser', 'property'], columns: 'media_type', measures: ['spend'], zero_share: { ...noZero, mode: 'mine' }, time: recent } },
  { id: 'advertiser_drilldown', label: 'Advertiser brand drill-down', description: 'Brand and product detail for target advertisers', spec: { template: 'advertiser_drilldown', rows: ['top_parent', 'advertiser', 'product'], columns: 'media_type', measures: ['spend'], time: recent } },
]
