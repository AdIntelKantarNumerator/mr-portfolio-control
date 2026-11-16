import html
import math
import re

import pytest

from app import create_app, fmt_count, fmt_input, fmt_money, fmt_rate
from flows import CAMPAIGNS, FLOWS, MEDIA_FLOWS, STAGE_KEYS, ParamError, compute, parse_overrides


@pytest.fixture
def client():
    return create_app().test_client()


def defaults(flow):
    return {p.key: p.default for p in flow.params}


@pytest.mark.parametrize("flow", FLOWS.values(), ids=lambda f: f.id)
def test_every_flow_has_all_stages_left_to_right(flow):
    assert tuple(flow.stages) == STAGE_KEYS
    result = compute(flow)
    assert [s["key"] for s in result["stages"]] == list(STAGE_KEYS)
    for stage in result["stages"]:
        assert stage["line_items"], f"{flow.id}/{stage['key']} has no line items"
        assert stage["total"] >= 0


@pytest.mark.parametrize("flow", FLOWS.values(), ids=lambda f: f.id)
def test_totals_add_up(flow):
    result = compute(flow)
    items_total = sum(i["cost"] for s in result["stages"] for i in s["line_items"])
    assert math.isclose(result["total_monthly"], items_total)
    assert math.isclose(sum(s["share"] for s in result["stages"]), 1.0)


@pytest.mark.parametrize("flow", FLOWS.values(), ids=lambda f: f.id)
def test_more_content_costs_more(flow):
    """The first parameter of every flow is its main volume driver."""
    driver = flow.params[0]
    base = compute(flow)
    doubled = compute(flow, {driver.key: driver.default * 2})
    assert doubled["total_monthly"] > base["total_monthly"]


def test_broadcast_occurrences_follow_ad_load():
    tv = FLOWS["tv"]
    volumes = tv.derive({**defaults(tv), "channels": 1, "hours_per_day": 24,
                         "ad_minutes_per_hour": 15, "avg_spot_sec": 30})
    hours = 24 * 30.4
    assert math.isclose(volumes["content"], hours)
    assert math.isclose(volumes["occurrences"], hours * 30)  # 15 ad minutes = 30 x :30 spots
    assert math.isclose(volumes["airtime_hours"], hours * 15 / 60)


def test_coupon_dedupe_reduces_processing():
    coupons = FLOWS["coupons"]
    no_dupes = compute(coupons, {"dup_pct": 0})
    mostly_dupes = compute(coupons, {"dup_pct": 90})
    process = lambda r: next(s for s in r["stages"] if s["key"] == "process")["total"]
    assert process(mostly_dupes) < process(no_dupes)


def test_campaign_default_combines_media_occurrences():
    media_total = sum(m.derive(defaults(m))["occurrences"] for m in MEDIA_FLOWS)
    assert math.isclose(defaults(CAMPAIGNS)["occurrences"], media_total, rel_tol=0.01)


def test_licence_input_flows_through():
    result = compute(FLOWS["tv"], {"licence": 25_000})
    assert result["total_monthly"] - compute(FLOWS["tv"])["total_monthly"] == pytest.approx(25_000)


@pytest.mark.parametrize("flow", FLOWS.values(), ids=lambda f: f.id)
def test_every_item_has_a_known_basis(flow):
    for stage in compute(flow)["stages"]:
        for item in stage["line_items"]:
            assert item["basis"] in {"aws", "estimate", "input"}


def test_zero_volume_has_no_per_unit_cost():
    result = compute(FLOWS["magazines"], {"titles": 0, "views": 0})
    assert result["cost_per_content"] is None
    assert result["cost_per_occurrence"] is None
    assert result["cost_per_view"] is None


@pytest.mark.parametrize("key, raw", [("channels", "abc"), ("channels", "-1"), ("channels", "nan"),
                                      ("avg_spot_sec", "0"), ("new_pct", "101"), ("hours_per_day", "25")])
def test_bad_overrides_rejected(key, raw):
    with pytest.raises(ParamError):
        parse_overrides(FLOWS["tv"], {key: raw})


def test_unknown_and_blank_overrides_ignored():
    assert parse_overrides(FLOWS["tv"], {"bogus": "1", "channels": ""}) == {}


@pytest.mark.parametrize("value, expected", [
    (None, "n/a"), (0, "$0"), (0.00123, "$0.0012"), (0.5, "$0.50"),
    (12.345, "$12.35"), (12_345, "$12,345"), (2_500_000, "$2.50M"),
])
def test_money_format(value, expected):
    assert fmt_money(value) == expected


@pytest.mark.parametrize("value, expected", [(640, "640"), (182_400, "182K"), (5_107_200, "5.1M")])
def test_count_format(value, expected):
    assert fmt_count(value) == expected


@pytest.mark.parametrize("value, expected", [(0.375, "$0.375"), (0.0125, "$0.0125"), (0.005, "$0.005"),
                                             (0.5, "$0.50"), (190, "$190.00")])
def test_rate_format(value, expected):
    assert fmt_rate(value) == expected


def test_input_format_drops_trailing_zero():
    assert fmt_input(35500000.0) == 35500000
    assert fmt_input(0.5) == 0.5


def test_index_shows_every_flow(client):
    response = client.get("/")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    for flow in FLOWS.values():
        assert html.escape(flow.name) in page


@pytest.mark.parametrize("flow_id", FLOWS)
def test_flow_pages(client, flow_id):
    assert client.get(f"/flow/{flow_id}").status_code == 200
    assert client.get(f"/flow/{flow_id}/lane?views=10").status_code == 200
    assert client.get(f"/api/flows/{flow_id}").status_code == 200


def test_api_applies_overrides(client):
    data = client.get("/api/flows/radio?channels=100").get_json()
    assert data["params"]["channels"] == 100


def test_unknown_flow_404(client):
    assert client.get("/flow/nope").status_code == 404
    assert client.get("/api/flows/nope").status_code == 404


def test_bad_param_400(client):
    response = client.get("/api/flows/tv?channels=-5")
    assert response.status_code == 400
    assert "at least 0" in response.get_json()["error"]


# --- Storage page -----------------------------------------------------------

from flows import RETENTION_OPTIONS, parse_retention, storage_by_flow  # noqa: E402


def test_storage_grows_with_retention():
    totals = [storage_by_flow(m)["total_monthly"] for m, _ in RETENTION_OPTIONS]
    assert totals == sorted(totals)
    assert totals[-1] > totals[0]


def test_storage_matches_flow_model():
    data = storage_by_flow(24)
    for f in data["flows"]:
        stage = next(s for s in compute(FLOWS[f["id"]], {"data_retention": 24})["stages"] if s["key"] == "store")
        assert math.isclose(f["total"], stage["total"])


def _tv_storage(months):
    return {i["name"]: i for i in next(f for f in storage_by_flow(months)["flows"] if f["id"] == "tv")["items"]}


def test_raw_recordings_are_fixed_window():
    short, long = _tv_storage(12), _tv_storage(120)
    raw = "Raw recordings (S3 Standard)"
    assert not short[raw]["long_term"]
    assert math.isclose(short[raw]["cost"], long[raw]["cost"])
    for name, item in short.items():
        if name != raw:
            assert item["long_term"]
            assert long[name]["cost"] > item["cost"]


@pytest.mark.parametrize("raw", ["7", "abc", "-1"])
def test_bad_retention_rejected(raw):
    with pytest.raises(ParamError):
        parse_retention(raw)


def test_storage_pages(client):
    assert client.get("/storage").status_code == 200
    page = client.get("/storage?months=120").get_data(as_text=True)
    pressed = re.findall(r'data-months="(\d+)"\s+aria-pressed="true"', page)
    assert pressed == ["120"]
    assert client.get("/storage/panel?months=6").status_code == 200
    assert client.get("/api/storage?months=12").get_json()["months"] == 12
    assert client.get("/storage?months=7").status_code == 400
