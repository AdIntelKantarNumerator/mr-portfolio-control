"""C-Suite Cost Flows: a Flask app that shows what it costs to monitor each medium
for ads, left to right from ingestion to the campaign results customers see."""

from __future__ import annotations

import math
from typing import Optional

from flask import Flask, abort, jsonify, render_template, request

from flows import (FLOWS, RETENTION_OPTIONS, STAGES, Flow, ParamError, compute, parse_overrides,
                   parse_retention, storage_by_flow)


def fmt_money(value: Optional[float]) -> str:
    if value is None:
        return "n/a"
    magnitude = abs(value)
    if magnitude >= 1_000_000:
        return f"${value / 1_000_000:,.2f}M"
    if magnitude >= 1_000:
        return f"${value:,.0f}"
    if magnitude >= 1:
        return f"${value:,.2f}"
    if magnitude == 0:
        return "$0"
    # Small values such as per-view costs: at least two significant figures.
    decimals = max(2, -math.floor(math.log10(magnitude)) + 1)
    return f"${value:.{decimals}f}"


def fmt_qty(value: float) -> str:
    if value >= 100 or value == int(value):
        return f"{value:,.0f}"
    return f"{value:,.2f}"


def fmt_rate(value: float) -> str:
    """Unit rates keep their precision: $0.375, $0.0125, $1.50, $190.00."""
    if value >= 1:
        return f"${value:,.2f}"
    text = f"{value:.5f}".rstrip("0")
    decimals = max(2, len(text.split(".")[1]))
    return f"${value:.{decimals}f}"


def fmt_input(value: float):
    """Show whole numbers without a trailing .0 in form inputs."""
    return int(value) if float(value).is_integer() else value


def fmt_count(value: float) -> str:
    """Compact volume: 5.1M, 182K, 640."""
    if value >= 1e9:
        return f"{value / 1e9:,.1f}B"
    if value >= 1e6:
        return f"{value / 1e6:,.1f}M"
    if value >= 1e4:
        return f"{value / 1e3:,.0f}K"
    return f"{value:,.0f}"


def _flow_or_404(flow_id: str) -> Flow:
    flow = FLOWS.get(flow_id)
    if flow is None:
        abort(404, description=f"Unknown flow {flow_id!r}")
    return flow


def create_app() -> Flask:
    app = Flask(__name__)
    app.add_template_filter(fmt_money, "money")
    app.add_template_filter(fmt_qty, "qty")
    app.add_template_filter(fmt_count, "count")
    app.add_template_filter(fmt_rate, "rate")
    app.add_template_filter(fmt_input, "input")

    @app.context_processor
    def globals_():
        return {"stages": STAGES, "all_flows": FLOWS.values()}

    @app.get("/")
    def index():
        results = [(flow, compute(flow)) for flow in FLOWS.values()]
        portfolio_total = sum(r["total_monthly"] for _, r in results)
        stage_totals = [
            (title, sum(r["stages"][i]["total"] for _, r in results))
            for i, (_, title, _) in enumerate(STAGES)
        ]
        return render_template(
            "index.html",
            results=results,
            portfolio_total=portfolio_total,
            stage_totals=stage_totals,
            biggest=max(results, key=lambda fr: fr[1]["total_monthly"]),
        )

    @app.get("/flow/<flow_id>")
    def flow_detail(flow_id: str):
        flow = _flow_or_404(flow_id)
        result = compute(flow, parse_overrides(flow, request.args))
        return render_template("flow.html", flow=flow, r=result)

    @app.get("/flow/<flow_id>/lane")
    def flow_lane(flow_id: str):
        """HTML fragment the detail page swaps in when parameters change."""
        flow = _flow_or_404(flow_id)
        result = compute(flow, parse_overrides(flow, request.args))
        return render_template("_lane.html", flow=flow, r=result, detailed=True)

    @app.get("/storage")
    def storage():
        data = storage_by_flow(parse_retention(request.args.get("months")))
        return render_template("storage.html", s=data, options=RETENTION_OPTIONS, page="storage")

    @app.get("/storage/panel")
    def storage_panel():
        """HTML fragment the storage page swaps in when a horizon is chosen."""
        data = storage_by_flow(parse_retention(request.args.get("months")))
        return render_template("_storage.html", s=data)

    @app.get("/api/storage")
    def api_storage():
        return jsonify(storage_by_flow(parse_retention(request.args.get("months"))))

    @app.get("/api/flows")
    def api_flows():
        return jsonify([compute(flow) for flow in FLOWS.values()])

    @app.get("/api/flows/<flow_id>")
    def api_flow(flow_id: str):
        flow = _flow_or_404(flow_id)
        return jsonify(compute(flow, parse_overrides(flow, request.args)))

    @app.errorhandler(ParamError)
    def bad_param(err: ParamError):
        return jsonify(error=str(err)), 400

    return app


app = create_app()

if __name__ == "__main__":
    # Port 5000 is taken by AirPlay Receiver on macOS.
    app.run(debug=True, port=5050)
