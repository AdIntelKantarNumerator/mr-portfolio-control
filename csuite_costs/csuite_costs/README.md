# C-Suite Cost Flows

A Flask app that shows what it costs to monitor each medium for advertising, left to right through
five stages:

**Ingestion → Storage → Processing → Presentation → Customer view**

The model follows the ad-occurrence monitoring business:

1. Content from each medium is recorded or scanned continuously.
2. Every ad occurrence is detected, along with when it ran and for how long (or its on-sale or valid period).
3. The occurrence data is kept.
4. Occurrences from all media are combined to show how campaigns performed.

| Flow | Content monitored | Occurrence detected | Main cost drivers |
|---|---|---|---|
| TV | channel-hours (24/7 recording) | airing, with start time and duration | Feed access and capture per channel, raw recording storage, ad detection per hour, coding new creatives |
| Radio | station-hours (24/7 recording) | spot, with start time and duration | Receivers per station, ad detection per hour, coding new creatives |
| Magazines | scanned pages | ad page, with size and on-sale period | Issue purchases, page scanning, coding new creatives |
| Coupons & circulars | scanned pages by market | offer, with price, discount and valid dates | Circular collection, scanning, offer extraction, analyst QA |
| Cross-media campaigns | occurrences from all four media | occurrence linked to a campaign | Campaign matching, spend estimation, dashboards |

Each flow shows the volumes its inputs imply, such as channel-hours, airings detected, airtime and new
creatives to code. It also shows cost per monitored hour or page, cost per detected occurrence, and cost
per customer view. The default occurrence count in the cross-media flow is the sum of the four media flows.

## Storage page

`/storage` shows only storage costs, for every flow. Buttons choose long-term retention: 1 month, 6 months,
1 year, 2, 3, 5 or 10 years. The choice is applied to each flow's ad library, page scans and occurrence
records (the `data_retention` input), and every storage line item updates. Raw TV and radio recordings keep
their own short window (`raw_retention`) and are marked "Fixed window". A table compares every horizon
side by side. Costs are steady state: the monthly bill once that much history is held.
JSON: `GET /api/storage?months=60`.

## Where the numbers come from

Every line item carries a label:

- **AWS list price**: a published AWS rate (USD, us-east-1) taken from memory. It hasn't been checked
  against current pricing, and it ignores volume tiers, Savings Plans and negotiated discounts.
- **Estimate**: a placeholder with no source, such as capture cost per channel, scanning cost per page
  or analyst coding cost per creative. Replace these with real figures.
- **Your input**: a value you enter, such as data licence fees. These default to $0.

**All default volumes are placeholders, not MediaRadar figures.** Each flow shows what share of its cost
comes from estimates.

## Run it

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # http://localhost:5050
```

Port 5050 is used because macOS's AirPlay Receiver takes 5000.

## Tests

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

## JSON API

- `GET /api/flows`: every flow at its default inputs
- `GET /api/flows/<id>?channels=...&views=...`: one flow with overrides (400 if a value is out of range)

## Changing the model

Everything lives in [`flows.py`](flows.py).

- **Rates and defaults:** edit the `LineItem` (`rate`, `basis`) or `Param` (`default`, `minimum`, `maximum`).
- **Implied volumes:** each flow's `derive` function turns inputs into volumes. For example, TV
  airings = channel-hours × ad minutes per hour × 60 ÷ average spot length. Line items can use any
  input or derived volume through `q("key", factor, per)`.
- **New medium** (newspapers, digital, outdoor, ...): define a `Flow` with all five stage keys and add it
  to `MEDIA_FLOWS`. It appears in the navigation, on the home page and in the API, and its occurrences
  are added to the cross-media default automatically.
