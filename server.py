"""LLM Benchmark Dashboard — FastAPI backend proxying Ollama."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import psutil
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
HISTORY_LIMIT = 50

app = FastAPI(title="LLM Benchmark Dashboard", version="1.0.0")
benchmark_history: list[dict[str, Any]] = []

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class BenchmarkRequest(BaseModel):
    model: str
    prompt: str = "Write a short paragraph about local LLM inference."
    num_predict: int = Field(default=128, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    warmup: bool = True


def _ns_to_seconds(ns: int | None) -> float | None:
    if ns is None:
        return None
    return round(ns / 1_000_000_000, 4)


def _tokens_per_second(count: int | None, duration_ns: int | None) -> float | None:
    if not count or not duration_ns:
        return None
    return round(count / (duration_ns / 1_000_000_000), 2)


def _format_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


async def _ollama_get(path: str) -> Any:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{OLLAMA_BASE_URL}{path}")
        resp.raise_for_status()
        return resp.json()


async def _ollama_post(path: str, payload: dict[str, Any], timeout: float = 600.0) -> Any:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{OLLAMA_BASE_URL}{path}", json=payload)
        resp.raise_for_status()
        return resp.json()


def _system_snapshot() -> dict[str, Any]:
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    return {
        "memory_total_gb": round(mem.total / (1024**3), 1),
        "memory_used_gb": round(mem.used / (1024**3), 1),
        "memory_available_gb": round(mem.available / (1024**3), 1),
        "memory_percent": mem.percent,
        "swap_used_gb": round(swap.used / (1024**3), 2),
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "cpu_count": psutil.cpu_count(),
    }


def _find_model_details(models: list[dict], name: str) -> dict[str, Any] | None:
    for m in models:
        if m.get("name") == name or m.get("model") == name:
            return m
    return None


def _build_metrics(result: dict[str, Any], model_info: dict | None, system: dict) -> dict[str, Any]:
    load_s = _ns_to_seconds(result.get("load_duration"))
    total_s = _ns_to_seconds(result.get("total_duration"))
    prompt_eval_s = _ns_to_seconds(result.get("prompt_eval_duration"))
    eval_s = _ns_to_seconds(result.get("eval_duration"))

    prompt_count = result.get("prompt_eval_count")
    eval_count = result.get("eval_count")
    prompt_tps = _tokens_per_second(prompt_count, result.get("prompt_eval_duration"))
    eval_tps = _tokens_per_second(eval_count, result.get("eval_duration"))

    details = (model_info or {}).get("details", {})
    size_bytes = (model_info or {}).get("size")

    return {
        "model": result.get("model"),
        "prompt": None,  # filled by caller
        "response": result.get("response", ""),
        "done_reason": result.get("done_reason"),
        "timestamps": {
            "created_at": result.get("created_at"),
            "benchmark_at": datetime.now(timezone.utc).isoformat(),
        },
        "timing": {
            "load_duration_s": load_s,
            "prompt_eval_duration_s": prompt_eval_s,
            "eval_duration_s": eval_s,
            "total_duration_s": total_s,
            "time_to_first_token_s": (
                round(load_s + prompt_eval_s, 4)
                if load_s is not None and prompt_eval_s is not None
                else None
            ),
        },
        "tokens": {
            "prompt_eval_count": prompt_count,
            "eval_count": eval_count,
            "total_tokens": (prompt_count or 0) + (eval_count or 0),
        },
        "throughput": {
            "prompt_tokens_per_sec": prompt_tps,
            "eval_tokens_per_sec": eval_tps,
            "overall_tokens_per_sec": _tokens_per_second(
                (prompt_count or 0) + (eval_count or 0),
                result.get("total_duration"),
            ),
        },
        "model_info": {
            "name": (model_info or {}).get("name"),
            "size_bytes": size_bytes,
            "size_human": _format_bytes(size_bytes) if size_bytes else None,
            "parameter_size": details.get("parameter_size"),
            "quantization_level": details.get("quantization_level"),
            "family": details.get("family"),
            "format": details.get("format"),
            "context_length": details.get("context_length"),
            "embedding_length": details.get("embedding_length"),
            "digest": (model_info or {}).get("digest"),
        },
        "system": system,
        "raw": result,
    }


@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/health")
async def health():
    try:
        version = await _ollama_get("/api/version")
        return {"status": "ok", "ollama": version, "ollama_url": OLLAMA_BASE_URL}
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Ollama unreachable: {exc}") from exc


@app.get("/api/models")
async def list_models():
    try:
        data = await _ollama_get("/api/tags")
        models = data.get("models", [])
        models.sort(key=lambda m: m.get("name", ""))
        return {"models": models}
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/running")
async def running_models():
    try:
        return await _ollama_get("/api/ps")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/system")
async def system_stats():
    snapshot = _system_snapshot()
    try:
        version = await _ollama_get("/api/version")
        snapshot["ollama_version"] = version.get("version")
    except httpx.HTTPError:
        snapshot["ollama_version"] = None
    return snapshot


def _percentile_rating(value: float | None, values: list[float], higher_is_better: bool = True) -> str:
    """Classify a value as best / expected / poor relative to observed samples."""
    clean = [v for v in values if v is not None]
    if value is None or len(clean) < 2:
        return "expected"
    sorted_vals = sorted(clean, reverse=higher_is_better)
    if value >= sorted_vals[0] if higher_is_better else value <= sorted_vals[0]:
        if value == sorted_vals[0]:
            return "best"
    if value <= sorted_vals[-1] if higher_is_better else value >= sorted_vals[-1]:
        if value == sorted_vals[-1]:
            return "poor"
    n = len(sorted_vals)
    rank = sum(1 for v in sorted_vals if (v > value if higher_is_better else v < value))
    pct = rank / (n - 1) if n > 1 else 0.5
    if (higher_is_better and pct <= 0.25) or (not higher_is_better and pct >= 0.75):
        return "best"
    if (higher_is_better and pct >= 0.75) or (not higher_is_better and pct <= 0.25):
        return "poor"
    return "expected"


def _range_stats(values: list[float | int | None]) -> dict[str, Any] | None:
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return {
        "min": min(clean),
        "max": max(clean),
        "avg": round(sum(clean) / len(clean), 2),
    }


def _analyze_model_insights(entries: list[dict[str, Any]]) -> dict[str, Any]:
    if not entries:
        return {
            "runs": 0,
            "ranges": {},
            "parameters": [],
            "metrics": [],
            "best_run": None,
            "summary": "No benchmark data yet for this model.",
        }

    eval_tps = [e.get("throughput", {}).get("eval_tokens_per_sec") for e in entries]
    prompt_tps = [e.get("throughput", {}).get("prompt_tokens_per_sec") for e in entries]
    ttft = [e.get("timing", {}).get("time_to_first_token_s") for e in entries]
    load_s = [e.get("timing", {}).get("load_duration_s") for e in entries]
    eval_counts = [e.get("tokens", {}).get("eval_count") for e in entries]
    num_predicts = [e.get("options", {}).get("num_predict") for e in entries]
    temperatures = [e.get("options", {}).get("temperature") for e in entries]

    ranges: dict[str, Any] = {}
    for key, vals in [
        ("tokens_generated", eval_counts),
        ("max_tokens_requested", num_predicts),
        ("temperature", temperatures),
        ("generation_tok_per_sec", eval_tps),
        ("prompt_tok_per_sec", prompt_tps),
        ("time_to_first_token_s", ttft),
        ("load_duration_s", load_s),
    ]:
        stats = _range_stats(vals)
        if stats:
            ranges[key] = stats

    # Parameter bucket analysis: avg generation speed per setting
    param_insights: list[dict[str, Any]] = []
    for param, label in [("temperature", "Temperature"), ("num_predict", "Max tokens")]:
        buckets: dict[Any, list[float]] = {}
        for e in entries:
            val = e.get("options", {}).get(param)
            tps = e.get("throughput", {}).get("eval_tokens_per_sec")
            if val is not None and tps is not None:
                buckets.setdefault(val, []).append(tps)
        if not buckets:
            continue
        bucket_avgs = {k: sum(v) / len(v) for k, v in buckets.items()}
        all_avgs = list(bucket_avgs.values())
        for val, avg_tps in sorted(bucket_avgs.items(), key=lambda x: x[1], reverse=True):
            param_insights.append({
                "parameter": param,
                "label": label,
                "value": val,
                "avg_eval_tps": round(avg_tps, 2),
                "runs": len(buckets[val]),
                "rating": _percentile_rating(avg_tps, all_avgs, higher_is_better=True),
            })

    # Metric ratings for the latest run
    latest = entries[-1]
    latest_metrics: list[dict[str, Any]] = []
    metric_defs = [
        ("eval_tokens_per_sec", "Generation speed", eval_tps, True),
        ("prompt_tokens_per_sec", "Prompt speed", prompt_tps, True),
        ("time_to_first_token_s", "Time to first token", ttft, False),
        ("load_duration_s", "Load time", load_s, False),
    ]
    for key, label, pool, higher_is_better in metric_defs:
        if key in ("eval_tokens_per_sec", "prompt_tokens_per_sec"):
            val = latest.get("throughput", {}).get(key)
        else:
            val = latest.get("timing", {}).get(key)
        latest_metrics.append({
            "key": key,
            "label": label,
            "value": val,
            "rating": _percentile_rating(val, pool, higher_is_better=higher_is_better),
        })

    best_idx = max(
        range(len(entries)),
        key=lambda i: entries[i].get("throughput", {}).get("eval_tokens_per_sec") or 0,
    )
    best = entries[best_idx]
    best_opts = best.get("options", {})

    best_params = [p for p in param_insights if p["rating"] == "best"]
    poor_params = [p for p in param_insights if p["rating"] == "poor"]

    parts: list[str] = []
    if len(entries) == 1:
        parts.append("First benchmark recorded — run more tests to compare parameter settings.")
    else:
        if best_params:
            labels = ", ".join(f"{p['label']} {p['value']}" for p in best_params[:3])
            parts.append(f"Best throughput settings: {labels}.")
        if poor_params:
            labels = ", ".join(f"{p['label']} {p['value']}" for p in poor_params[:3])
            parts.append(f"Underperforming in range: {labels}.")
        gen_range = ranges.get("generation_tok_per_sec")
        if gen_range:
            parts.append(
                f"Generation speed observed {gen_range['min']}–{gen_range['max']} tok/s "
                f"(avg {gen_range['avg']})."
            )
        tok_range = ranges.get("tokens_generated")
        if tok_range:
            parts.append(
                f"Tokens generated per run: {int(tok_range['min'])}–{int(tok_range['max'])} "
                f"(avg {tok_range['avg']})."
            )

    return {
        "runs": len(entries),
        "ranges": ranges,
        "parameters": param_insights,
        "metrics": latest_metrics,
        "best_run": {
            "eval_tokens_per_sec": best.get("throughput", {}).get("eval_tokens_per_sec"),
            "temperature": best_opts.get("temperature"),
            "num_predict": best_opts.get("num_predict"),
            "eval_count": best.get("tokens", {}).get("eval_count"),
            "benchmark_at": best.get("timestamps", {}).get("benchmark_at"),
        },
        "summary": " ".join(parts) if parts else "Insufficient data for recommendations.",
    }


@app.get("/api/insights")
async def get_insights(model: str | None = None):
    if model:
        entries = [h for h in benchmark_history if h.get("model") == model]
        return {"model": model, "insights": _analyze_model_insights(entries)}

    by_model: dict[str, list[dict[str, Any]]] = {}
    for h in benchmark_history:
        name = h.get("model") or "unknown"
        by_model.setdefault(name, []).append(h)

    return {
        "models": {
            name: _analyze_model_insights(entries)
            for name, entries in sorted(by_model.items())
        }
    }


@app.get("/api/history")
async def get_history():
    return {"history": list(reversed(benchmark_history))}


@app.post("/api/benchmark")
async def run_benchmark(req: BenchmarkRequest):
    system_before = _system_snapshot()

    try:
        tags = await _ollama_get("/api/tags")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list models: {exc}") from exc

    model_info = _find_model_details(tags.get("models", []), req.model)
    if model_info is None:
        raise HTTPException(status_code=404, detail=f"Model '{req.model}' not found")

    payload = {
        "model": req.model,
        "prompt": req.prompt,
        "stream": False,
        "options": {
            "num_predict": req.num_predict,
            "temperature": req.temperature,
        },
    }

    warmup_metrics = None
    try:
        if req.warmup:
            warmup_payload = {**payload, "options": {**payload["options"], "num_predict": 5}}
            warmup_result = await _ollama_post("/api/generate", warmup_payload, timeout=300.0)
            warmup_metrics = {
                "load_duration_s": _ns_to_seconds(warmup_result.get("load_duration")),
                "eval_tokens_per_sec": _tokens_per_second(
                    warmup_result.get("eval_count"),
                    warmup_result.get("eval_duration"),
                ),
            }

        started = time.perf_counter()
        result = await _ollama_post("/api/generate", payload, timeout=600.0)
        wall_clock_s = round(time.perf_counter() - started, 4)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Benchmark failed: {exc}") from exc

    system_after = _system_snapshot()
    metrics = _build_metrics(result, model_info, system_after)
    metrics["prompt"] = req.prompt
    metrics["options"] = {"num_predict": req.num_predict, "temperature": req.temperature}
    metrics["warmup"] = warmup_metrics
    metrics["wall_clock_s"] = wall_clock_s
    metrics["system_before"] = system_before
    metrics["memory_delta_gb"] = round(
        system_after["memory_used_gb"] - system_before["memory_used_gb"], 2
    )

    benchmark_history.append(metrics)
    if len(benchmark_history) > HISTORY_LIMIT:
        benchmark_history.pop(0)

    model_entries = [h for h in benchmark_history if h.get("model") == req.model]
    metrics["insights"] = _analyze_model_insights(model_entries)

    return metrics


@app.delete("/api/history")
async def clear_history():
    benchmark_history.clear()
    return {"cleared": True}
