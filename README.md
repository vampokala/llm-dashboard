# LLM Benchmark Dashboard

A web dashboard for benchmarking **local LLM inference performance** via [Ollama](https://ollama.com). Measure throughput, latency, time-to-first-token, and compare parameter settings across benchmark runs.

![LLM Benchmark Dashboard](docs/dashboard-screenshot.png)

## Quick Start

```bash
# Prerequisites: Ollama running with at least one model
ollama serve
ollama pull llama3.2

# Start the dashboard
./start.sh
# Open http://localhost:8765
```

## Dashboard Layout

The UI is organized into a **configuration sidebar** (left) and a **results workspace** (right). Colors follow the dark theme: green for generation metrics, blue for prompt metrics.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#1a2230", "primaryTextColor": "#e8edf4", "primaryBorderColor": "#2a3544", "lineColor": "#8b9cb3", "secondaryColor": "#121820", "tertiaryColor": "#0b0f14", "fontSize": "13px"}}}%%
flowchart TB
    subgraph Header["Header - Ollama connection status"]
        direction LR
        H1["LLM Benchmark Dashboard"]
        H2["Ollama connected"]
    end

    subgraph Workspace["Dashboard workspace"]
        direction LR

        subgraph Sidebar["Sidebar - Configuration"]
            direction TB
            S1["Model selector<br/>llama3.3:70b - 70.6B - Q4_K_M"]
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
                M6["Loaded Models"]
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
    class M1,M2,M3,M4,M5,M6 sysbar
    class P1,P3,P4,P5,P6 genMetric
    class P2 promptMetric
    class C1,C2,C3,V1,V2 panel
    class H1,H2 header
```

## Benchmark Flow

From user click to displayed results — green steps are generation-focused, blue steps are prompt/system, gray steps are orchestration.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#1a2230", "primaryTextColor": "#e8edf4", "primaryBorderColor": "#2a3544", "lineColor": "#8b9cb3"}}}%%
flowchart TD
    Start(["User clicks Run Benchmark"]) --> C1

    subgraph Config["1. Configure"]
        C1["Select model"]
        C2["Set prompt and presets"]
        C3["Tune max tokens and temperature"]
    end

    C1 --> C2 --> C3 --> A1

    subgraph API["2. Backend - FastAPI"]
        A1["Capture system snapshot"]
        A2["Validate model via Ollama"]
        C4{"Warm-up enabled?"}
        A4["Build metrics and insights"]
        A5["Append to history"]
    end

    A1 --> A2 --> C4
    C4 -->|Yes| W1["Warm-up generate<br/>5 tokens, load model"]
    C4 -->|No| O1
    W1 --> O1

    subgraph Ollama["3. Ollama Inference"]
        O1["POST /api/generate"]
        O2["Load model weights"]
        O3["Prompt evaluation"]
        O4["Token generation"]
    end

    A1 --> A2 --> O1
    O1 --> O2 --> O3 --> O4
    O4 --> A4 --> A5

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
    classDef load fill:#1a2230,stroke:#e05252,color:#e8edf4
    classDef prompt fill:#1a2230,stroke:#4da3ff,color:#4da3ff
    classDef gen fill:#1a2230,stroke:#76b900,color:#76b900
    classDef display fill:#121820,stroke:#76b900,color:#76b900
    classDef done fill:#76b900,stroke:#5a8f00,color:#0b0f14

    class Start user
    class C1,C2,C3 config
    class A1,A2,A4,A5,C4 backend
    class W1 warmup
    class O2 load
    class O3 prompt
    class O1,O4 gen
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
        API["HTTP API"]
        Infer["Inference engine"]
        Models["GGUF models"]
    end

    HTML --> JS
    JS -->|"REST API calls"| FastAPI
    FastAPI --> History
    FastAPI --> Insights
    FastAPI --> Psutil
    FastAPI -->|"httpx async"| API
    API --> Infer --> Models

    classDef browser fill:#121820,stroke:#4da3ff,color:#4da3ff
    classDef server fill:#1a2230,stroke:#76b900,color:#76b900
    classDef ollama fill:#121820,stroke:#8b9cb3,color:#e8edf4
    classDef store fill:#0b0f14,stroke:#2a3544,color:#8b9cb3

    class HTML,JS,CSS,Chart browser
    class FastAPI,Insights,Psutil server
    class API,Infer,Models ollama
    class History store
```

### Color Legend

Diagrams use the same palette as `static/style.css`. See [DOCUMENTATION.md](./DOCUMENTATION.md#diagram-color-theme) for the full style reference.

| Color | Hex | Used For |
|-------|-----|----------|
| Green | `#76b900` | Generation speed, primary actions, success |
| Blue | `#4da3ff` | Prompt speed, system bar, user interaction |
| Amber | `#f0a020` | Warm-up phase |
| Red | `#e05252` | Model load step, errors |
| Dark surface | `#121820` / `#1a2230` | Panels and cards |
| Muted text | `#8b9cb3` | Labels and secondary info |

## Features

- Run controlled generation benchmarks with configurable prompts and parameters
- View generation speed, prompt speed, load time, and time-to-first-token
- Monitor host CPU, memory, and loaded Ollama models
- Track benchmark history with charts and comparative insights
- Rate performance relative to your own runs (Best / Expected / Poor)

## Documentation

**[Full Technical Documentation → DOCUMENTATION.md](./DOCUMENTATION.md)**

The comprehensive guide covers:

- Architecture and Mermaid diagrams (flow, sequence, component)
- LLM performance evaluation methodology
- All metrics, parameters, and evaluation criteria
- REST API reference
- UI guide, troubleshooting, and extension points

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API URL |
| `PORT` | `8765` | Dashboard port (`start.sh`) |

## Stack

Python · FastAPI · Uvicorn · httpx · psutil · Vanilla JS · Chart.js · Ollama

## License

See repository for license details.
