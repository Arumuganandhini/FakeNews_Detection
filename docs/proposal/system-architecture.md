# System Architecture

## Overview

```
                    ┌──────────────────────────────────────────┐
                    │        News article (title, text,        │
                    │             source, URL)                 │
                    └────────────────────┬─────────────────────┘
                                         │
        ┌──────────────┬─────────────────┼─────────────────┬──────────────┐
        ▼              ▼                 ▼                 ▼              │
┌───────────────┐ ┌───────────┐ ┌───────────────┐ ┌──────────────────┐   │
│    Source     │ │ Headline  │ │    Bias &     │ │   Cross-Source   │   │
│  Reputation   │ │  Quality  │ │   Language    │ │   Verification   │   │
│  (database    │ │ (LLM      │ │ (LLM flags    │ │ (claim extract → │   │
│   lookup)     │ │  scoring) │ │  sentences)   │ │  NewsAPI search →│   │
│               │ │           │ │               │ │  stance check)   │   │
└───────┬───────┘ └─────┬─────┘ └───────┬───────┘ └────────┬─────────┘   │
        │               │               │                  │             │
        └───────────────┴───────┬───────┴──────────────────┘             │
                                ▼                                        │
                  ┌──────────────────────────┐                           │
                  │   Weighted Aggregation   │                           │
                  │ (weights redistribute if │                           │
                  │  verification finds no   │                           │
                  │       coverage)          │                           │
                  └────────────┬─────────────┘                           │
                               ▼                                         │
                  ┌──────────────────────────┐                           │
                  │    Trust Report (UI)     │◄──────────────────────────┘
                  │ score dial · factor bars │
                  │ flagged sentences ·      │
                  │ evidence links           │
                  └──────────────────────────┘
```

## The Four Analysis Factors

| Factor | Weight | Method | Output |
|--------|--------|--------|--------|
| Source Reputation | 25% | Lookup in curated database of ~120 rated outlets with fuzzy name/domain matching | Reliability score, outlet type, editorial lean |
| Headline Quality | 15% | Structured LLM analysis of the headline | Clickbait score + named signals |
| Bias & Language | 25% | Structured LLM analysis of article text | Bias score + flagged sentences, each with type and reason |
| Cross-Source Verification | 35% | LLM extracts claims → NewsAPI retrieves coverage from *other* outlets → LLM judges stance over the retrieved evidence only | Per-claim verdict: supported / contradicted / unverified, with evidence links |

## Design Principles

1. **Evidence-grounded verification.** The LLM never verifies a claim from
   its own memory. It only extracts claims and compares them against real
   coverage retrieved from independent outlets. When no coverage exists, the
   factor reports "unverified" and its weight is redistributed across the
   other factors — the system never pretends to verify.

2. **Transparent aggregation.** The final trust score is a fixed weighted
   formula over the four factor scores — auditable by anyone, not another
   AI-generated number.

3. **Calibration.** A Platt-scaling step (fitted on validation data) maps raw
   scores to honest probabilities, so a 70% trust score is empirically correct
   about 70% of the time.

## Evaluation Framework

The repository includes a reproducible testing framework (`backend/eval/`):

- Benchmark: ISOT dataset, stratified fake/real sampling with a fixed seed
- Leakage control: source identity hidden and news-agency prefixes stripped
  (in ISOT, all real articles come from one agency, which would leak the label)
- Configurations: full pipeline, per-factor ablations, and a single-prompt
  LLM baseline for comparison
- Metrics: accuracy, macro-F1, ROC-AUC, and expected calibration error
- Result (n=300): pipeline 94.7% accuracy vs 82.0% for the single-prompt
  baseline using the same model

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React.js |
| Backend | Node.js + Express.js |
| Database | MongoDB (Mongoose) |
| AI Model | Llama 3.1 8B via NVIDIA NIM API |
| News Data | NewsAPI (daily news) |
| Auth | JWT + bcrypt |
