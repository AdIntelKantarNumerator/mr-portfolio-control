/*
 * Report Builder engine (prototype, 11 November 2026).
 *
 * The whole report model in one plain-JavaScript file, so the same code runs
 * here (lib/report-builder/, behind the Open WebUI model) and in the
 * stand-alone demo page and Claude Desktop connector it came from.
 *
 * SAMPLE DATA: real advertiser and media names; each parent company's
 * 12-month total is close to its measured spend, and the split by brand,
 * property and month is simulated. Nothing here reads ClickHouse. In a real
 * build the same functions compile a report spec to a warehouse query instead
 * of looping over an in-memory array.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- sample data
  //
  // Real advertiser, brand and media names. Each parent company's 12-month total
  // is calibrated to its approximate measured spend (Oct 2025 – Aug 2026);
  // how that total splits across brands, properties and months is SIMULATED.
  // Figures are illustrative, not measured.

  const TAXONOMY = [
    ['Automotive', [['Vehicles', ['SUVs & Crossovers', 'Pickup Trucks', 'Electric Vehicles', 'Luxury Vehicles']]]],
    ['Consumer Packaged Goods', [['Household Care', ['Laundry Care']], ['Personal Care', ['Oral Care', 'Shaving', 'Hair Care', 'Skin & Body Care']], ['Pet Care', ['Pet Food']]]],
    ['Food & Beverage', [['Beverages', ['Soft Drinks', 'Coffee']], ['Snacks & Confectionery', ['Confectionery', 'Frozen Foods']]]],
    ['Financial Services', [['Banking & Cards', ['Credit Cards', 'Consumer Banking']], ['Insurance', ['Auto Insurance', 'Home Insurance']]]],
    ['Telecom', [['Wireless', ['Wireless Plans']], ['Home Connectivity', ['Internet & TV']]]],
    ['Media & Entertainment', [['Streaming', ['Video Streaming']], ['Movies & Parks', ['Movies', 'Theme Parks']]]],
    ['Retail & Restaurants', [['Retail', ['Online Retail', 'Mass Merchants']], ['Restaurants', ['Quick Service Restaurants']]]],
    ['Technology', [['Devices', ['Smartphones']], ['Software & Services', ['Creative Software', 'Search & AI']]]],
    ['Health & Pharma', [['Prescription Drugs', ['Immunology Rx', 'Diabetes & Weight Rx', 'Aesthetics']]]],
  ];

  // Parent company -> approximate 12-month measured spend, $ millions.
  const PARENT_SPEND = {
    'Amazon.com Inc': 4024, 'Procter & Gamble Co': 3429, 'Comcast Corp': 2858, 'Walt Disney Co': 2720, 'AbbVie Inc': 1792,
    'Alphabet Inc': 1707, 'Paramount Global': 1689, 'Fox Corp': 1476, 'Warner Bros. Discovery': 1447, 'Deutsche Telekom AG': 1436,
    'Progressive Corp': 1391, 'General Motors Co': 1364, 'AT&T Inc': 1292, 'Toyota Motor Corp': 1209, 'Walmart Inc': 1204,
    'Capital One Financial Corp': 1203, 'Berkshire Hathaway Inc': 1197, 'Verizon Communications Inc': 1181, 'Roark Capital Group': 1093,
    'Nestlé SA': 1049, 'Ford Motor Co': 894, 'JPMorgan Chase & Co': 889, 'Eli Lilly & Co': 886, 'Apple Inc': 831, 'Allstate Corp': 810,
    'Adobe Inc': 803, 'Liberty Mutual Group': 773, 'Unilever PLC': 772, 'Coca-Cola Co': 769, 'Yum! Brands Inc': 750, 'Mars Inc': 742,
    'Johnson & Johnson': 738, 'American Express Co': 732, 'Restaurant Brands International': 725, 'State Farm Mutual': 715, 'Nissan Motor Co': 708,
  };

  // [parent, advertiser, product, subcategory, share within parent]
  const PRODUCT_ROWS = [
    ['Amazon.com Inc', 'Amazon', 'Amazon.com', 'Online Retail', 6], ['Amazon.com Inc', 'Amazon', 'Amazon Prime', 'Online Retail', 3], ['Amazon.com Inc', 'Amazon', 'Prime Video', 'Video Streaming', 3],
    ['Procter & Gamble Co', 'Tide', 'Tide Pods', 'Laundry Care', 3], ['Procter & Gamble Co', 'Crest', 'Crest 3D White', 'Oral Care', 2], ['Procter & Gamble Co', 'Gillette', 'Gillette ProGlide', 'Shaving', 2], ['Procter & Gamble Co', 'Pantene', 'Pantene Pro-V', 'Hair Care', 2], ['Procter & Gamble Co', 'Olay', 'Olay Regenerist', 'Skin & Body Care', 2],
    ['Comcast Corp', 'Xfinity', 'Xfinity Internet', 'Internet & TV', 4], ['Comcast Corp', 'Xfinity', 'Xfinity Mobile', 'Wireless Plans', 2], ['Comcast Corp', 'Universal Pictures', 'Universal Pictures', 'Movies', 2], ['Comcast Corp', 'Universal Orlando', 'Universal Orlando Resort', 'Theme Parks', 1],
    ['Walt Disney Co', 'Disney+', 'Disney+', 'Video Streaming', 4], ['Walt Disney Co', 'Walt Disney Studios', 'Walt Disney Studios', 'Movies', 2], ['Walt Disney Co', 'Walt Disney World', 'Walt Disney World', 'Theme Parks', 2],
    ['AbbVie Inc', 'Skyrizi', 'Skyrizi', 'Immunology Rx', 4], ['AbbVie Inc', 'Rinvoq', 'Rinvoq', 'Immunology Rx', 4], ['AbbVie Inc', 'Botox', 'Botox Cosmetic', 'Aesthetics', 2],
    ['Alphabet Inc', 'Google', 'Google Pixel', 'Smartphones', 3], ['Alphabet Inc', 'Google', 'Google Gemini', 'Search & AI', 3], ['Alphabet Inc', 'YouTube TV', 'YouTube TV', 'Video Streaming', 2],
    ['Paramount Global', 'Paramount Pictures', 'Paramount Pictures', 'Movies', 2], ['Paramount Global', 'Pluto TV', 'Pluto TV', 'Video Streaming', 1],
    ['Fox Corp', 'Fox Nation', 'Fox Nation', 'Video Streaming', 1], ['Fox Corp', 'Tubi', 'Tubi', 'Video Streaming', 2],
    ['Warner Bros. Discovery', 'Warner Bros. Pictures', 'Warner Bros. Pictures', 'Movies', 3], ['Warner Bros. Discovery', 'Discovery+', 'Discovery+', 'Video Streaming', 1],
    ['Deutsche Telekom AG', 'T-Mobile', 'T-Mobile Go5G', 'Wireless Plans', 5], ['Deutsche Telekom AG', 'T-Mobile', 'T-Mobile Home Internet', 'Internet & TV', 2], ['Deutsche Telekom AG', 'Metro by T-Mobile', 'Metro by T-Mobile', 'Wireless Plans', 1],
    ['Progressive Corp', 'Progressive', 'Progressive Auto Insurance', 'Auto Insurance', 5], ['Progressive Corp', 'Progressive', 'Progressive Home Insurance', 'Home Insurance', 1],
    ['General Motors Co', 'Chevrolet', 'Chevrolet Silverado', 'Pickup Trucks', 3], ['General Motors Co', 'Chevrolet', 'Chevrolet Equinox EV', 'Electric Vehicles', 2], ['General Motors Co', 'GMC', 'GMC Sierra', 'Pickup Trucks', 2], ['General Motors Co', 'Cadillac', 'Cadillac Escalade', 'Luxury Vehicles', 1],
    ['AT&T Inc', 'AT&T', 'AT&T Wireless', 'Wireless Plans', 4], ['AT&T Inc', 'AT&T', 'AT&T Fiber', 'Internet & TV', 2],
    ['Toyota Motor Corp', 'Toyota', 'Toyota RAV4', 'SUVs & Crossovers', 3], ['Toyota Motor Corp', 'Toyota', 'Toyota Tacoma', 'Pickup Trucks', 2], ['Toyota Motor Corp', 'Toyota', 'Toyota bZ', 'Electric Vehicles', 1], ['Toyota Motor Corp', 'Lexus', 'Lexus RX', 'Luxury Vehicles', 2],
    ['Walmart Inc', 'Walmart', 'Walmart Stores', 'Mass Merchants', 4], ['Walmart Inc', 'Walmart', 'Walmart+', 'Online Retail', 2],
    ['Capital One Financial Corp', 'Capital One', 'Capital One Venture', 'Credit Cards', 4], ['Capital One Financial Corp', 'Capital One', 'Capital One 360', 'Consumer Banking', 2],
    ['Berkshire Hathaway Inc', 'GEICO', 'GEICO Auto Insurance', 'Auto Insurance', 5], ['Berkshire Hathaway Inc', 'GEICO', 'GEICO Homeowners', 'Home Insurance', 1],
    ['Verizon Communications Inc', 'Verizon', 'Verizon Unlimited', 'Wireless Plans', 4], ['Verizon Communications Inc', 'Verizon', 'Verizon Fios', 'Internet & TV', 2],
    ['Roark Capital Group', 'Subway', 'Subway', 'Quick Service Restaurants', 3], ['Roark Capital Group', "Arby's", "Arby's", 'Quick Service Restaurants', 2], ['Roark Capital Group', "Dunkin'", "Dunkin'", 'Quick Service Restaurants', 2],
    ['Nestlé SA', 'Purina', 'Purina Pro Plan', 'Pet Food', 3], ['Nestlé SA', 'Nespresso', 'Nespresso Vertuo', 'Coffee', 2], ['Nestlé SA', 'DiGiorno', 'DiGiorno Pizza', 'Frozen Foods', 1],
    ['Ford Motor Co', 'Ford', 'Ford F-150', 'Pickup Trucks', 3], ['Ford Motor Co', 'Ford', 'Ford Bronco', 'SUVs & Crossovers', 2], ['Ford Motor Co', 'Ford', 'Ford Mustang Mach-E', 'Electric Vehicles', 1],
    ['JPMorgan Chase & Co', 'Chase', 'Chase Sapphire', 'Credit Cards', 3], ['JPMorgan Chase & Co', 'Chase', 'Chase Checking', 'Consumer Banking', 2],
    ['Eli Lilly & Co', 'Zepbound', 'Zepbound', 'Diabetes & Weight Rx', 3], ['Eli Lilly & Co', 'Mounjaro', 'Mounjaro', 'Diabetes & Weight Rx', 2],
    ['Apple Inc', 'Apple', 'iPhone', 'Smartphones', 4], ['Apple Inc', 'Apple', 'Apple TV+', 'Video Streaming', 2],
    ['Allstate Corp', 'Allstate', 'Allstate Auto Insurance', 'Auto Insurance', 4], ['Allstate Corp', 'Allstate', 'Allstate Home Insurance', 'Home Insurance', 2],
    ['Adobe Inc', 'Adobe', 'Adobe Creative Cloud', 'Creative Software', 3], ['Adobe Inc', 'Adobe', 'Adobe Acrobat', 'Creative Software', 2],
    ['Liberty Mutual Group', 'Liberty Mutual', 'Liberty Mutual Auto Insurance', 'Auto Insurance', 4], ['Liberty Mutual Group', 'Liberty Mutual', 'Liberty Mutual Home Insurance', 'Home Insurance', 2],
    ['Unilever PLC', 'Dove', 'Dove Body Wash', 'Skin & Body Care', 3], ['Unilever PLC', 'Dove', 'Dove Hair Care', 'Hair Care', 1],
    ['Coca-Cola Co', 'Coca-Cola', 'Coca-Cola', 'Soft Drinks', 3], ['Coca-Cola Co', 'Coca-Cola', 'Coca-Cola Zero Sugar', 'Soft Drinks', 2], ['Coca-Cola Co', 'Sprite', 'Sprite', 'Soft Drinks', 1],
    ['Yum! Brands Inc', 'Taco Bell', 'Taco Bell', 'Quick Service Restaurants', 3], ['Yum! Brands Inc', 'KFC', 'KFC', 'Quick Service Restaurants', 2], ['Yum! Brands Inc', 'Pizza Hut', 'Pizza Hut', 'Quick Service Restaurants', 2],
    ['Mars Inc', "M&M's", "M&M's", 'Confectionery', 2], ['Mars Inc', 'Snickers', 'Snickers', 'Confectionery', 1], ['Mars Inc', 'Pedigree', 'Pedigree', 'Pet Food', 1],
    ['Johnson & Johnson', 'Tremfya', 'Tremfya', 'Immunology Rx', 3], ['Johnson & Johnson', 'Rybrevant', 'Rybrevant', 'Immunology Rx', 1],
    ['American Express Co', 'American Express', 'Amex Platinum Card', 'Credit Cards', 3], ['American Express Co', 'American Express', 'Amex Gold Card', 'Credit Cards', 2],
    ['Restaurant Brands International', 'Burger King', 'Burger King', 'Quick Service Restaurants', 3], ['Restaurant Brands International', 'Popeyes', 'Popeyes', 'Quick Service Restaurants', 2],
    ['State Farm Mutual', 'State Farm', 'State Farm Auto Insurance', 'Auto Insurance', 4], ['State Farm Mutual', 'State Farm', 'State Farm Home Insurance', 'Home Insurance', 2],
    ['Nissan Motor Co', 'Nissan', 'Nissan Rogue', 'SUVs & Crossovers', 3], ['Nissan Motor Co', 'Nissan', 'Nissan Frontier', 'Pickup Trucks', 1], ['Nissan Motor Co', 'Infiniti', 'Infiniti QX60', 'Luxury Vehicles', 1],
  ];

  // [property, media type, media owner, weight]; weights follow measured property spend,
  // with social damped because big national brands skew to TV.
  const PROPERTY_ROWS = [
    ['NBC', 'Linear TV', 'NBCUniversal', 5.0], ['CBS', 'Linear TV', 'Paramount', 4.3], ['ABC', 'Linear TV', 'Disney', 3.7], ['Fox', 'Linear TV', 'Fox Corp', 4.8],
    ['ESPN', 'Linear TV', 'Disney', 3.8], ['Fox News Channel', 'Linear TV', 'Fox Corp', 1.9], ['Telemundo', 'Linear TV', 'NBCUniversal', 1.3], ['TNT', 'Linear TV', 'Warner Bros. Discovery', 0.8],
    ['Bravo', 'Linear TV', 'NBCUniversal', 0.8], ['HGTV', 'Linear TV', 'Warner Bros. Discovery', 0.8], ['CNN', 'Linear TV', 'Warner Bros. Discovery', 0.9],
    ['Amazon Prime Video', 'CTV', 'Amazon', 5.4], ['Hulu', 'CTV', 'Disney', 5.4], ['Peacock TV', 'CTV', 'NBCUniversal', 3.2], ['Paramount Plus', 'CTV', 'Paramount', 1.9],
    ['HBO Max', 'CTV', 'Warner Bros. Discovery', 1.6], ['Netflix', 'CTV', 'Netflix', 1.5], ['Tubi TV', 'CTV', 'Fox Corp', 1.1], ['Roku Channel', 'CTV', 'Roku', 0.9],
    ['YouTube', 'Online Video', 'Google', 9.3],
    ['Facebook', 'Paid Social', 'Meta', 6], ['Instagram', 'Paid Social', 'Meta', 5.8], ['TikTok', 'Paid Social', 'ByteDance', 3.3],
    ['Yahoo', 'Digital Display', 'Yahoo', 2.5], ['New York Times', 'Digital Display', 'The New York Times Co', 0.9], ['Weather.com', 'Digital Display', 'The Weather Company', 0.85],
    ['Wall Street Journal', 'Print', 'Dow Jones', 0.64], ['People', 'Print', 'People Inc', 0.4],
    ['iHeartRadio', 'Radio', 'iHeartMedia', 0.6], ['Clear Channel Outdoor', 'Out of Home', 'Clear Channel Outdoor', 0.5],
  ];

  const MEDIA = {
    'Linear TV': { active: 0.6, cpo: 30000, cpm: 22, drift: -0.004 },
    'CTV': { active: 0.55, cpo: 4000, cpm: 34, drift: 0.016 },
    'Online Video': { active: 0.75, cpo: 1500, cpm: 18, drift: 0.008 },
    'Paid Social': { active: 0.7, cpo: 600, cpm: 9, drift: 0.006 },
    'Digital Display': { active: 0.55, cpo: 300, cpm: 5, drift: 0 },
    'Radio': { active: 0.35, cpo: 900, cpm: 8, drift: -0.003 },
    'Print': { active: 0.3, cpo: 60000, cpm: null, drift: -0.01 },
    'Out of Home': { active: 0.3, cpo: 12000, cpm: null, drift: 0.002 },
  };

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const BASE_YEAR = 2024;
  const MONTH_COUNT = 51; // Jan 2024 .. Mar 2028, so the demo can "load" new months
  const BASE_FINAL = (2026 - BASE_YEAR) * 12 + 7; // Aug 2026
  const PRELIM_LAG = 1; // preliminary data runs one month past final

  function rnd(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  function monthId(t) { const y = BASE_YEAR + Math.floor(t / 12); const m = t % 12; return y + '-' + String(m + 1).padStart(2, '0'); }
  function monthLabel(t) { return MONTH_NAMES[t % 12] + ' ' + (BASE_YEAR + Math.floor(t / 12)); }
  function parseMonth(id) { const m = /^(\d{4})-(\d{2})$/.exec(String(id || '')); if (!m) return null; const t = (Number(m[1]) - BASE_YEAR) * 12 + Number(m[2]) - 1; return t >= 0 && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? t : null; }

  // Dimension value tables: id -> { id, label, context }
  const VALUES = { industry: new Map(), category: new Map(), subcategory: new Map(), top_parent: new Map(), advertiser: new Map(), product: new Map(), media_type: new Map(), media_owner: new Map(), property: new Map() };
  function intern(dim, label, context) {
    for (const v of VALUES[dim].values()) if (v.label === label) return v.id;
    const id = dim + ':' + (VALUES[dim].size + 1);
    VALUES[dim].set(id, { id, dim, label, context: context || '' });
    return id;
  }

  const SUBCAT = new Map(); // subcategory label -> ids
  for (const [ind, cats] of TAXONOMY) {
    const industry = intern('industry', ind, 'Industry');
    for (const [cat, subs] of cats) {
      const category = intern('category', cat, ind);
      for (const sub of subs) SUBCAT.set(sub, { industry, category, subcategory: intern('subcategory', sub, ind + ' > ' + cat) });
    }
  }
  const PRODUCTS = PRODUCT_ROWS.map(([tp, adv, prod, sub, scale]) => {
    const node = SUBCAT.get(sub);
    if (!node) throw new Error('Unknown subcategory ' + sub);
    const top_parent = intern('top_parent', tp, 'Parent company');
    const advertiser = intern('advertiser', adv, tp);
    const product = intern('product', prod, adv + ' · ' + sub);
    return { product, advertiser, top_parent, parent: tp, industry: node.industry, category: node.category, subcategory: node.subcategory, scale, name: prod };
  });
  const PROPS = PROPERTY_ROWS.map(([name, type, owner, weight]) => {
    const media_type = intern('media_type', type, 'Media type');
    const media_owner = intern('media_owner', owner, 'Media owner');
    const property = intern('property', name, type + ' · ' + owner);
    return { id: property, property, media_type, media_owner, type, weight, name };
  });

  const FACTS = [];
  PRODUCTS.forEach((p, pi) => {
    const growth = -0.008 + rnd('g|' + p.name) * 0.024;
    const amp = 0.1 + rnd('amp|' + p.name) * 0.25;
    const peak = Math.floor(rnd('peak|' + p.name) * 12);
    const rx = VALUES.category.get(p.category).label === 'Prescription Drugs';
    PROPS.forEach((m, mi) => {
      const md = MEDIA[m.type];
      let chance = md.active;
      if (rx && m.type === 'Paid Social') chance = 0.2;
      if (rx && m.type === 'Linear TV') chance = 0.9;
      if (rnd('a|' + p.name + '|' + m.name) >= chance) return;
      const fit = 0.5 + rnd('fit|' + p.name + '|' + m.name);
      for (let t = 0; t < MONTH_COUNT; t++) {
        const season = 1 + amp * Math.cos((2 * Math.PI * ((t % 12) - peak)) / 12);
        const trend = Math.pow(1 + growth + md.drift, t);
        const noise = 0.8 + rnd('n|' + p.name + '|' + m.name + '|' + t) * 0.4;
        FACTS.push({ p: pi, m: mi, t, raw: p.scale * m.weight * fit * season * trend * noise });
      }
    });
  });
  // Calibrate: each parent's 12 months to Aug 2026 match its measured total.
  (function () {
    const sums = {};
    for (const f of FACTS) if (f.t > BASE_FINAL - 12 && f.t <= BASE_FINAL) { const k = PRODUCTS[f.p].parent; sums[k] = (sums[k] || 0) + f.raw; }
    for (const f of FACTS) {
      const k = PRODUCTS[f.p].parent;
      const md = MEDIA[PROPS[f.m].type];
      f.spend = Math.round((f.raw * (PARENT_SPEND[k] || 500) * 1e6) / (sums[k] || 1));
      f.occurrences = Math.max(1, Math.round(f.spend / md.cpo));
      f.impressions = md.cpm ? Math.round((f.spend / md.cpm) * 1000) : null;
      delete f.raw;
    }
  })();

  // ---------------------------------------------------------------- catalog

  const DIMS = {
    industry: { label: 'Industry', plural: 'industries', group: 'what', of: (f) => PRODUCTS[f.p].industry },
    category: { label: 'Category', plural: 'categories', group: 'what', of: (f) => PRODUCTS[f.p].category },
    subcategory: { label: 'Subcategory', plural: 'subcategories', group: 'what', of: (f) => PRODUCTS[f.p].subcategory },
    top_parent: { label: 'Top parent', plural: 'top parents', group: 'who', of: (f) => PRODUCTS[f.p].top_parent },
    advertiser: { label: 'Advertiser', plural: 'advertisers', group: 'who', of: (f) => PRODUCTS[f.p].advertiser },
    product: { label: 'Product', plural: 'products', group: 'who', of: (f) => PRODUCTS[f.p].product },
    media_type: { label: 'Media type', plural: 'media types', group: 'where', of: (f) => PROPS[f.m].media_type },
    media_owner: { label: 'Media owner', plural: 'media owners', group: 'where', of: (f) => PROPS[f.m].media_owner },
    property: { label: 'Property', plural: 'properties', group: 'where', of: (f) => PROPS[f.m].property },
    month: { label: 'Month', plural: 'months', group: 'when', time: true, of: (f) => monthId(f.t) },
    quarter: { label: 'Quarter', plural: 'quarters', group: 'when', time: true, of: (f) => (BASE_YEAR + Math.floor(f.t / 12)) + '-Q' + (Math.floor((f.t % 12) / 3) + 1) },
    year: { label: 'Year', plural: 'years', group: 'when', time: true, of: (f) => String(BASE_YEAR + Math.floor(f.t / 12)) },
  };
  const GROUP_LABEL = { who: 'Who is advertising', what: 'What is advertised', where: 'Where it runs', when: 'When' };
  function labelOf(dim, id) {
    if (dim === 'month') { const t = parseMonth(id); return t == null ? id : monthLabel(t); }
    if (dim === 'quarter') { const m = /^(\d{4})-Q(\d)$/.exec(id); return m ? 'Q' + m[2] + ' ' + m[1] : id; }
    if (dim === 'year') return id;
    const v = VALUES[dim] && VALUES[dim].get(id);
    return v ? v.label : id;
  }

  const MEASURES = {
    spend: { label: 'Spend', type: 'money' },
    occurrences: { label: 'Occurrences', type: 'int' },
    impressions: { label: 'Impressions', type: 'int', note: 'Not measured for Print or Out of Home.' },
  };
  const CALCS = {
    share: { label: 'Share of total', note: 'Each row as a percent of the report total. Not available with a column breakdown.' },
    yoy: { label: 'Change vs prior year', note: 'Same period one year earlier, and the percent change. Not available with a column breakdown.' },
  };

  const TEMPLATES = [
    { id: 'advertiser_trend', label: 'Spend trend', description: 'How spend moves month by month', spec: { template: 'advertiser_trend', rows: ['advertiser'], columns: 'month', measures: ['spend'], time: { mode: 'rolling', unit: 'month', count: 12 } } },
    { id: 'media_mix', label: 'Media mix', description: 'How spend splits across media types', spec: { template: 'media_mix', rows: ['advertiser'], columns: 'media_type', measures: ['spend'], time: { mode: 'rolling', unit: 'month', count: 12 } } },
    { id: 'category_share', label: 'Category share', description: 'Who holds what share of a category', spec: { template: 'category_share', rows: ['advertiser'], measures: ['spend'], calcs: ['share'], time: { mode: 'rolling', unit: 'month', count: 12 } } },
    { id: 'zero_share', label: 'Zero share', description: 'Advertisers buying elsewhere but not on your properties', spec: { template: 'zero_share', rows: ['top_parent', 'advertiser'], measures: ['spend'], zero_share: { mine: [], versus: [] }, time: { mode: 'rolling', unit: 'month', count: 6 } } },
    { id: 'detail_extract', label: 'Detailed extract', description: 'Product-level rows by property and month, for a spreadsheet', spec: { template: 'detail_extract', rows: ['top_parent', 'advertiser', 'product', 'subcategory', 'media_type', 'property', 'month'], measures: ['spend', 'occurrences', 'impressions'], time: { mode: 'rolling', unit: 'month', count: 3 }, output: 'csv' } },
  ];

  const INLINE_ROW_LIMIT = 2000;

  // ---------------------------------------------------------------- helpers

  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function uniq(a) { return Array.from(new Set(a)); }

  function applyPatch(spec, patch) {
    const out = clone(spec) || {};
    if (!patch) return out;
    const at = (path, make) => {
      const parts = path.split('.'); let o = out;
      for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') { if (!make) return null; o[parts[i]] = {}; } o = o[parts[i]]; }
      return [o, parts[parts.length - 1]];
    };
    for (const [path, value] of Object.entries(patch.set || {})) { const [o, k] = at(path, true); if (value === null) delete o[k]; else o[k] = clone(value); }
    for (const [path, values] of Object.entries(patch.add || {})) { const [o, k] = at(path, true); o[k] = uniq([].concat(Array.isArray(o[k]) ? o[k] : [], values)); }
    for (const [path, values] of Object.entries(patch.remove || {})) { const ref = at(path, false); if (ref && Array.isArray(ref[0][ref[1]])) ref[0][ref[1]] = ref[0][ref[1]].filter((v) => !values.includes(v)); }
    return out;
  }

  function normalize(specIn) {
    const s = clone(specIn) || {};
    s.rows = Array.isArray(s.rows) ? uniq(s.rows) : [];
    s.columns = s.columns || null;
    s.measures = Array.isArray(s.measures) && s.measures.length ? uniq(s.measures) : ['spend'];
    s.calcs = Array.isArray(s.calcs) ? uniq(s.calcs) : [];
    s.filters = s.filters && typeof s.filters === 'object' ? s.filters : {};
    for (const k of Object.keys(s.filters)) { if (!Array.isArray(s.filters[k]) || !s.filters[k].length) delete s.filters[k]; }
    s.options = Object.assign({ final_only: true, top_n: null }, s.options || {});
    if (s.zero_share) s.zero_share = { mine: s.zero_share.mine || [], versus: s.zero_share.versus || [], all: !!s.zero_share.all, own: !!s.zero_share.own };
    return s;
  }

  function resolveTime(time, through) {
    const notes = [];
    const t = time || { mode: 'rolling', unit: 'month', count: 12 };
    let start, end, how, moves = true;
    if (t.mode === 'static') {
      start = parseMonth(t.start); end = parseMonth(t.end); moves = false; how = 'fixed period';
      if (start == null || end == null || end < start) return { error: 'The fixed period needs a start and end month written like 2026-01, with the end on or after the start.' };
      if (start > through) return { error: 'That period starts after the latest available data (' + monthLabel(through) + ').' };
      if (end > through) { notes.push('Data runs through ' + monthLabel(through) + ', so the period stops there instead of ' + monthLabel(end) + '.'); end = through; }
    } else if (t.mode === 'ytd') {
      end = through; start = through - (through % 12); how = 'year to date';
    } else {
      const n = Math.max(1, Math.min(36, Number(t.count) || 1));
      if (t.unit === 'quarter') { end = through; while (end % 3 !== 2) end--; start = end - 3 * n + 1; how = n === 1 ? 'last complete quarter' : 'last ' + n + ' complete quarters'; }
      else if (t.unit === 'year') { end = through; while (end % 12 !== 11) end--; start = end - 12 * n + 1; how = n === 1 ? 'last complete year' : 'last ' + n + ' complete years'; }
      else { end = through; start = end - n + 1; how = n === 1 ? 'latest complete month' : 'last ' + n + ' complete months'; }
    }
    if (start < 0) { notes.push('Data starts in ' + monthLabel(0) + ', so the period starts there.'); start = 0; }
    const label = start === end ? monthLabel(start) : monthLabel(start) + ' – ' + monthLabel(end);
    return { start, end, label, how, moves, notes };
  }

  function filterLabels(filters, groups) {
    const out = [];
    for (const [dim, ids] of Object.entries(filters || {})) { if (DIMS[dim] && (!groups || groups.includes(DIMS[dim].group))) for (const id of ids) out.push(labelOf(dim, id)); }
    return out;
  }
  function listText(items, max) {
    max = max || 4;
    if (items.length <= max) return items.join(', ');
    return items.slice(0, max).join(', ') + ' and ' + (items.length - max) + ' more';
  }

  function makeFilter(filters) {
    const groups = { who: [], what: [], where: [] };
    for (const [dim, ids] of Object.entries(filters || {})) { const d = DIMS[dim]; if (d && groups[d.group]) groups[d.group].push([d.of, new Set(ids)]); }
    // Within a group (who / what / where) selections are OR-ed; groups are AND-ed.
    const test = (g) => (f) => { if (!groups[g].length) return true; for (const [of, set] of groups[g]) if (set.has(of(f))) return true; return false; };
    const who = test('who'), what = test('what'), where = test('where');
    return { all: (f) => who(f) && what(f) && where(f), subject: (f) => who(f) && what(f), where };
  }

  // ---------------------------------------------------------------- engine

  function create(config) {
    config = config || {};
    const mem = { saved: [], offset: 0, seq: 0 };
    const store = config.store || { load: () => mem, save: () => {} };
    const now = config.now || (() => new Date().toISOString());
    function state() { const s = store.load() || {}; s.saved = s.saved || []; s.offset = s.offset || 0; s.seq = s.seq || 0; return s; }

    function finalIdx() { return Math.min(MONTH_COUNT - 1 - PRELIM_LAG, BASE_FINAL + state().offset); }
    function throughIdx(spec) { return spec.options.final_only ? finalIdx() : finalIdx() + PRELIM_LAG; }

    function availability() {
      const f = finalIdx();
      return { final_through: monthId(f), final_through_label: monthLabel(f), preliminary_through: monthId(f + PRELIM_LAG), preliminary_through_label: monthLabel(f + PRELIM_LAG), earliest: monthId(0), earliest_label: monthLabel(0), sample_data: true };
    }

    function catalog() {
      return {
        sample_data: true,
        dimensions: Object.entries(DIMS).map(([key, d]) => ({ key, label: d.label, group: d.group, group_label: GROUP_LABEL[d.group], can_filter: !d.time, can_be_columns: ['month', 'quarter', 'year', 'media_type', 'property', 'industry', 'category'].includes(key), values: d.time ? undefined : VALUES[key].size })),
        measures: Object.entries(MEASURES).map(([key, m]) => ({ key, label: m.label, note: m.note })),
        calcs: Object.entries(CALCS).map(([key, c]) => ({ key, label: c.label, note: c.note })),
        time: [
          { mode: 'rolling', example: { mode: 'rolling', unit: 'month', count: 12 }, note: 'Last N complete months, quarters or years. Moves forward when new data loads, so it suits saved reports.' },
          { mode: 'ytd', example: { mode: 'ytd' }, note: 'January through the latest available month. Also moves with new data.' },
          { mode: 'static', example: { mode: 'static', start: '2026-01', end: '2026-06' }, note: 'A fixed range of months. Does not move.' },
        ],
        templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description, spec: clone(t.spec) })),
        rules: [
          'Filters inside one group (who, what, where) are combined with OR; the groups are combined with AND.',
          'Share of total and change vs prior year cannot be combined with a column breakdown.',
          'With a column breakdown, only the first measure is shown.',
          'Impressions are not measured for Print or Out of Home.',
          'Results above ' + INLINE_ROW_LIMIT + ' rows are delivered as a file, not inline.',
        ],
        data: availability(),
      };
    }

    const SPEND12 = {};
    (function () {
      for (const f of FACTS) { if (f.t > BASE_FINAL || f.t < BASE_FINAL - 11) continue; for (const dim of Object.keys(VALUES)) { const id = DIMS[dim].of(f); SPEND12[id] = (SPEND12[id] || 0) + f.spend; } }
    })();

    function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
    function search(query, opts) {
      opts = opts || {};
      const types = opts.types && opts.types.length ? opts.types.filter((t) => VALUES[t]) : Object.keys(VALUES);
      const q = norm(query);
      const hits = [];
      for (const dim of types) {
        for (const v of VALUES[dim].values()) {
          const l = norm(v.label);
          let score = 0;
          if (!q) score = 1;
          else if (l === q) score = 100;
          else if (l.startsWith(q)) score = 80;
          else if (l.split(' ').some((w) => w.startsWith(q))) score = 60;
          else if (l.includes(q)) score = 40;
          else if (q.split(' ').every((w) => l.includes(w))) score = 30;
          if (!score) continue;
          hits.push({ id: v.id, type: dim, type_label: DIMS[dim].label, label: v.label, context: v.context, spend_last_12_months: SPEND12[v.id] || 0, score });
        }
      }
      // Everyday words for the same things: "fast food" is Quick Service Restaurants.
      if (q) {
        for (const [alias, dim, label] of ALIASES) {
          if (!types.includes(dim)) continue;
          const match = alias === q || (q.length >= 3 && alias.startsWith(q)) || (alias.length >= 4 && (' ' + q + ' ').includes(' ' + alias + ' '));
          if (!match) continue;
          const v = Array.from(VALUES[dim].values()).find((x) => x.label === label);
          if (!v) continue;
          const score = alias === q ? 95 : 70;
          const had = hits.find((h) => h.id === v.id);
          if (had) had.score = Math.max(had.score, score);
          else hits.push({ id: v.id, type: dim, type_label: DIMS[dim].label, label: v.label, context: v.context, spend_last_12_months: SPEND12[v.id] || 0, score });
        }
      }
      hits.sort((a, b) => b.score - a.score || b.spend_last_12_months - a.spend_last_12_months);
      return hits.slice(0, opts.limit || 8).map((h) => { const o = Object.assign({}, h); delete o.score; return o; });
    }

    function summarize(specIn) {
      const s = normalize(specIn);
      const parts = [];
      const who = filterLabels(s.filters, ['who']), what = filterLabels(s.filters, ['what']), where = filterLabels(s.filters, ['where']);
      const rows = s.rows.map((d) => (DIMS[d] ? DIMS[d].label.toLowerCase() : d));
      if (s.zero_share) {
        const dimOf = (id) => String(id).split(':')[0];
        const mine = s.zero_share.mine.map((id) => labelOf(dimOf(id), id)), vs = s.zero_share.versus.map((id) => (dimOf(id) === 'property' ? '' : 'all ') + labelOf(dimOf(id), id));
        parts.push('Advertisers spending on ' + (vs.length ? listText(vs) : s.zero_share.all ? 'any other property' : 'other properties') + ' but nothing on ' + (mine.length ? listText(mine) : 'your properties'));
        if (rows.length) parts.push('listed by ' + rows.join(', then '));
      } else {
        const m = s.measures.map((k) => (MEASURES[k] ? MEASURES[k].label : k)).join(', ');
        let lead = m + (rows.length ? ' by ' + rows.join(', then ') : '');
        if (s.columns && DIMS[s.columns]) lead += ', with a column per ' + DIMS[s.columns].label.toLowerCase();
        parts.push(lead);
      }
      const scope = [];
      if (who.length) scope.push(listText(who));
      if (what.length) scope.push(listText(what));
      if (where.length) scope.push((s.zero_share ? 'competing media limited to ' : 'on ') + listText(where));
      parts.push(scope.length ? scope.join(' · ') : 'all advertisers');
      const per = resolveTime(s.time, throughIdx(s));
      if (!per.error) parts.push(per.label + ' (' + per.how + ')');
      parts.push(s.options.final_only ? 'final data only' : 'including preliminary data');
      if (s.calcs.includes('share')) parts.push('with share of total');
      if (s.calcs.includes('yoy')) parts.push('with change vs prior year');
      if (s.options.top_n) parts.push('top ' + s.options.top_n + ' rows');
      return parts.join(' · ');
    }

    function run(specIn, opts) {
      opts = opts || {};
      const spec = normalize(specIn);
      const through = throughIdx(spec);
      const per = resolveTime(spec.time, through);
      if (per.error) throw new Error(per.error);
      const notes = per.notes.slice();
      const R = spec.rows.filter((d) => DIMS[d]);
      const C = spec.columns && DIMS[spec.columns] ? spec.columns : null;
      const M = spec.measures.filter((k) => MEASURES[k]);
      const primary = M[0] || 'spend';
      const calcs = C ? [] : spec.calcs;
      const zs = spec.zero_share;
      const pass = makeFilter(spec.filters);
      // A drill-down path (the tree view): only rows under these values, AND-ed, whatever the filters say.
      const pathEntries = Object.entries(spec.path || {}).filter(([d]) => DIMS[d]);
      const onPath = (f) => pathEntries.every(([d, id]) => String(DIMS[d].of(f)) === String(id));
      // Yours and theirs: ids of properties, media types or media owners.
      const matcher = (ids) => { const by = ids.map((id) => [String(id).split(':')[0], String(id)]).filter(([d]) => DIMS[d]); return (f) => by.some(([d, id]) => String(DIMS[d].of(f)) === id); };
      const isMine = matcher(zs ? zs.mine : []), isVersus = zs && zs.versus.length ? matcher(zs.versus) : null;
      const groups = new Map();
      const colTotals = new Map(); // value -> primary measure, for ordering
      const colTotalsM = new Map(); // value -> every measure, for the totals row
      const grp = (f) => {
        const ids = R.map((d) => DIMS[d].of(f)); const k = ids.join('\u0001');
        let g = groups.get(k);
        if (!g) { g = { ids, v: { spend: 0, occurrences: 0, impressions: 0 }, imp: false, cols: new Map(), mine: 0, prior: 0 }; groups.set(k, g); }
        return g;
      };
      for (const f of FACTS) {
        if (f.t < per.start || f.t > per.end) continue;
        if (zs) {
          if (!pass.subject(f) || !onPath(f)) continue;
          if (isMine(f)) { grp(f).mine += f.spend; continue; }
          if (isVersus && !isVersus(f)) continue;
          if (!pass.where(f)) continue;
        } else if (!pass.all(f) || !onPath(f)) continue;
        const g = grp(f);
        g.v.spend += f.spend; g.v.occurrences += f.occurrences;
        if (f.impressions != null) { g.v.impressions += f.impressions; g.imp = true; }
        if (C) {
          const c = DIMS[C].of(f);
          for (const target of [g.cols, colTotalsM]) {
            let o = target.get(c);
            if (!o) { o = { spend: 0, occurrences: 0, impressions: 0 }; target.set(c, o); }
            o.spend += f.spend; o.occurrences += f.occurrences; if (f.impressions != null) o.impressions += f.impressions;
          }
          colTotals.set(c, (colTotals.get(c) || 0) + (f[primary] || 0));
        }
      }
      if (calcs.includes('yoy')) {
        if (per.start - 12 < 0) notes.push('There is no data a full year before this period, so prior-year figures are partial.');
        for (const f of FACTS) { if (f.t < per.start - 12 || f.t > per.end - 12 || !pass.all(f)) continue; grp(f).prior += f[primary] || 0; }
      }
      let list = Array.from(groups.values());
      if (zs) list = list.filter((g) => g.mine === 0 && g.v.spend > 0);

      const columns = R.map((d) => ({ key: d, label: DIMS[d].label, type: 'text' }));
      const mLabel = (k) => (zs && k === 'spend' ? 'Spend on competing properties' : MEASURES[k].label);
      let colIds = [];
      if (C) {
        colIds = Array.from(colTotals.keys());
        if (DIMS[C].time) colIds.sort(); else colIds.sort((a, b) => colTotals.get(b) - colTotals.get(a));
        // Fixed columns (a tree's lower levels keep the top level's columns).
        if (Array.isArray(spec.col_ids)) colIds = spec.col_ids.slice();
        // One column per value and measure. With several measures, the page stacks a value's
        // measures in one cell (group); the spreadsheet keeps a column each.
        const many = M.length > 1;
        for (const c of colIds) for (const k of M) columns.push({ key: 'c:' + c + (many ? ':' + k : ''), label: labelOf(C, c) + (many ? ' · ' + MEASURES[k].label : ''), type: MEASURES[k].type, colId: c, group: labelOf(C, c), measure: MEASURES[k].label });
        for (const k of M) columns.push({ key: many ? 'total:' + k : 'total', label: 'Total ' + MEASURES[k].label.toLowerCase(), type: MEASURES[k].type, group: 'Total', measure: MEASURES[k].label });
      } else {
        M.forEach((k, i) => {
          columns.push({ key: k, label: mLabel(k), type: MEASURES[k].type });
          if (i === 0 && calcs.includes('share')) columns.push({ key: 'share', label: 'Share of total', type: 'pct' });
          if (i === 0 && calcs.includes('yoy')) { columns.push({ key: 'prior', label: 'Same period, prior year', type: MEASURES[k].type }); columns.push({ key: 'change', label: 'Change', type: 'change' }); }
        });
      }

      const primaryOf = (g) => g.v[primary] || 0;
      if (R.length && DIMS[R[0]].time) list.sort((a, b) => (a.ids.join('\u0001') < b.ids.join('\u0001') ? -1 : 1));
      else list.sort((a, b) => primaryOf(b) - primaryOf(a));

      const tot = { spend: 0, occurrences: 0, impressions: 0, imp: false, prior: 0 };
      for (const g of list) { tot.spend += g.v.spend; tot.occurrences += g.v.occurrences; tot.impressions += g.v.impressions; tot.imp = tot.imp || g.imp; tot.prior += g.prior; }
      const totalPrimary = tot[primary] || 0;
      const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
      const cellRow = (ids, v, imp, cols, prior, isTotal) => {
        const row = isTotal ? R.map((d, i) => (i === 0 ? 'Total' : '')) : R.map((d, i) => labelOf(d, ids[i]));
        if (C) {
          for (const c of colIds) for (const k of M) { const o = isTotal ? colTotalsM.get(c) : cols.get(c); row.push(o ? o[k] || 0 : 0); }
          for (const k of M) row.push(v[k] || 0);
        }
        else M.forEach((k, i) => {
          row.push(k === 'impressions' && !imp ? null : v[k]);
          if (i === 0 && calcs.includes('share')) row.push(pct(v[k], totalPrimary));
          if (i === 0 && calcs.includes('yoy')) { row.push(prior); row.push(prior ? Math.round(((v[k] - prior) / prior) * 1000) / 10 : null); }
        });
        return row;
      };

      const matched = list.length;
      if (spec.options.top_n && matched > spec.options.top_n) { list = list.slice(0, spec.options.top_n); notes.push('Showing the top ' + spec.options.top_n + ' of ' + matched + ' rows; the total covers all ' + matched + '.'); }
      let rows = list.map((g) => cellRow(g.ids, g.v, g.imp, g.cols, g.prior, false));
      let keys = list.map((g) => g.ids.map(String));
      const totals = R.length ? cellRow([], tot, tot.imp, null, tot.prior, true) : null;
      const rowCount = rows.length;
      let truncated = false;
      if (opts.limit && rows.length > opts.limit) { rows = rows.slice(0, opts.limit); keys = keys.slice(0, opts.limit); truncated = true; }
      if (!spec.options.final_only) notes.push('Figures for ' + monthLabel(through) + ' are preliminary and can still change.');
      if (!matched) notes.push(zs ? 'No advertisers matched: everyone in scope who spent on the competing properties also spent on yours.' : 'No spend matched these selections in this period.');
      return {
        columns, rows, keys, totals, row_count: rowCount, rows_shown: rows.length, truncated,
        total: totalPrimary, total_measure: MEASURES[primary].label,
        period: { start: monthId(per.start), end: monthId(per.end), label: per.label, how: per.how, moves_with_new_data: per.moves },
        data_through: monthId(through), data_through_label: monthLabel(through),
        summary: summarize(spec), notes, sample_data: true,
      };
    }

    function fmtCell(type, v) {
      if (v == null || v === '') return type === 'text' ? '' : '–';
      if (type === 'money') return '$' + Math.round(v).toLocaleString('en-US');
      if (type === 'int') return Math.round(v).toLocaleString('en-US');
      if (type === 'pct') return v.toFixed(1) + '%';
      if (type === 'change') return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
      return String(v);
    }
    // A ready-to-show Markdown table, so the chat model never reformats numbers.
    function markdown(result, max) {
      const cols = result.columns;
      const esc = (s) => String(s).replace(/\|/g, '\\|');
      const line = (cells) => '| ' + cells.map(esc).join(' | ') + ' |';
      const out = [line(cols.map((c) => c.label)), '| ' + cols.map((c) => (c.type === 'text' ? '---' : '---:')).join(' | ') + ' |'];
      const rows = result.rows.slice(0, max || result.rows.length);
      for (const r of rows) out.push(line(r.map((v, i) => fmtCell(cols[i].type, v))));
      if (result.totals) out.push(line(result.totals.map((v, i) => { const s = fmtCell(cols[i].type, v); return s ? '**' + s + '**' : ''; })));
      return out.join('\n');
    }

    function csv(result) {
      const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
      const lines = [result.columns.map((c) => esc(c.label)).join(',')];
      for (const r of result.rows) lines.push(r.map(esc).join(','));
      if (result.totals) lines.push(result.totals.map(esc).join(','));
      return lines.join('\r\n') + '\r\n';
    }

    function topOptions(types, n, toPatch) {
      return search('', { types, limit: n }).map((h) => ({ label: h.label, description: h.type_label + (h.context && h.type !== 'top_parent' && h.type !== 'industry' ? ' · ' + h.context : ''), patch: toPatch(h) }));
    }

    // Choices for "who do you compete with": the biggest properties in your media, all of your media, or everything.
    function competitorOptions(mine) {
      const ours = PROPS.filter((p) => mine.includes(p.id) || mine.includes(p.media_owner));
      const out = [];
      const media = ours.length ? ours[0].media_type : null;
      if (media) {
        PROPS.filter((p) => p.media_type === media && !ours.includes(p)).sort((x, y) => y.weight - x.weight).slice(0, 4)
          .forEach((p) => out.push({ label: labelOf('property', p.id), description: 'Property · ' + labelOf('media_type', media), patch: { add: { 'zero_share.versus': [p.id] } } }));
        out.push({ label: 'All other ' + labelOf('media_type', media), description: 'Every ' + labelOf('media_type', media) + ' property but yours', patch: { set: { 'zero_share.versus': [media] } } });
      }
      out.push({ label: 'All other properties', description: 'Any media, any property but yours', patch: { set: { 'zero_share.all': true } } });
      return out;
    }

    function validate(specIn, patch) {
      const spec = normalize(applyPatch(specIn || {}, patch));
      const errors = [], warnings = [], questions = [];
      const badDims = spec.rows.concat(spec.columns ? [spec.columns] : []).concat(Object.keys(spec.filters)).filter((d) => !DIMS[d]);
      if (badDims.length) errors.push({ code: 'unknown_dimension', message: 'Unknown dimension: ' + uniq(badDims).join(', ') + '. Use keys from getReportCatalog.', fixes: [] });
      const badM = spec.measures.filter((m) => !MEASURES[m]);
      if (badM.length) errors.push({ code: 'unknown_measure', message: 'Unknown measure: ' + badM.join(', ') + '.', fixes: [{ label: 'Use spend', patch: { set: { measures: ['spend'] } } }] });
      const badC = spec.calcs.filter((c) => !CALCS[c]);
      if (badC.length) errors.push({ code: 'unknown_calc', message: 'Unknown calculation: ' + badC.join(', ') + '.', fixes: [{ label: 'Remove it', patch: { remove: { calcs: badC } } }] });
      for (const [dim, ids] of Object.entries(spec.filters)) { if (!DIMS[dim] || DIMS[dim].time) continue; const bad = ids.filter((id) => !VALUES[dim].has(id)); if (bad.length) errors.push({ code: 'unknown_value', message: 'These ' + DIMS[dim].label.toLowerCase() + ' ids do not exist: ' + bad.join(', ') + '. Look names up with searchEntities.', fixes: [{ label: 'Remove them', patch: { remove: { ['filters.' + dim]: bad } } }] }); }
      if (spec.columns && spec.rows.includes(spec.columns)) errors.push({ code: 'dimension_twice', message: DIMS[spec.columns] ? DIMS[spec.columns].label + ' is used for both rows and columns.' : 'A dimension is used for both rows and columns.', fixes: [{ label: 'Keep it as columns', patch: { remove: { rows: [spec.columns] } } }, { label: 'Keep it as rows', patch: { set: { columns: null } } }] });
      if (spec.columns && spec.calcs.length) errors.push({ code: 'calc_with_columns', message: 'Share of total and change vs prior year cannot be combined with a column per ' + (DIMS[spec.columns] ? DIMS[spec.columns].label.toLowerCase() : 'value') + '.', fixes: [{ label: 'Drop the column breakdown', patch: { set: { columns: null } } }, { label: 'Drop the calculation', patch: { set: { calcs: [] } } }] });
      const per = spec.time ? resolveTime(spec.time, throughIdx(spec)) : null;
      if (per && per.error) errors.push({ code: 'bad_period', message: per.error, fixes: [{ label: 'Use the last 12 complete months', patch: { set: { time: { mode: 'rolling', unit: 'month', count: 12 } } } }] });

      const hasSubject = Object.keys(spec.filters).some((d) => DIMS[d] && (DIMS[d].group === 'who' || DIMS[d].group === 'what'));
      const hasWhat = Object.keys(spec.filters).some((d) => DIMS[d] && DIMS[d].group === 'what');
      const addFilter = (h) => ({ add: { ['filters.' + h.type]: [h.id] } });

      if (!spec.rows.length) {
        questions.push({ id: 'template', prompt: 'What kind of report do you want?', kind: 'choice', options: TEMPLATES.map((t) => ({ label: t.label, description: t.description, patch: { set: clone(t.spec) } })) });
      } else if (spec.zero_share && !spec.zero_share.mine.length) {
        questions.push({ id: 'my_properties', prompt: 'Which properties are yours?', kind: 'entity', multi: true, entity_types: ['property', 'media_owner'], patch_path: 'zero_share.mine', options: topOptions(['property'], 6, (h) => ({ add: { 'zero_share.mine': [h.id] } })) });
      } else if (spec.zero_share && !spec.zero_share.versus.length && !spec.zero_share.all) {
        questions.push({ id: 'competitors', prompt: 'Which properties do you compete with?', kind: 'entity', multi: true, entity_types: ['property', 'media_type', 'media_owner'], patch_path: 'zero_share.versus', options: competitorOptions(spec.zero_share.mine) });
      } else if (spec.template === 'category_share' && !hasWhat && spec.scope !== 'all') {
        questions.push({ id: 'category', prompt: 'Which category should the shares be measured in?', kind: 'entity', multi: true, entity_types: ['industry', 'category', 'subcategory'], options: topOptions(['category'], 5, addFilter).concat([{ label: 'All categories', description: 'Share of total spend', patch: { set: { scope: 'all' } } }]) });
      } else if (!spec.zero_share && !hasSubject && spec.scope !== 'all') {
        questions.push({ id: 'subject', prompt: 'Which advertisers, products or categories?', kind: 'entity', multi: true, entity_types: ['top_parent', 'advertiser', 'product', 'industry', 'category', 'subcategory'], options: topOptions(['advertiser'], 5, addFilter).concat([{ label: 'Everything', description: 'No filter', patch: { set: { scope: 'all' } } }]) });
      } else if (!spec.time) {
        questions.push({ id: 'time', prompt: 'What time period?', kind: 'choice', options: [
          { label: 'Last 12 months', patch: { set: { time: { mode: 'rolling', unit: 'month', count: 12 } } } },
          { label: 'Last 3 months', patch: { set: { time: { mode: 'rolling', unit: 'month', count: 3 } } } },
          { label: 'Year to date', patch: { set: { time: { mode: 'ytd' } } } },
          { label: 'Last full quarter', patch: { set: { time: { mode: 'rolling', unit: 'quarter', count: 1 } } } },
        ] });
      }

      const ok = !errors.length && !questions.length;
      let rowCount = null;
      const refinements = [];
      if (ok) {
        const res = run(spec);
        rowCount = res.row_count;
        const whereIds = filterLabels(spec.filters, ['where']);
        if (spec.measures.includes('impressions') && spec.filters.media_type && spec.filters.media_type.every((id) => ['Print', 'Out of Home'].includes(labelOf('media_type', id)))) warnings.push('Impressions are not measured for Print or Out of Home, so that column will be blank.');
        if (rowCount > INLINE_ROW_LIMIT) warnings.push('This is a large extract (' + rowCount.toLocaleString('en-US') + ' rows). It will be delivered as a file.');
        if (spec.time && spec.time.mode === 'static') warnings.push('This period is fixed. If the report is saved, re-running it will not pick up newer months.');
        void whereIds;
        const tm = spec.time || {};
        const isRolling = (u, c) => tm.mode === 'rolling' && (tm.unit || 'month') === u && Number(tm.count) === c;
        const add = (label, p) => refinements.push({ label, patch: p });
        if (!spec.columns && !spec.rows.some((d) => DIMS[d].time)) add('Add a column per month', { set: { columns: 'month', calcs: [] } });
        if (spec.columns) add('Remove the column breakdown', { set: { columns: null } });
        if (!spec.rows.includes('product')) add('Break out by product', { add: { rows: ['product'] } });
        if (!spec.rows.includes('media_type') && spec.columns !== 'media_type') add('Break out by media type', { add: { rows: ['media_type'] } });
        if (!isRolling('month', 3)) add('Last 3 months', { set: { time: { mode: 'rolling', unit: 'month', count: 3 } } });
        if (!isRolling('month', 12)) add('Last 12 months', { set: { time: { mode: 'rolling', unit: 'month', count: 12 } } });
        if (tm.mode !== 'ytd') add('Year to date', { set: { time: { mode: 'ytd' } } });
        if (!spec.columns && !spec.zero_share && !spec.calcs.includes('yoy')) add('Compare with prior year', { add: { calcs: ['yoy'] } });
        if (!spec.columns && !spec.zero_share && !spec.calcs.includes('share')) add('Add share of total', { add: { calcs: ['share'] } });
        if (spec.zero_share && spec.zero_share.versus.length) add('Compare with all other properties', { set: { 'zero_share.versus': [], 'zero_share.all': true } });
        if (!spec.measures.includes('occurrences')) add('Add occurrences', { add: { measures: ['occurrences'] } });
        if (!spec.measures.includes('impressions')) add('Add impressions', { add: { measures: ['impressions'] } });
        if (!spec.options.top_n && rowCount > 25) add('Top 25 only', { set: { 'options.top_n': 25 } });
        add(spec.options.final_only ? 'Include preliminary data' : 'Final data only', { set: { 'options.final_only': !spec.options.final_only } });
      }
      return {
        ok, spec, summary: spec.rows.length ? summarize(spec) : null,
        errors, warnings, questions, refinements, row_count: rowCount,
        delivery: rowCount != null && rowCount > INLINE_ROW_LIMIT ? 'file' : 'inline',
        next: errors.length ? 'Fix the errors (each lists one-step fixes), then validate again.' : questions.length ? 'Ask the user the question, offering its options as choices, then validate again with the chosen patch.' : 'Show the summary, then previewReport.',
      };
    }

    function preview(spec, limit) { return run(spec, { limit: limit || 15 }); }

    // ---- saved reports

    function saveReport(name, specIn, id) {
      const v = validate(specIn);
      if (!v.ok) throw new Error('This report is not ready to save: ' + (v.errors[0] ? v.errors[0].message : v.questions[0].prompt));
      const s = state();
      let rec = id ? s.saved.find((r) => r.id === id) : null;
      if (id && !rec) throw new Error('No saved report with id ' + id + '.');
      if (!rec) { s.seq += 1; rec = { id: 'rpt_' + s.seq, created_at: now(), last_run: null }; s.saved.push(rec); }
      rec.name = String(name || '').trim() || 'Untitled report';
      rec.spec = v.spec; rec.updated_at = now();
      store.save(s);
      return describeSaved(rec);
    }
    function describeSaved(rec) {
      const per = resolveTime(rec.spec.time, throughIdx(normalize(rec.spec)));
      return { id: rec.id, name: rec.name, summary: summarize(rec.spec), moves_with_new_data: !per.error && per.moves, created_at: rec.created_at, updated_at: rec.updated_at, last_run: rec.last_run };
    }
    function listSaved() { return state().saved.map(describeSaved); }
    function getSaved(id) { const rec = state().saved.find((r) => r.id === id); if (!rec) throw new Error('No saved report with id ' + id + '.'); return Object.assign(describeSaved(rec), { spec: clone(rec.spec) }); }
    function findSaved(text, list) {
      const q = norm(text); const all = list || state().saved;
      return all.find((r) => r.id === text) || all.find((r) => norm(r.name) === q) || all.find((r) => q && norm(r.name).includes(q)) || null;
    }
    function runSaved(id, opts) {
      const s = state();
      const rec = s.saved.find((r) => r.id === id) || findSaved(id, s.saved);
      if (!rec) throw new Error('No saved report matches "' + id + '". Use listSavedReports to see what exists.');
      const result = run(rec.spec, opts);
      const prev = rec.last_run;
      let since;
      if (!prev) since = { first_run: true, text: 'First run of this saved report.' };
      else {
        const periodChanged = prev.period_label !== result.period.label;
        const change = prev.total ? Math.round(((result.total - prev.total) / prev.total) * 1000) / 10 : null;
        const bits = [];
        if (periodChanged) bits.push('The period moved from ' + prev.period_label + ' to ' + result.period.label + '.');
        else if (prev.data_through !== result.data_through) bits.push('New data has loaded, but this report uses a fixed period, so the period did not move.');
        else bits.push('No new data has loaded since the last run.');
        if (change != null && result.total !== prev.total) bits.push('Total ' + result.total_measure.toLowerCase() + ' is ' + (change >= 0 ? 'up ' : 'down ') + Math.abs(change) + '% on the last run.');
        since = { first_run: false, period_changed: periodChanged, previous_period: prev.period_label, previous_total: prev.total, total_change_pct: change, rows_before: prev.row_count, rows_now: result.row_count, text: bits.join(' ') };
      }
      rec.last_run = { at: now(), period_label: result.period.label, data_through: result.data_through, total: result.total, row_count: result.row_count };
      store.save(s);
      return Object.assign({ saved_report: { id: rec.id, name: rec.name }, since_last_run: since }, result);
    }
    function deleteSaved(id) { const s = state(); const i = s.saved.findIndex((r) => r.id === id); if (i < 0) throw new Error('No saved report with id ' + id + '.'); const [rec] = s.saved.splice(i, 1); store.save(s); return { deleted: rec.id, name: rec.name }; }

    // Demo only: pretend a new month of data has loaded.
    function advanceData(n) { const s = state(); s.offset = Math.max(0, Math.min(MONTH_COUNT - 1 - PRELIM_LAG - BASE_FINAL, s.offset + (n == null ? 1 : n))); store.save(s); return availability(); }
    function resetData() { const s = state(); s.offset = 0; store.save(s); return availability(); }

    // ---- demo only: a keyword stand-in for the LLM's reading of a typed request.
    // The MCP server never calls this; a real client model does this job.
    const ALIASES = [['tv', 'media_type', 'Linear TV'], ['linear', 'media_type', 'Linear TV'], ['social', 'media_type', 'Paid Social'], ['display', 'media_type', 'Digital Display'], ['ooh', 'media_type', 'Out of Home'], ['outdoor', 'media_type', 'Out of Home'], ['streaming tv', 'media_type', 'CTV'], ['connected tv', 'media_type', 'CTV'], ['auto', 'industry', 'Automotive'], ['pharma', 'industry', 'Health & Pharma'], ['qsr', 'subcategory', 'Quick Service Restaurants'], ['insurance', 'category', 'Insurance'], ['evs', 'subcategory', 'Electric Vehicles'], ['ev', 'subcategory', 'Electric Vehicles'], ['trucks', 'subcategory', 'Pickup Trucks'], ['suvs', 'subcategory', 'SUVs & Crossovers'], ['fast food', 'subcategory', 'Quick Service Restaurants'], ['quick serve', 'subcategory', 'Quick Service Restaurants'], ['quick serve restaurants', 'subcategory', 'Quick Service Restaurants'], ['burgers', 'subcategory', 'Quick Service Restaurants'], ['soda', 'subcategory', 'Soft Drinks'], ['pop', 'subcategory', 'Soft Drinks'], ['car insurance', 'subcategory', 'Auto Insurance'], ['homeowners insurance', 'subcategory', 'Home Insurance'], ['credit card', 'subcategory', 'Credit Cards'], ['banks', 'subcategory', 'Consumer Banking'], ['banking', 'subcategory', 'Consumer Banking'], ['wireless carriers', 'subcategory', 'Wireless Plans'], ['carriers', 'subcategory', 'Wireless Plans'], ['cell phone', 'subcategory', 'Wireless Plans'], ['phones', 'subcategory', 'Smartphones'], ['cars', 'category', 'Vehicles'], ['autos', 'category', 'Vehicles'], ['trucks', 'subcategory', 'Pickup Trucks'], ['pet', 'category', 'Pet Care'], ['dog food', 'subcategory', 'Pet Food'], ['candy', 'subcategory', 'Confectionery'], ['chocolate', 'subcategory', 'Confectionery'], ['movies', 'subcategory', 'Movies'], ['films', 'subcategory', 'Movies'], ['theme parks', 'subcategory', 'Theme Parks'], ['drugs', 'category', 'Prescription Drugs'], ['prescription', 'category', 'Prescription Drugs'], ['weight loss', 'subcategory', 'Diabetes & Weight Rx'], ['glp 1', 'subcategory', 'Diabetes & Weight Rx'], ['broadband', 'subcategory', 'Internet & TV'], ['cable', 'subcategory', 'Internet & TV'], ['retailers', 'category', 'Retail'], ['ecommerce', 'subcategory', 'Online Retail'], ['e commerce', 'subcategory', 'Online Retail'], ['ai', 'subcategory', 'Search & AI'], ['laundry', 'subcategory', 'Laundry Care'], ['detergent', 'subcategory', 'Laundry Care'], ['shampoo', 'subcategory', 'Hair Care'], ['toothpaste', 'subcategory', 'Oral Care'], ['razors', 'subcategory', 'Shaving'], ['streaming services', 'subcategory', 'Video Streaming'], ['rx', 'category', 'Prescription Drugs'], ['cpg', 'industry', 'Consumer Packaged Goods'], ['nestle', 'top_parent', 'Nestlé SA'], ['p g', 'top_parent', 'Procter & Gamble Co'], ['gm', 'top_parent', 'General Motors Co'], ['j j', 'top_parent', 'Johnson & Johnson'], ['amex', 'advertiser', 'American Express'], ['lilly', 'top_parent', 'Eli Lilly & Co'], ['prime video', 'property', 'Amazon Prime Video'], ['peacock', 'property', 'Peacock TV'], ['disney', 'top_parent', 'Walt Disney Co'], ['warner bros discovery', 'top_parent', 'Warner Bros. Discovery']];
    // Parent companies by their short name: 'Comcast', 'AbbVie', 'Toyota', ...
    for (const v of VALUES.top_parent.values()) { const short = norm(v.label.replace(/\b(Inc|Co|Corp|PLC|SA|AG|Group|Mutual|Global|Financial Corp|Communications Inc|International|Motor Co|Motor Corp)\b\.?/g, '')); if (short && short !== norm(v.label)) ALIASES.push([short, 'top_parent', v.label, true]); }
    const NUM = { one: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12, eighteen: 18 };
    function interpret(text) {
      const raw = ' ' + norm(text) + ' ';
      const u = { entities: [], rows: [], measures: [] };
      const cands = [];
      for (const dim of Object.keys(VALUES)) for (const v of VALUES[dim].values()) { const l = ' ' + norm(v.label) + ' '; const i = raw.indexOf(l); if (i >= 0) cands.push({ i, len: l.length, id: v.id, type: dim, label: v.label }); }
      for (const [alias, dim, label, generated] of ALIASES) { const i = raw.indexOf(' ' + alias + ' '); if (i >= 0) { const v = Array.from(VALUES[dim].values()).find((x) => x.label === label); cands.push({ i, len: alias.length + 2, id: v.id, type: dim, label, alias: generated ? 'generated' : 'explicit' }); } }
      const rank = { advertiser: 0, top_parent: 1, product: 2, subcategory: 3, category: 4, industry: 5, property: 6, media_type: 7, media_owner: 8 };
      // Longest match wins; on a tie: hand-written shortcut, then exact advertiser name, then generated parent shortcut, then the rest.
      const pri = (c) => (c.alias === 'explicit' ? 0 : c.type === 'advertiser' && !c.alias ? 1 : c.alias ? 2 : 3);
      cands.sort((a, b) => b.len - a.len || pri(a) - pri(b) || rank[a.type] - rank[b.type]);
      const taken = [];
      for (const c of cands) { if (taken.some((t) => c.i < t.i + t.len - 1 && t.i < c.i + c.len - 1)) continue; taken.push(c); u.entities.push({ id: c.id, type: c.type, label: c.label }); }
      if (/ (zero share|not buying|missed|whitespace|aren t buying|arent buying|isn t buying|isnt buying|don t buy|dont buy|not advertising|not on) /.test(raw)) u.template = 'zero_share';
      else if (/ (extract|detail|detailed|granular|raw|export|spreadsheet|csv) /.test(raw)) u.template = 'detail_extract';
      else if (/ (add|with|include|show) (a |the )?(share|percent|percentage) /.test(raw)) u.share = true;
      else if (/ (share|share of voice|sov) /.test(raw)) u.template = 'category_share';
      else if (/ (media mix|mix|by media|channel|channels) /.test(raw)) u.template = 'media_mix';
      else if (/ (trend|trends|over time|monthly|by month|month by month) /.test(raw)) u.template = 'advertiser_trend';
      let m;
      if ((m = / last (\d+|one|two|three|four|six|twelve|eighteen) (?:complete |full )?(month|quarter|year)s? /.exec(raw))) u.time = { mode: 'rolling', unit: m[2], count: NUM[m[1]] || Number(m[1]) };
      else if (/ (ytd|year to date|this year) /.test(raw)) u.time = { mode: 'ytd' };
      else if (/ last (full )?quarter /.test(raw)) u.time = { mode: 'rolling', unit: 'quarter', count: 1 };
      else if (/ last (full )?year /.test(raw)) u.time = { mode: 'rolling', unit: 'year', count: 1 };
      else if (/ last month /.test(raw)) u.time = { mode: 'rolling', unit: 'month', count: 1 };
      else if ((m = / q([1-4]) (20\d\d) /.exec(raw))) { const q = Number(m[1]); u.time = { mode: 'static', start: m[2] + '-' + String(q * 3 - 2).padStart(2, '0'), end: m[2] + '-' + String(q * 3).padStart(2, '0') }; }
      else if ((m = / (20\d\d) /.exec(raw))) u.time = { mode: 'static', start: m[1] + '-01', end: m[1] + '-12' };
      const by = [['product', /by (product|brand)s? /], ['advertiser', /by advertisers? /], ['top_parent', /by (top )?parents? /], ['subcategory', /by subcategor/], ['category', /by categor/], ['industry', /by industr/], ['property', /by (property|properties|network|networks) /], ['media_owner', /by (media )?owners? /]];
      for (const [d, re] of by) if (re.test(raw)) u.rows.push(d);
      if (/by quarter/.test(raw)) u.columns = 'quarter'; else if (/by year/.test(raw)) u.columns = 'year';
      if (/ impressions /.test(raw)) u.measures.push('impressions');
      if (/ (occurrences|spots|airings|units) /.test(raw)) u.measures.push('occurrences');
      if ((m = / top (\d+) /.exec(raw))) u.top_n = Number(m[1]);
      if (/ (prior year|year over year|yoy|vs last year) /.test(raw)) u.yoy = true;
      if (/ preliminary /.test(raw)) u.preliminary = true;
      if (/ (add|also|plus|as well|along with|together with) /.test(raw) && u.entities.length) u.add = true;
      return u;
    }
    // Turn an understanding (from interpret(), or from a model) into a spec patch.
    function patchFromUnderstanding(spec, u) {
      const cur = normalize(spec);
      const p = { set: {}, add: {}, remove: {} };
      const tpl = u.template && TEMPLATES.find((t) => t.id === u.template);
      if (tpl && cur.template !== tpl.id) { Object.assign(p.set, clone(tpl.spec)); if (!tpl.spec.columns) p.set.columns = null; if (!tpl.spec.calcs) p.set.calcs = []; if (!tpl.spec.zero_share) p.set.zero_share = null; }
      const zero = tpl ? tpl.id === 'zero_share' : !!cur.zero_share;
      // Naming a new advertiser, category or property switches the report to it,
      // replacing what was there of the same kind (who / what / where), unless the
      // request says to add it ("add Nissan", "also include KFC").
      const named = new Set();
      for (const e of u.entities || []) {
        if (zero && e.type === 'property') { (p.add['zero_share.mine'] = p.add['zero_share.mine'] || []).push(e.id); continue; }
        if (!DIMS[e.type] || DIMS[e.type].time) continue;
        (p.add['filters.' + e.type] = p.add['filters.' + e.type] || []).push(e.id);
        named.add(DIMS[e.type].group);
      }
      if (!u.add) {
        for (const dim of Object.keys(cur.filters)) if (DIMS[dim] && named.has(DIMS[dim].group)) p.set['filters.' + dim] = null;
        if (zero && p.add['zero_share.mine'] && cur.zero_share && !tpl) p.set['zero_share.mine'] = [];
        if (named.size && cur.scope === 'all') p.set.scope = null;
      }
      if (tpl && tpl.spec.zero_share && p.add['zero_share.mine']) { p.set.zero_share = { mine: p.add['zero_share.mine'], versus: [] }; delete p.add['zero_share.mine']; }
      if (u.time) p.set.time = u.time;
      if (u.rows && u.rows.length) { const base = tpl ? tpl.spec.rows : cur.rows; if (base.length || tpl) p.add.rows = u.rows; else p.set.rows = u.rows; }
      if (u.columns !== undefined && u.columns !== null) { p.set.columns = u.columns; p.set.calcs = []; }
      if (u.measures && u.measures.length) p.add.measures = (cur.measures.length ? [] : ['spend']).concat(u.measures);
      if (u.top_n) p.set['options.top_n'] = u.top_n;
      if (u.preliminary) p.set['options.final_only'] = false;
      if (u.yoy || u.share) { p.add.calcs = [].concat(u.yoy ? ['yoy'] : [], u.share ? ['share'] : []); p.set.columns = null; }
      return p;
    }

    return { catalog, availability, search, validate, preview, run, csv, markdown, fmtCell, summarize, applyPatch, saveReport, listSaved, getSaved, findSaved, runSaved, deleteSaved, advanceData, resetData, interpret, patchFromUnderstanding, labelOf };
  }

  return { create, applyPatch, INLINE_ROW_LIMIT };
});
