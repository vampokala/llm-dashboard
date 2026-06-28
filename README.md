# LLM Benchmark Dashboard

A web dashboard for benchmarking **local LLM inference performance** via [Ollama](https://ollama.com) and [LM Studio](https://lmstudio.ai). Measure throughput, latency, time-to-first-token, and compare parameter settings across benchmark runs — from either backend in one UI.

![LLM Benchmark Dashboard](docs/dashboard-screenshot.png)

## Quick Start

```bash
# Prerequisites: at least one inference backend running with a model available

# Option A — Ollama
ollama serve
ollama pull llama3.2

# Option B — LM Studio
# Install LM Studio, start the local server (default port 1234), and load a model

# Start the dashboard (works with either or both backends)
./start.sh
# Open http://localhost:8765
```

Select a model from the dropdown — entries are labeled `[Ollama]` or `[LM Studio]`. The dashboard connects to whichever backends are online.

## Dashboard Layout

The UI is organized into a **configuration sidebar** (left) and a **results workspace** (right). Colors follow the dark theme: green for generation metrics, blue for prompt metrics.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#1a2230", "primaryTextColor": "#e8edf4", "primaryBorderColor": "#2a3544", "lineColor": "#8b9cb3", "secondaryColor": "#121820", "tertiaryColor": "#0b0f14", "fontSize": "13px"}}}%%
flowchart TB
    subgraph Header["Header - Backend connection status"]
        direction LR
        H1["LLM Benchmark Dashboard"]
        H2["Ollama + LM Studio connected"]
    end

    subgraph Workspace["Dashboard workspace"]
        direction LR

        subgraph Sidebar["Sidebar - Configuration"]
            direction TB
            S1["Model selector<br/>[Ollama] llama3.3:70b or [LM Studio] qwen/..."]
            S2["Prompt presets<br/>Short, Essay, Code, Reasoning"]
            S3["Prompt textarea"]
            S4["Max Tokens and Temperature"]
            S5["Warm-up run checkbox"]
            S6["Run Benchmark"]
        end

        subgraph Main["Main - Results and Monitoring"]
            direction TB

            subgraph SysBar["System Status Bar"]
                direction LR
                M1["Memory Used"]
                M2["Memory Available"]
                M3["CPU"]
                M4["Swap"]
                M5["Ollama version"]
                M6["LM Studio loaded / models"]
                M7["Loaded Models"]
            end

            subgraph Metrics["Performance Metrics"]
                direction LR
                P1["Generation Speed<br/>tokens per sec"]
                P2["Prompt Speed<br/>tokens per sec"]
                P3["Load Time"]
                P4["Time to First Token"]
                P5["Tokens Generated"]
                P6["Total Duration"]
            end

            subgraph Content["Detail Panels"]
                direction LR
                C1["Model Response"]
                C2["Timing Breakdown"]
                C3["Model Parameters"]
            end

            subgraph Viz["History and Comparison"]
                direction TB
                V1["Throughput Comparison Chart<br/>Generation and Prompt tok/s"]
                V2["Benchmark History Table"]
            end
        end
    end

    Header --> Workspace

    classDef sidebar fill:#121820,stroke:#2a3544,color:#e8edf4
    classDef sysbar fill:#1a2230,stroke:#4da3ff,color:#e8edf4
    classDef genMetric fill:#1a2230,stroke:#76b900,color:#76b900
    classDef promptMetric fill:#1a2230,stroke:#4da3ff,color:#4da3ff
    classDef action fill:#76b900,stroke:#5a8f00,color:#0b0f14
    classDef panel fill:#121820,stroke:#2a3544,color:#8b9cb3
    classDef header fill:#121820,stroke:#76b900,color:#e8edf4

    class S1,S2,S3,S4,S5 sidebar
    class S6 action
    class M1,M2,M3,M4,M5,M6,M7 sysbar
    class P1,P3,P4,P5,P6 genMetric
    class P2 promptMetric
    class C1,C2,C3,V1,V2 panel
    class H1,H2 header
```

## Benchmark Flow

From user click to displayed results — green steps are generation-focused, blue steps are prompt/system, gray steps are orchestration. The backend routes to Ollama or LM Studio based on the selected model's provider.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#1a2230", "primaryTextColor": "#e8edf4", "primaryBorderColor": "#2a3544", "lineColor": "#8b9cb3"}}}%%
flowchart TD
    Start(["User clicks Run Benchmark"]) --> C1

    subgraph Config["1. Configure"]
        C1["Select model and provider"]
        C2["Set prompt and presets"]
        C3["Tune max tokens and temperature"]
    end

    C1 --> C2 --> C3 --> A1

    subgraph API["2. Backend - FastAPI"]
        A1["Capture system snapshot"]
        A2["Validate model for provider"]
        C4{"Warm-up enabled?"}
        A4["Build metrics and insights"]
        A5["Append to history"]
    end

    A1 --> A2 --> C4
    C4 -->|Yes| W1["Warm-up request<br/>5 tokens, load model"]
    C4 -->|No| P1
    W1 --> P1

    subgraph Provider["3. Inference backend"]
        direction TB
        O1["Ollama: POST /api/generate"]
        L1["LM Studio: POST /v1/completions"]
    end

    P1{"Provider?"}
    P1 -->|ollama| O1
    P1 -->|lmstudio| L1
    O1 --> A4
    L1 --> A4
    A4 --> A5

    subgraph UI["4. Dashboard Update"]
        U1["Metric cards<br/>tok/s, TTFT, load time"]
        U2["Model response text"]
        U3["Timing and parameter tables"]
        U4["Throughput chart and history"]
    end

    A5 --> U1
    U1 --> U2 --> U3 --> U4 --> Done(["Benchmark complete"])

    classDef user fill:#4da3ff,stroke:#3b82f6,color:#0b0f14
    classDef config fill:#121820,stroke:#2a3544,color:#e8edf4
    classDef backend fill:#1a2230,stroke:#8b9cb3,color:#e8edf4
    classDef warmup fill:#1a2230,stroke:#f0a020,color:#f0a020
    classDef gen fill:#1a2230,stroke:#76b900,color:#76b900
    classDef display fill:#121820,stroke:#76b900,color:#76b900
    classDef done fill:#76b900,stroke:#5a8f00,color:#0b0f14

    class Start user
    class C1,C2,C3 config
    class A1,A2,A4,A5,C4 backend
    class W1 warmup
    class O1,L1 gen
    class U1,U2,U3,U4 display
    class Done done
```

## Architecture

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#1a2230", "primaryTextColor": "#e8edf4", "primaryBorderColor": "#2a3544", "lineColor": "#8b9cb3"}}}%%
flowchart LR
    subgraph Browser["Browser"]
        HTML["index.html"]
        JS["app.js"]
        CSS["style.css"]
        Chart["Chart.js"]
    end

    subgraph Server["LLM Dashboard port 8765"]
        FastAPI["server.py FastAPI"]
        History["History buffer<br/>max 50 runs"]
        Insights["Insights engine"]
        Psutil["psutil monitor"]
    end

    subgraph OllamaRT["Ollama port 11434"]
        OllamaAPI["HTTP API"]
        OllamaInfer["Inference engine"]
        OllamaModels["GGUF models"]
    end

    subgraph LMStudioRT["LM Studio port 1234"]
        LMSAPI["OpenAI-compatible API"]
        LMSInfer["Inference engine"]
        LMSModels["Local models"]
    end

    HTML --> JS
    JS -->|"REST API calls"| FastAPI
    FastAPI --> History
    FastAPI --> Insights
    FastAPI --> Psutil
    FastAPI -->|"httpx async"| OllamaAPI
    FastAPI -->|"httpx async"| LMSAPI
    OllamaAPI --> OllamaInfer --> OllamaModels
    LMSAPI --> LMSInfer --> LMSModels

    classDef browser fill:#121820,stroke:#4da3ff,color:#4da3ff
    classDef server fill:#1a2230,stroke:#76b900,color:#76b900
    classDef ollama fill:#121820,stroke:#8b9cb3,color:#e8edf4
    classDef lmstudio fill:#121820,stroke:#f0a020,color:#f0a020
    classDef store fill:#0b0f14,stroke:#2a3544,color:#8b9cb3

    class HTML,JS,CSS,Chart browser
    class FastAPI,Insights,Psutil server
    class OllamaAPI,OllamaInfer,OllamaModels ollama
    class LMSAPI,LMSInfer,LMSModels lmstudio
    class History store
```

### Color Legend

Diagrams use the same palette as `static/style.css`. See [DOCUMENTATION.md](./DOCUMENTATION.md#diagram-color-theme) for the full style reference.

| Color | Hex | Used For |
|-------|-----|----------|
| Green | `#76b900` | Generation speed, primary actions, success |
| Blue | `#4da3ff` | Prompt speed, system bar, user interaction |
| Amber | `#f0a020` | Warm-up phase, LM Studio nodes |
| Red | `#e05252` | Model load step, errors |
| Dark surface | `#121820` / `#1a2230` | Panels and cards |
| Muted text | `#8b9cb3` | Labels and secondary info |

## Features

- Benchmark models from **Ollama** or **LM Studio** in a single dashboard
- Run controlled generation benchmarks with configurable prompts and parameters
- View generation speed, prompt speed, load time, and time-to-first-token
- Monitor host CPU, memory, and loaded models from both backends
- Track benchmark history with charts and comparative insights (scoped per provider + model)
- Rate performance relative to your own runs (Best / Expected / Poor)

## Documentation

**[Full Technical Documentation → DOCUMENTATION.md](./DOCUMENTATION.md)**

The comprehensive guide covers:

- Architecture and Mermaid diagrams (flow, sequence, component)
- Ollama and LM Studio benchmark paths and metric derivation
- LLM performance evaluation methodology
- All metrics, parameters, and evaluation criteria
- REST API reference
- UI guide, troubleshooting, and extension points

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API URL |
| `LMSTUDIO_BASE_URL` | `http://127.0.0.1:1234` | LM Studio local server URL |
| `PORT` | `8765` | Dashboard port (`start.sh`) |

At least one backend must be reachable. Both can run simultaneously — the model dropdown merges LLM models from each provider.

## Stack

Python · FastAPI · Uvicorn · httpx · psutil · Vanilla JS · Chart.js · Ollama · LM Studio

## License

See repository for license details.
