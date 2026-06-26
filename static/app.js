/* LLM Benchmark Dashboard — frontend */

const PRESETS = {
  short: "Count from 1 to 20, one number per line.",
  essay: "Write a 200-word essay on the advantages and trade-offs of running large language models locally versus in the cloud.",
  code: "Write a Python function that implements binary search on a sorted list. Include a docstring and one example.",
  reason: "A farmer has 17 sheep. All but 9 die. How many are left? Explain your reasoning step by step.",
};

let models = [];
let chart = null;

// ── DOM refs ──
const $ = (sel) => document.querySelector(sel);
const modelSelect = $("#modelSelect");
const runBtn = $("#runBtn");
const promptInput = $("#promptInput");
const numPredict = $("#numPredict");
const temperature = $("#temperature");
const tempVal = $("#tempVal");
const warmupCheck = $("#warmupCheck");
const connectionStatus = $("#connectionStatus");
const statusDot = $("#statusDot");
const loadingOverlay = $("#loadingOverlay");
const loadingText = $("#loadingText");

// ── Init ──
document.addEventListener("DOMContentLoaded", async () => {
  initChart();
  bindEvents();
  await refreshAll();
  setInterval(refreshSystem, 5000);
});

function bindEvents() {
  runBtn.addEventListener("click", runBenchmark);
  modelSelect.addEventListener("change", () => {
    updateModelMeta();
    loadInsights();
  });
  temperature.addEventListener("input", () => {
    tempVal.textContent = (temperature.value / 10).toFixed(1);
  });
  $("#clearHistoryBtn").addEventListener("click", clearHistory);

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.preset;
      if (PRESETS[key]) promptInput.value = PRESETS[key];
    });
  });
}

// ── API helpers ──
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ── Refresh ──
async function refreshAll() {
  try {
    await api("/api/health");
    setConnection(true);
    await Promise.all([loadModels(), refreshSystem(), loadHistory(), loadInsights()]);
    runBtn.disabled = false;
  } catch {
    setConnection(false);
    runBtn.disabled = true;
  }
}

function setConnection(ok) {
  connectionStatus.textContent = ok ? "Ollama connected" : "Ollama offline";
  connectionStatus.className = `status-pill ${ok ? "ok" : "err"}`;
  statusDot.style.background = ok ? "var(--accent)" : "var(--danger)";
  statusDot.style.boxShadow = ok ? "0 0 8px var(--accent)" : "0 0 8px var(--danger)";
}

async function loadModels() {
  const data = await api("/api/models");
  models = data.models || [];
  modelSelect.innerHTML = models.length
    ? models.map((m) => `<option value="${m.name}">${m.name}</option>`).join("")
    : '<option value="">No models installed</option>';
  updateModelMeta();
}

function updateModelMeta() {
  const name = modelSelect.value;
  const m = models.find((x) => x.name === name);
  const meta = $("#modelMeta");
  if (!m) { meta.classList.add("hidden"); return; }
  meta.classList.remove("hidden");
  const d = m.details || {};
  $("#metaParams").textContent = d.parameter_size || "?";
  $("#metaQuant").textContent = d.quantization_level || "?";
  $("#metaSize").textContent = formatBytes(m.size);
}

async function refreshSystem() {
  try {
    const [sys, running] = await Promise.all([
      api("/api/system"),
      api("/api/running"),
    ]);
    $("#memUsed").textContent = `${sys.memory_used_gb} / ${sys.memory_total_gb} GB`;
    $("#memAvail").textContent = `${sys.memory_available_gb} GB`;
    $("#cpuPct").textContent = `${sys.cpu_percent}%`;
    $("#swapUsed").textContent = `${sys.swap_used_gb} GB`;
    $("#ollamaVer").textContent = sys.ollama_version || "—";

    const loaded = running.models || [];
    const el = $("#runningModels");
    if (loaded.length) {
      el.innerHTML = loaded
        .map((m) => `<span class="running-badge">${m.name}</span>`)
        .join("");
    } else {
      el.innerHTML = '<span class="running-badge none">none</span>';
    }
  } catch { /* silent on poll failure */ }
}

// ── Benchmark ──
async function runBenchmark() {
  const model = modelSelect.value;
  if (!model) return;

  loadingOverlay.classList.add("active");
  loadingText.textContent = warmupCheck.checked
    ? "Warming up model, then benchmarking…"
    : "Running benchmark…";
  runBtn.disabled = true;

  try {
    const result = await api("/api/benchmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: promptInput.value,
        num_predict: parseInt(numPredict.value, 10),
        temperature: parseFloat(tempVal.textContent),
        warmup: warmupCheck.checked,
      }),
    });
    displayResults(result);
    if (result.insights) renderInsights(result.insights);
    await loadHistory();
    await refreshSystem();
  } catch (err) {
    alert(`Benchmark failed: ${err.message}`);
  } finally {
    loadingOverlay.classList.remove("active");
    runBtn.disabled = false;
  }
}

function displayResults(r) {
  const t = r.timing || {};
  const tp = r.throughput || {};
  const tk = r.tokens || {};
  const mi = r.model_info || {};
  const ratings = {};
  if (r.insights?.metrics) {
    for (const m of r.insights.metrics) ratings[m.key] = m.rating;
  }

  setMetricRating("#mEvalTps", tp.eval_tokens_per_sec, ratings.eval_tokens_per_sec);
  setMetricRating("#mPromptTps", tp.prompt_tokens_per_sec, ratings.prompt_tokens_per_sec);
  setMetricRating("#mLoad", t.load_duration_s, ratings.load_duration_s);
  setMetricRating("#mTtft", t.time_to_first_token_s, ratings.time_to_first_token_s);
  $("#mEvalCount").textContent = tk.eval_count ?? "—";
  $("#mPromptCount").textContent = `prompt: ${tk.prompt_eval_count ?? "—"}`;
  setMetricRating("#mTotal", t.total_duration_s, null);

  const box = $("#responseBox");
  box.textContent = r.response || "(empty response)";
  box.classList.remove("empty");

  setTableRows("#timingTable", [
    ["Load duration", fmtS(t.load_duration_s)],
    ["Prompt eval duration", fmtS(t.prompt_eval_duration_s)],
    ["Generation duration", fmtS(t.eval_duration_s)],
    ["Wall clock", fmtS(r.wall_clock_s)],
    ["Time to first token", fmtS(t.time_to_first_token_s)],
    ["Overall throughput", `${fmt(tp.overall_tokens_per_sec)} tok/s`],
    ["Memory delta", r.memory_delta_gb != null ? `${r.memory_delta_gb > 0 ? "+" : ""}${r.memory_delta_gb} GB` : "—"],
    ["Done reason", r.done_reason || "—"],
    ...(r.warmup ? [["Warm-up load", fmtS(r.warmup.load_duration_s)]] : []),
  ]);

  setTableRows("#modelTable", [
    ["Model name", mi.name || "—"],
    ["Parameter size", mi.parameter_size || "—"],
    ["Quantization", mi.quantization_level || "—"],
    ["Family", mi.family || "—"],
    ["Format", mi.format || "—"],
    ["Context length", mi.context_length?.toLocaleString() || "—"],
    ["Embedding dim", mi.embedding_length || "—"],
    ["Disk size", mi.size_human || "—"],
    ["Digest", mi.digest ? mi.digest.slice(0, 16) + "…" : "—"],
  ]);
}

function setMetricRating(selector, value, rating) {
  const el = $(selector);
  const card = el.closest(".metric-card");
  el.textContent = fmt(value);
  if (card) {
    card.classList.remove("rating-best", "rating-expected", "rating-poor");
    if (rating) card.classList.add(`rating-${rating}`);
  }
}

function setTableRows(selector, rows) {
  const tbody = $(selector).querySelector("tbody");
  tbody.innerHTML = rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join("");
}

// ── History ──
async function loadHistory() {
  const data = await api("/api/history");
  const history = data.history || [];
  renderHistoryTable(history);
  updateChart(history);
}

async function loadInsights() {
  const model = modelSelect.value;
  if (!model) {
    renderInsights(null);
    return;
  }
  try {
    const data = await api(`/api/insights?model=${encodeURIComponent(model)}`);
    renderInsights(data.insights);
  } catch {
    renderInsights(null);
  }
}

const RANGE_LABELS = {
  tokens_generated: "Tokens generated",
  max_tokens_requested: "Max tokens requested",
  temperature: "Temperature",
  generation_tok_per_sec: "Generation speed",
  prompt_tok_per_sec: "Prompt speed",
  time_to_first_token_s: "Time to first token",
  load_duration_s: "Load time",
};

const RATING_LABELS = { best: "Best", expected: "Expected", poor: "Poor" };

function renderInsights(insights) {
  const runsEl = $("#insightsRuns");
  const summaryEl = $("#insightsSummary");
  const rangeGrid = $("#rangeGrid");
  const paramGrid = $("#paramGrid");
  const bestSection = $("#bestRunSection");
  const bestCard = $("#bestRunCard");

  if (!insights || !insights.runs) {
    runsEl.textContent = "0 runs";
    summaryEl.textContent =
      "Run benchmarks with different settings to see what works best for this model.";
    rangeGrid.innerHTML = '<div class="range-card empty-state">No data yet</div>';
    paramGrid.innerHTML =
      '<div class="param-card empty-state">Adjust temperature and max tokens across runs to compare</div>';
    bestSection.style.display = "none";
    return;
  }

  runsEl.textContent = `${insights.runs} run${insights.runs === 1 ? "" : "s"}`;
  summaryEl.textContent = insights.summary || "";

  const rangeKeys = Object.keys(RANGE_LABELS);
  const rangeHtml = rangeKeys
    .filter((k) => insights.ranges?.[k])
    .map((k) => {
      const r = insights.ranges[k];
      const isInt = k.includes("tokens") && !k.includes("tok_per");
      const fmtVal = (v) =>
        isInt ? Math.round(v).toLocaleString() : fmt(v);
      const unit =
        k.includes("tok_per_sec") ? " tok/s" : k.includes("_s") ? "s" : "";
      return `<div class="range-card">
        <div class="range-label">${RANGE_LABELS[k]}</div>
        <div class="range-values">
          <span class="range-min">${fmtVal(r.min)}${unit}</span>
          <span class="range-sep">→</span>
          <span class="range-max">${fmtVal(r.max)}${unit}</span>
        </div>
        <div class="range-avg">avg ${fmtVal(r.avg)}${unit}</div>
      </div>`;
    })
    .join("");
  rangeGrid.innerHTML =
    rangeHtml || '<div class="range-card empty-state">No data yet</div>';

  if (insights.parameters?.length) {
    paramGrid.innerHTML = insights.parameters
      .map(
        (p) => `<div class="param-card rating-${p.rating}">
          <div class="param-header">
            <span class="rating-badge ${p.rating}">${RATING_LABELS[p.rating]}</span>
            <span class="param-name">${p.label}</span>
          </div>
          <div class="param-value">${p.parameter === "temperature" ? p.value : p.value.toLocaleString()}</div>
          <div class="param-detail">${fmt(p.avg_eval_tps)} tok/s · ${p.runs} run${p.runs === 1 ? "" : "s"}</div>
        </div>`
      )
      .join("");
  } else {
    paramGrid.innerHTML =
      '<div class="param-card empty-state">Run more benchmarks with different settings to compare</div>';
  }

  const best = insights.best_run;
  if (best?.eval_tokens_per_sec != null && insights.runs > 1) {
    bestSection.style.display = "";
    const when = best.benchmark_at
      ? new Date(best.benchmark_at).toLocaleString()
      : "—";
    bestCard.innerHTML = `
      <span class="rating-badge best">Best</span>
      <span class="best-detail">
        <strong>${fmt(best.eval_tokens_per_sec)} tok/s</strong>
        · temp ${best.temperature ?? "—"}
        · max ${best.num_predict?.toLocaleString() ?? "—"} tokens
        · generated ${best.eval_count?.toLocaleString() ?? "—"}
      </span>
      <span class="best-time">${when}</span>`;
  } else {
    bestSection.style.display = "none";
  }
}

async function clearHistory() {
  await api("/api/history", { method: "DELETE" });
  await loadHistory();
  await loadInsights();
}

function tpsRating(tps, history, model) {
  const pool = history
    .filter((h) => h.model === model)
    .map((h) => h.throughput?.eval_tokens_per_sec)
    .filter((v) => v != null);
  if (pool.length < 2 || tps == null) return "";
  const sorted = [...pool].sort((a, b) => b - a);
  if (tps >= sorted[0]) return "tps-best";
  if (tps <= sorted[sorted.length - 1]) return "tps-poor";
  const rank = sorted.filter((v) => v > tps).length / (sorted.length - 1);
  if (rank <= 0.25) return "tps-best";
  if (rank >= 0.75) return "tps-poor";
  return "tps-expected";
}

function renderHistoryTable(history) {
  const tbody = $("#historyBody");
  if (!history.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:1.5rem;font-family:var(--font);">No benchmarks yet</td></tr>';
    return;
  }
  tbody.innerHTML = history
    .map((h) => {
      const time = h.timestamps?.benchmark_at
        ? new Date(h.timestamps.benchmark_at).toLocaleTimeString()
        : "—";
      const tps = h.throughput?.eval_tokens_per_sec;
      const rating = tpsRating(tps, history, h.model);
      const opts = h.options || {};
      return `<tr>
        <td>${time}</td>
        <td class="model-name">${h.model || "—"}</td>
        <td>${opts.temperature ?? "—"}</td>
        <td>${opts.num_predict?.toLocaleString() ?? "—"}</td>
        <td class="tps-cell ${rating}">${fmt(tps)}</td>
        <td>${fmt(h.throughput?.prompt_tokens_per_sec)}</td>
        <td>${h.tokens?.eval_count ?? "—"}</td>
        <td>${fmt(h.timing?.load_duration_s)}</td>
        <td>${fmt(h.timing?.total_duration_s)}</td>
      </tr>`;
    })
    .join("");
}

// ── Chart ──
function initChart() {
  const ctx = $("#throughputChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#8b9cb3", font: { size: 11 } } },
      },
      scales: {
        x: {
          ticks: { color: "#8b9cb3", font: { size: 10 }, maxRotation: 45 },
          grid: { color: "#2a3544" },
        },
        y: {
          title: { display: true, text: "tok/s", color: "#8b9cb3" },
          ticks: { color: "#8b9cb3" },
          grid: { color: "#2a3544" },
          beginAtZero: true,
        },
      },
    },
  });
}

function updateChart(history) {
  if (!chart) return;
  const labels = history.map((h, i) => {
    const short = (h.model || "?").split(":")[0];
    return `${short} #${i + 1}`;
  });
  chart.data.labels = labels;
  chart.data.datasets = [
    {
      label: "Generation tok/s",
      data: history.map((h) => h.throughput?.eval_tokens_per_sec ?? 0),
      backgroundColor: "rgba(118, 185, 0, 0.7)",
      borderColor: "#76b900",
      borderWidth: 1,
    },
    {
      label: "Prompt tok/s",
      data: history.map((h) => h.throughput?.prompt_tokens_per_sec ?? 0),
      backgroundColor: "rgba(77, 163, 255, 0.5)",
      borderColor: "#4da3ff",
      borderWidth: 1,
    },
  ];
  chart.update();
}

// ── Formatters ──
function fmt(v) {
  if (v == null || v === undefined) return "—";
  return typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v;
}

function fmtS(v) {
  if (v == null) return "—";
  return `${v}s`;
}

function formatBytes(n) {
  if (!n) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let val = n;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}
