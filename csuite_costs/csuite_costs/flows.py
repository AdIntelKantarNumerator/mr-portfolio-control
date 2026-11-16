"""Cost model for ad-occurrence monitoring, one flow per medium.

The business: continuously ingest content from every medium (TV, radio, magazines,
coupons and circulars), detect each ad occurrence and how long it ran or was on
sale, keep that occurrence data, then combine it across media to report how
campaigns performed.

Every flow runs left to right through the same five stages:

    Ingestion -> Storage -> Processing -> Presentation -> Customer view

Each line item costs ``rate x quantity``. Quantities are worked out from the
flow's parameters (channels monitored, hours, pages, retention, views, ...).

Each line item records where its rate came from (``basis``):
  * "aws":      AWS list price (USD, us-east-1) from memory; not checked against
                current pricing, and ignores tiers, Savings Plans and discounts.
  * "estimate": a placeholder assumption with no source; replace with real figures.
  * "input":    entered directly as a parameter (e.g. contract fees).

All default volumes are placeholders, not MediaRadar figures.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Dict, List, Mapping, Optional, Tuple

Params = Mapping[str, float]

STAGES: Tuple[Tuple[str, str, str], ...] = (
    ("ingest", "Ingestion", "Capture content from the medium"),
    ("store", "Storage", "Keep recordings, ad library and occurrences"),
    ("process", "Processing", "Detect ads, measure duration, code creatives"),
    ("present", "Presentation", "Load, enrich and combine for reporting"),
    ("view", "Customer view", "Deliver campaign results to customers"),
)
STAGE_KEYS = tuple(key for key, _, _ in STAGES)

BASIS_LABELS = {
    "aws": "AWS list price",
    "estimate": "Estimate",
    "input": "Your input",
}

DAYS_PER_MONTH = 30.4
WEEKS_PER_MONTH = 4.33
MB_TO_GB = 1 / 1024
RECORD_GB = 1 / (1024 * 1024)  # one ~1 KB occurrence record, in GB


class ParamError(ValueError):
    """Raised when a parameter override is not a usable number."""


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    default: float
    unit: str = ""
    step: float = 1
    minimum: float = 0
    maximum: Optional[float] = None


@dataclass(frozen=True)
class LineItem:
    name: str
    rate: float  # USD per `unit`
    unit: str
    quantity: Callable[[Params], float]
    note: str = ""
    basis: str = "estimate"


@dataclass(frozen=True)
class Derived:
    key: str
    label: str
    unit: str = ""


@dataclass(frozen=True)
class Flow:
    id: str
    name: str
    tagline: str
    content_label: str  # one unit of monitored content, e.g. "channel-hour"
    occurrence_label: str  # one detected ad occurrence, e.g. "airing"
    params: Tuple[Param, ...]
    derive: Callable[[Params], Dict[str, float]]  # volumes implied by the params
    derived: Tuple[Derived, ...]  # which derived volumes to show
    stages: Dict[str, Tuple[LineItem, ...]]
    preview: Dict[str, object]  # what the end customer sees (sample data)
    summaries: Optional[Dict[str, str]] = None  # per-stage descriptions, if not the defaults


# --- Quantity helpers -------------------------------------------------------


def q(key: str, factor: float = 1.0, per: float = 1.0) -> Callable[[Params], float]:
    """`key` x `factor` / `per`, e.g. q("pages", per=1000) for thousands of pages."""
    return lambda p: p[key] * factor / per


def fixed(amount: float = 1.0) -> Callable[[Params], float]:
    return lambda p: amount


def records_gb(p: Params) -> float:
    """Steady-state GB of occurrence records kept for the data retention period."""
    return p["occurrences"] * RECORD_GB * p["data_retention"]


# --- Shared parameters and line items ---------------------------------------


def retention_params(raw_label: str, raw_default: float) -> Tuple[Param, Param]:
    return (
        Param("raw_retention", raw_label, raw_default, "months"),
        Param("data_retention", "Ad library & occurrence retention", 60, "months"),
    )


def licence_param(label: str = "Third-party data licences") -> Param:
    return Param("licence", label, 0, "USD / month", 1000)


def views_param(default: float, label: str = "Customer report views") -> Param:
    return Param("views", label, default, "per month", 10_000)


def uploads(objects: Callable[[Params], float], note: str) -> LineItem:
    return LineItem("Upload to cloud (S3 PUT)", 0.005, "1k requests", lambda p: objects(p) / 1000, note, "aws")


def occurrence_store() -> LineItem:
    return LineItem("Occurrence records (Redshift managed storage)", 0.024, "GB-month", records_gb,
                    "~1 KB per occurrence, kept for data retention", "aws")


def occurrence_load() -> LineItem:
    return LineItem("Load & dedupe occurrences (Glue)", 0.44, "DPU-hour", q("occurrences", 2, 1e6),
                    "~2 DPU-hours per million occurrences", "aws")


def licence_item(name: str = "Third-party data licences") -> LineItem:
    return LineItem(name, 1.0, "USD", q("licence"), "Enter contract value above", "input")


def coding_item(rate: float, what: str = "creative") -> LineItem:
    return LineItem(f"Code new {what}s: brand, product, category (LLM + analyst QA)", rate, what,
                    q("new_creatives"), "Analyst review time dominates this rate", "estimate")


def report_queries() -> LineItem:
    return LineItem("Report queries (Redshift Serverless)", 0.375, "RPU-hour", q("views", 0.002),
                    "~7 RPU-seconds per report view", "aws")


def app_serving(rate_per_k: float = 0.05) -> LineItem:
    return LineItem("Web app & API serving", rate_per_k, "1k views", q("views", per=1000), "", "estimate")


def egress(mb_per_view: Callable[[Params], float], note: str) -> LineItem:
    return LineItem("Clip & page delivery (CloudFront egress)", 0.085, "GB",
                    lambda p: p["views"] * mb_per_view(p) * MB_TO_GB, note, "aws")


# --- Broadcast flows (TV, radio) ---------------------------------------------


def broadcast_derive(p: Params) -> Dict[str, float]:
    hours = p["channels"] * p["hours_per_day"] * DAYS_PER_MONTH
    airings = hours * p["ad_minutes_per_hour"] * 60 / p["avg_spot_sec"]
    return {
        "content": hours,
        "occurrences": airings,
        "airtime_hours": airings * p["avg_spot_sec"] / 3600,
        "new_creatives": airings * p["new_pct"] / 100,
        "raw_gb": hours * p["gb_per_hour"],
        "clip_gb": p["gb_per_hour"] * p["avg_spot_sec"] / 3600,
    }


BROADCAST_DERIVED = (
    Derived("content", "Content monitored", "channel-hours / month"),
    Derived("occurrences", "Ad airings detected", "per month"),
    Derived("airtime_hours", "Ad airtime measured", "hours / month"),
    Derived("new_creatives", "New creatives to code", "per month"),
    Derived("raw_gb", "Raw recordings", "GB / month"),
)


def broadcast_params(channels: Param, gb_per_hour: float, ad_minutes: float, new_pct: float,
                     views: float) -> Tuple[Param, ...]:
    return (
        channels,
        Param("hours_per_day", "Hours recorded per day", 24, "hours", 1, 0, 24),
        Param("gb_per_hour", "Recording size", gb_per_hour, "GB / hour", 0.01),
        Param("ad_minutes_per_hour", "Ad minutes per hour", ad_minutes, "minutes", 1, 0, 60),
        Param("avg_spot_sec", "Avg spot length", 30, "seconds", 5, 1),
        Param("new_pct", "New creatives", new_pct, "% of airings", 0.05, 0, 100),
        *retention_params("Raw recording retention", 3),
        licence_param("Audience / ratings data licences"),
        views_param(views),
    )


TV = Flow(
    id="tv",
    name="TV",
    tagline="Broadcast, cable and local TV recorded 24/7; every commercial airing detected and timed",
    content_label="channel-hour",
    occurrence_label="airing",
    params=broadcast_params(Param("channels", "Channels monitored", 250, "channels", 10), 1.0, 14, 0.3, 400_000),
    derive=broadcast_derive,
    derived=BROADCAST_DERIVED,
    stages={
        "ingest": (
            LineItem("Signal & feed access (cable, satellite, OTA)", 20.0, "channel-month", q("channels")),
            LineItem("Capture & encoding (appliance or EC2)", 35.0, "channel-month", q("channels")),
            uploads(lambda p: p["content"] * 60, "1-minute segments"),
        ),
        "store": (
            LineItem("Raw recordings (S3 Standard)", 0.023, "GB-month",
                     lambda p: p["raw_gb"] * p["raw_retention"], "Kept for raw recording retention", "aws"),
            LineItem("Ad clip library (S3 Standard-IA)", 0.0125, "GB-month",
                     lambda p: p["new_creatives"] * p["clip_gb"] * p["data_retention"],
                     "One clip per new creative", "aws"),
            occurrence_store(),
        ),
        "process": (
            LineItem("Ad break & new-spot detection (ML)", 0.03, "channel-hour", q("content")),
            LineItem("Fingerprint matching against ad library", 0.02, "channel-hour", q("content"),
                     "Finds each airing and its start/end time"),
            LineItem("Speech-to-text for new creatives (Transcribe)", 0.024, "minute",
                     lambda p: p["new_creatives"] * p["avg_spot_sec"] / 60, "", "aws"),
            coding_item(1.50),
        ),
        "present": (
            occurrence_load(),
            LineItem("Clip transcoding for playback (MediaConvert)", 0.015, "output minute",
                     lambda p: p["new_creatives"] * p["avg_spot_sec"] / 60 * 3, "3 renditions per clip", "aws"),
            licence_item("Audience / ratings data licences"),
        ),
        "view": (
            egress(lambda p: p["clip_gb"] * 1024 * 0.5, "Half of report views play a clip"),
            report_queries(),
            app_serving(),
        ),
    },
    preview={
        "kind": "video",
        "title": "Harbor Bank: \"Home Starts Here\" :30",
        "fields": [("Airings", "3,412"), ("Airtime", "28h 26m"), ("Channels", "184"),
                   ("Flight", "Sep 18 to Nov 2")],
    },
)

RADIO = Flow(
    id="radio",
    name="Radio",
    tagline="AM/FM and streaming stations recorded 24/7; every spot detected and timed",
    content_label="station-hour",
    occurrence_label="spot",
    params=broadcast_params(Param("channels", "Stations monitored", 1_500, "stations", 50), 0.03, 12, 0.1, 250_000),
    derive=broadcast_derive,
    derived=tuple(Derived(d.key, d.label.replace("airings", "spots"), d.unit.replace("channel", "station"))
                  for d in BROADCAST_DERIVED),
    stages={
        "ingest": (
            LineItem("Stream & OTA receivers", 8.0, "station-month", q("channels")),
            uploads(lambda p: p["content"] * 60, "1-minute segments"),
        ),
        "store": (
            LineItem("Raw recordings (S3 Standard)", 0.023, "GB-month",
                     lambda p: p["raw_gb"] * p["raw_retention"], "Kept for raw recording retention", "aws"),
            LineItem("Spot audio library (S3 Standard-IA)", 0.0125, "GB-month",
                     lambda p: p["new_creatives"] * p["clip_gb"] * p["data_retention"],
                     "One clip per new creative", "aws"),
            occurrence_store(),
        ),
        "process": (
            LineItem("Ad break & new-spot detection (ML)", 0.01, "station-hour", q("content")),
            LineItem("Acoustic fingerprint matching", 0.004, "station-hour", q("content"),
                     "Finds each spot and its start/end time"),
            LineItem("Speech-to-text for new creatives (Transcribe)", 0.024, "minute",
                     lambda p: p["new_creatives"] * p["avg_spot_sec"] / 60, "", "aws"),
            coding_item(1.00),
        ),
        "present": (
            occurrence_load(),
            licence_item("Audience / ratings data licences"),
        ),
        "view": (
            egress(lambda p: p["clip_gb"] * 1024 * 0.5, "Half of report views play a clip"),
            report_queries(),
            app_serving(),
        ),
    },
    preview={
        "kind": "audio",
        "title": "Summit Mattress: Weekend Event :60",
        "fields": [("Spots", "8,960"), ("Airtime", "149h 20m"), ("Stations", "412"),
                   ("Dayparts", "AM drive, Midday")],
    },
)


# --- Print flows (magazines, coupons & circulars) ---------------------------


def magazine_derive(p: Params) -> Dict[str, float]:
    pages = p["titles"] * p["issues_per_month"] * p["pages_per_issue"]
    ad_pages = pages * p["ad_pct"] / 100
    return {
        "issues": p["titles"] * p["issues_per_month"],
        "content": pages,
        "occurrences": ad_pages,
        "new_creatives": ad_pages * p["new_pct"] / 100,
        "scan_gb": pages * p["scan_mb"] * MB_TO_GB,
    }


MAGAZINES = Flow(
    id="magazines",
    name="Magazines",
    tagline="Every issue scanned page by page; each ad found, sized and tracked for its on-sale period",
    content_label="page",
    occurrence_label="ad page",
    params=(
        Param("titles", "Titles monitored", 800, "titles", 10),
        Param("issues_per_month", "Issues per title", 1.2, "per month", 0.1),
        Param("pages_per_issue", "Pages per issue", 120, "pages", 4),
        Param("scan_mb", "Scan size", 6, "MB / page", 0.5),
        Param("ad_pct", "Pages carrying ads", 35, "%", 1, 0, 100),
        Param("new_pct", "New creatives", 40, "% of ads", 1, 0, 100),
        Param("data_retention", "Scan, ad & occurrence retention", 60, "months"),
        licence_param("Circulation & readership data licences"),
        views_param(150_000),
    ),
    derive=magazine_derive,
    derived=(
        Derived("issues", "Issues processed", "per month"),
        Derived("content", "Pages scanned", "per month"),
        Derived("occurrences", "Ad pages detected", "per month"),
        Derived("new_creatives", "New creatives to code", "per month"),
    ),
    stages={
        "ingest": (
            LineItem("Issue purchases & subscriptions", 6.0, "issue", q("issues")),
            LineItem("Page scanning (scanner + operator)", 0.10, "page", q("content"),
                     "Lower where digital editions are available"),
            uploads(q("content"), "One object per page"),
        ),
        "store": (
            LineItem("Page scans (S3 Standard-IA)", 0.0125, "GB-month",
                     lambda p: p["scan_gb"] * p["data_retention"], "Kept as proof of occurrence", "aws"),
            occurrence_store(),
        ),
        "process": (
            LineItem("Ad detection & sizing on page (vision model)", 1.00, "1k pages", q("content", per=1000)),
            LineItem("Text extraction (Textract)", 1.50, "1k pages", q("content", per=1000), "", "aws"),
            coding_item(1.50),
        ),
        "present": (
            occurrence_load(),
            LineItem("Zoom tiles for page viewer (Lambda)", 0.10, "1k pages", q("content", per=1000)),
            licence_item("Circulation & readership data licences"),
        ),
        "view": (
            egress(lambda p: 0.8, "~0.8 MB of page imagery per view"),
            report_queries(),
            app_serving(),
        ),
    },
    preview={
        "kind": "print",
        "title": "Lumen Skincare: Holiday Glow",
        "fields": [("Ad pages", "64"), ("Titles", "22"), ("Sizes", "Full, half page"),
                   ("On sale", "Nov 1 to Dec 15")],
    },
)


def coupon_derive(p: Params) -> Dict[str, float]:
    circulars = p["markets"] * p["circulars_per_week"] * WEEKS_PER_MONTH
    pages = circulars * p["pages_per_circular"]
    unique_pages = pages * (1 - p["dup_pct"] / 100)
    offers = pages * p["offers_per_page"]
    unique_offers = unique_pages * p["offers_per_page"]
    return {
        "circulars": circulars,
        "content": pages,
        "unique_pages": unique_pages,
        "occurrences": offers,
        "unique_offers": unique_offers,
        "new_creatives": unique_offers * p["new_pct"] / 100,
        "scan_gb": pages * p["scan_mb"] * MB_TO_GB,
    }


COUPONS = Flow(
    id="coupons",
    name="Coupons & circulars",
    tagline="FSIs and retailer circulars by market; every offer extracted with its price, discount and valid dates",
    content_label="page",
    occurrence_label="offer",
    params=(
        Param("markets", "Markets monitored", 210, "markets", 10),
        Param("circulars_per_week", "Circulars per market", 25, "per week", 1),
        Param("pages_per_circular", "Pages per circular", 12, "pages", 1),
        Param("scan_mb", "Scan size", 5, "MB / page", 0.5),
        Param("dup_pct", "Duplicate versions across markets", 70, "% of pages", 5, 0, 100),
        Param("offers_per_page", "Offers per page", 15, "offers", 1),
        Param("new_pct", "Offers needing full coding", 60, "% of unique offers", 5, 0, 100),
        Param("data_retention", "Scan & offer retention", 36, "months"),
        licence_param("Distribution & household reach data"),
        views_param(200_000),
    ),
    derive=coupon_derive,
    derived=(
        Derived("circulars", "Circulars collected", "per month"),
        Derived("content", "Pages scanned", "per month"),
        Derived("unique_pages", "Unique pages after dedupe", "per month"),
        Derived("occurrences", "Offer occurrences", "per month"),
        Derived("new_creatives", "Offers to code", "per month"),
    ),
    stages={
        "ingest": (
            LineItem("Circular collection (print pickup + digital)", 0.50, "circular", q("circulars")),
            LineItem("Page scanning", 0.03, "page", q("content"), "Batch-fed, mostly automated"),
            uploads(q("content"), "One object per page"),
        ),
        "store": (
            LineItem("Page scans (S3 Standard-IA)", 0.0125, "GB-month",
                     lambda p: p["scan_gb"] * p["data_retention"], "Kept as proof of occurrence", "aws"),
            occurrence_store(),
        ),
        "process": (
            LineItem("Duplicate version detection (perceptual hash)", 0.02, "1k pages", q("content", per=1000),
                     "Only unique pages go further"),
            LineItem("Offer region detection (vision model)", 1.00, "1k pages", q("unique_pages", per=1000)),
            LineItem("Text extraction (Textract)", 1.50, "1k pages", q("unique_pages", per=1000), "", "aws"),
            LineItem("Offer extraction: product, price, discount, valid dates (LLM)", 2.00, "1k offers",
                     q("unique_offers", per=1000)),
            LineItem("Analyst QA (5% sample)", 0.60, "offer", q("new_creatives", 0.05)),
        ),
        "present": (
            occurrence_load(),
            licence_item("Distribution & household reach data"),
        ),
        "view": (
            egress(lambda p: 0.6, "~0.6 MB of page imagery per view"),
            report_queries(),
            app_serving(),
        ),
    },
    preview={
        "kind": "coupon",
        "title": "Brightside Grocery: Weekly circular",
        "fields": [("Offers", "1,240"), ("Avg discount", "22%"), ("Markets", "87"),
                   ("Valid", "Nov 9 to Nov 15")],
    },
)

MEDIA_FLOWS = (TV, RADIO, MAGAZINES, COUPONS)


def _default_occurrences(flow: Flow) -> float:
    return flow.derive({p.key: p.default for p in flow.params})["occurrences"]


# --- Cross-media campaign flow ----------------------------------------------


def campaign_derive(p: Params) -> Dict[str, float]:
    return {"content": p["occurrences"]}


CAMPAIGNS = Flow(
    id="campaigns",
    name="Cross-media campaigns",
    tagline="Occurrences from every medium combined to show how each campaign performed",
    content_label="occurrence",
    occurrence_label="occurrence",
    params=(
        Param("occurrences", "Occurrences received from all media",
              int(round(sum(map(_default_occurrences, MEDIA_FLOWS)), -5)),
              "per month", 1_000_000),
        Param("new_campaigns", "New campaigns identified", 3_000, "per month", 100),
        Param("data_retention", "Combined data retention", 60, "months"),
        licence_param("Rate cards & spend reference data"),
        views_param(600_000, "Customer dashboard views"),
        Param("exports", "Scheduled report exports", 30_000, "per month", 1_000),
    ),
    derive=campaign_derive,
    derived=(
        Derived("occurrences", "Occurrences combined", "per month"),
        Derived("new_campaigns", "New campaigns to set up", "per month"),
    ),
    stages={
        "ingest": (
            LineItem("Occurrence feeds from each media pipeline (Glue)", 0.44, "DPU-hour",
                     q("occurrences", 0.5, 1e6), "~0.5 DPU-hours per million occurrences", "aws"),
            licence_item("Rate cards & spend reference data"),
        ),
        "store": (
            LineItem("Unified occurrence warehouse (Redshift managed storage)", 0.024, "GB-month", records_gb,
                     "", "aws"),
            LineItem("Data lake copy (S3 Standard, Parquet)", 0.023, "GB-month",
                     lambda p: records_gb(p) * 0.3, "~3x compression", "aws"),
        ),
        "process": (
            LineItem("Match occurrences to campaigns, brands & parents (Glue)", 0.44, "DPU-hour",
                     q("occurrences", 1.5, 1e6), "~1.5 DPU-hours per million occurrences", "aws"),
            LineItem("Spend estimation models (SageMaker batch, ml.m5.xlarge)", 0.23, "instance-hour", fixed(120),
                     "4 hours a day", "aws"),
            LineItem("Set up new campaigns (LLM + analyst review)", 2.00, "campaign", q("new_campaigns")),
        ),
        "present": (
            LineItem("Campaign performance cubes (Redshift Serverless)", 0.375, "RPU-hour", fixed(8 * 4 * 30),
                     "8 RPUs, 4 hours a day", "aws"),
            LineItem("Metadata database (Aurora)", 190.0, "month", fixed(), "Fixed instance", "aws"),
        ),
        "view": (
            LineItem("Dashboard queries (Redshift Serverless)", 0.375, "RPU-hour", q("views", 0.002),
                     "~7 RPU-seconds per view", "aws"),
            LineItem("Scheduled report exports (Lambda + SES)", 0.20, "1k exports", q("exports", per=1000)),
            app_serving(),
        ),
    },
    preview={
        "kind": "campaign",
        "title": "Northwind Athletics: Fall Sale",
        "fields": [("TV airings", "3,412"), ("Radio spots", "8,960"), ("Print ad pages", "64"),
                   ("Coupon offers", "1,240"), ("Est. spend", "$4.8M")],
    },
    summaries={
        "ingest": "Receive occurrences from every medium",
        "store": "Keep the unified occurrence history",
        "process": "Link occurrences to campaigns, estimate spend",
        "present": "Build campaign performance views",
        "view": "Dashboards and reports for customers",
    },
)

FLOWS: Dict[str, Flow] = {flow.id: flow for flow in (*MEDIA_FLOWS, CAMPAIGNS)}


# --- Calculation ------------------------------------------------------------


def parse_overrides(flow: Flow, args: Mapping[str, str]) -> Dict[str, float]:
    """Read parameter overrides for `flow` from query args. Unknown keys are ignored."""
    overrides = {}
    for param in flow.params:
        raw = args.get(param.key)
        if raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except ValueError:
            raise ParamError(f"{param.label} must be a number, got {raw!r}") from None
        if not math.isfinite(value) or value < param.minimum:
            raise ParamError(f"{param.label} must be at least {param.minimum:g}, got {raw!r}")
        if param.maximum is not None and value > param.maximum:
            raise ParamError(f"{param.label} must be at most {param.maximum:g}, got {raw!r}")
        overrides[param.key] = value
    return overrides


def _ratio(numerator: float, denominator: float) -> Optional[float]:
    return numerator / denominator if denominator else None


def compute(flow: Flow, overrides: Optional[Mapping[str, float]] = None) -> dict:
    """Cost every line item and stage of `flow`. All money is USD per month."""
    params = {param.key: param.default for param in flow.params}
    params.update(overrides or {})
    volumes = {**params, **flow.derive(params)}

    stages: List[dict] = []
    for key, title, summary in STAGES:
        summary = (flow.summaries or {}).get(key, summary)
        items = []
        for item in flow.stages[key]:
            quantity = item.quantity(volumes)
            items.append({
                "name": item.name,
                "quantity": quantity,
                "unit": item.unit,
                "rate": item.rate,
                "cost": quantity * item.rate,
                "note": item.note,
                "basis": item.basis,
                "basis_label": BASIS_LABELS[item.basis],
            })
        stages.append({
            "key": key,
            "title": title,
            "summary": summary,
            "line_items": items,
            "total": sum(i["cost"] for i in items),
        })

    total = sum(s["total"] for s in stages)
    for stage in stages:
        stage["share"] = _ratio(stage["total"], total) or 0.0

    estimate_cost = sum(i["cost"] for s in stages for i in s["line_items"] if i["basis"] == "estimate")

    return {
        "flow": flow.id,
        "name": flow.name,
        "content_label": flow.content_label,
        "occurrence_label": flow.occurrence_label,
        "params": params,
        "volumes": [{"key": d.key, "label": d.label, "unit": d.unit, "value": volumes[d.key]}
                    for d in flow.derived],
        "stages": stages,
        "total_monthly": total,
        "total_annual": total * 12,
        "cost_per_content": _ratio(total, volumes["content"]),
        "cost_per_occurrence": _ratio(total, volumes["occurrences"]),
        "cost_per_view": _ratio(total, params["views"]),
        "estimate_share": _ratio(estimate_cost, total) or 0.0,
        "largest_stage": max(stages, key=lambda s: s["total"])["title"],
    }


# --- Long-term storage horizons ---------------------------------------------

RETENTION_OPTIONS: Tuple[Tuple[int, str], ...] = (
    (1, "1 month"),
    (6, "6 months"),
    (12, "1 year"),
    (24, "2 years"),
    (36, "3 years"),
    (60, "5 years"),
    (120, "10 years"),
)
RETENTION_LABELS = dict(RETENTION_OPTIONS)
DEFAULT_RETENTION = 60


def parse_retention(raw: Optional[str]) -> int:
    """Read a long-term retention choice (months); must be one of RETENTION_OPTIONS."""
    if raw is None or raw == "":
        return DEFAULT_RETENTION
    try:
        months = int(raw)
    except ValueError:
        months = -1
    if months not in RETENTION_LABELS:
        allowed = ", ".join(str(m) for m, _ in RETENTION_OPTIONS)
        raise ParamError(f"Retention must be one of {allowed} months, got {raw!r}")
    return months


def _storage_items(flow: Flow, months: int) -> List[dict]:
    stages = compute(flow, {"data_retention": months})["stages"]
    return next(s for s in stages if s["key"] == "store")["line_items"]


def storage_by_flow(months: int) -> dict:
    """Storage stage of every flow with long-term retention set to `months`.

    Items whose cost depends on long-term retention are flagged `long_term`;
    the rest (e.g. raw TV/radio recordings on their own short window) stay fixed.
    Costs are steady state: the monthly bill once `months` of history is held.
    """
    flows = []
    for flow in FLOWS.values():
        items = _storage_items(flow, months)
        longer = _storage_items(flow, months + 1)
        for item, other in zip(items, longer):
            item["long_term"] = not math.isclose(item["cost"], other["cost"])
        flows.append({
            "id": flow.id,
            "name": flow.name,
            "items": items,
            "total": sum(i["cost"] for i in items),
            "long_term_total": sum(i["cost"] for i in items if i["long_term"]),
        })
    total = sum(f["total"] for f in flows)
    for f in flows:
        f["share"] = _ratio(f["total"], total) or 0.0

    matrix = [
        {"months": m, "label": label,
         "totals": {flow.id: sum(i["cost"] for i in _storage_items(flow, m)) for flow in FLOWS.values()}}
        for m, label in RETENTION_OPTIONS
    ]
    for row in matrix:
        row["total"] = sum(row["totals"].values())

    return {
        "months": months,
        "label": RETENTION_LABELS[months],
        "flows": flows,
        "total_monthly": total,
        "total_annual": total * 12,
        "multiple_of_shortest": _ratio(total, matrix[0]["total"]),
        "matrix": matrix,
    }
