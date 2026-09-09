# 🛡️ AI-Powered News Trust and Credibility Analysis Platform

## 📖 Project Overview

The rapid growth of digital media has made it difficult for users to identify trustworthy news. Fake news, biased reporting, and clickbait content spread faster than ever before.

Most fake news detectors only answer one question — "Fake or Real?" — with no reasons, no evidence, and no measure of confidence.

This project goes further. It analyzes every news article from **six independent angles** and produces an **explainable trust score** that users can actually inspect and understand.

---

## 🎯 Problem Statement

Existing fake news detection systems have several limitations:

* They only classify news as Fake or Real.
* They do not explain **why** an article is untrustworthy.
* They do not check the reliability of the news source.
* They do not detect biased or emotionally manipulative language.
* They do not verify claims against other news outlets.
* Their confidence scores are often dishonest — a system may say "90% sure" while being right only 60% of the time.

As a result, users still struggle to judge whether a news article can truly be trusted.

---

## 🚀 Our Solution

Instead of one black-box prediction, every article passes through **six parallel checkers**:

### 🏛️ 1. Source Reputation

Checks the news outlet against a curated database of ~120 rated sources.

Reliable outlets raise the trust score. Unknown or low-rated outlets lower it.

### 📰 2. Headline Quality (Clickbait Detection)

Analyzes the headline for clickbait patterns:

* Exaggerated or sensational wording
* Curiosity-gap phrasing ("You won't BELIEVE...")
* Fear-mongering and emotional manipulation

### ⚖️ 3. Bias & Language Analysis

Reads the article content and **highlights the exact sentences** that show:

* Political bias
* One-sided reporting
* Sensationalism and emotional manipulation

Each flagged sentence comes with the reason it was flagged.

### 🔍 4. Source Transparency

Asks a question the other content checks cannot: **could a reader go and verify any of this?**

Runs a five-point journalism checklist — does the article name its sources, use attributed quotes, point to primary evidence, give concrete detail, and keep its claims measured? It also quotes back the unattributable phrases the article leans on, such as *"experts say"* or *"sources close to the investigation"*.

This is the one content check that stays informative for an obscure story that no other outlet has covered.

### 🎭 5. Persuasion Techniques

Goes beyond "this is biased" to name **which rhetorical technique** is being used, quoting the article's own words.

Follows the propaganda-technique literature (SemEval-2020 Task 11): loaded language, appeal to fear, name calling, false dilemma, whataboutism, bandwagon, thought-terminating clichés and more — each with the effect it has on the reader.

### 🔄 6. Cross-Source Verification

* Extracts the article's main factual claims
* Searches what **other independent news outlets** reported
* Compares the claims against that real coverage

If other outlets confirm the claims → trust increases.
If they contradict the claims → trust decreases and the user is alerted.
If no coverage exists → the system honestly reports **"unverified"** instead of guessing.

## 🔎 A note on professional fact-check matching

A seventh factor matched an article's claims against verdicts published by
professional fact-checkers (Snopes, PolitiFact, Full Fact and other IFCN
signatories). **It is implemented and tested, but not part of the running
pipeline.** Both routes to that evidence proved impractical:

| Route | Status |
|---|---|
| Google Fact Check Tools API | Requires a billing-enabled Google Cloud account |
| ClaimReview read from the fact-checker's own page | Works, but the only way to find the right page is the news search — and the free news tier allows **100 requests per 24 hours in total**, a budget the article feed and cross-source verification already depend on |
| Searching the fact-checkers directly | Tested and unusable: Snopes, PolitiFact and Full Fact all render search results in JavaScript, so there is nothing to read from the HTML |

Rather than spend the feed's request budget on a check with thin coverage, the
factor was retired and its weight redistributed across the remaining six. The
score is unaffected: in every cached report the factor had already stood down at
zero weight.

`backend/agents/factCheckAgent.js` and `backend/utils/claimReviewReader.js` are
kept, working and unwired. Both were verified end to end — given a claim Snopes
had rated, the reader retrieved the page, read `"False"` out of its ClaimReview
markup and cited the URL, and a claim on the same topic but a different assertion
was correctly rejected rather than matched. To switch it back on: obtain a Fact
Check Tools key, set `FACTCHECK_API_KEY`, then re-add the import, a weight and the
factor entry in `trustAnalysisAgent.js`.

## 🤖 Explainable Trust Score

The six results combine into one trust score through a **transparent weighted formula** — not another AI guess. The user sees the full breakdown:

* Overall score dial with a verdict (Trustworthy / Exercise Caution / Low Credibility)
* Individual bars for each of the six factors, with its weight in the score
* The highlighted biased sentences
* The verified/contradicted claims with evidence links

The score is also **calibrated**: when the system says 70% trust, it is actually right about 70% of the time.

---

## 📊 Tested Results

Tested on 300 articles from the standard **ISOT fake news dataset** (150 fake, 150 real), with source identity hidden so the benchmark's known Reuters label-leak cannot help:

| Approach | Accuracy |
|----------|----------|
| Asking the AI model directly (single prompt) | 82.0% |
| **Our multi-factor pipeline (same AI model)** | **94.7%** |

Removing any single checker lowers the accuracy — proof that every module contributes. The full testing framework is in [`backend/eval/`](backend/eval/) and every result is reproducible from a fixed seed.

### Analysis latency

Measured end to end on the same articles, cold (no cache):

| stage | cold analysis |
|---|---|
| original (NIM, 2 slots, serial verification) | ~63s, occasionally 116s |
| after switching the provider to Gemini | 34-49s |
| after sizing the gate to the provider | 16.6s |
| after verifying claims in parallel and overlapping claim extraction | **11-19s** |

A cached report is served in about **5 ms**, and `npm run prewarm` pays the cold
cost in advance for a whole category.

### Watching the report being built

The analysis is also available as a stream, and the article page uses it. Rather
than holding a spinner until all six checks finish, the page ticks each one off
as the server reports it:

```
+0.0s  Who published it                 (no model call — instant)
+1.9s  Is the writing fair?
+2.8s  Can you check it yourself?
+3.5s  Is the headline honest?
+8.4s  Is it using persuasion tricks?
+10.1s Do other outlets agree?          -> full report
```

`POST /api/ai/trust-analysis/stream` answers with newline-delimited JSON — one
line per completed check, then the assembled report. NDJSON rather than
Server-Sent Events because the article body has to be POSTed and the browser's
`EventSource` is GET-only. If the stream is unavailable the client falls back to
the ordinary `POST /api/ai/trust-analysis`, which is unchanged.

Remaining variance is not in this code: news retrieval and the hosted model queue
both fluctuate, and a single article's coverage search has been seen to take 40s
on its own.

> **Note:** these figures were measured on `meta/llama-3.1-8b-instruct`, which the provider has since retired, and before the transparency and persuasion checkers were added. A re-run on the current model and pipeline is pending; treat the numbers above as the last fully reproducible measurement rather than a claim about today's build.

---

## ✨ Platform Features

* 📰 Daily news feed with category browsing
* 🛡️ One-click **"Analyze Trustworthiness"** report for any article
* ✍️ AI-generated short and detailed summaries
* 🧠 News-literacy quizzes generated from article content
* 👤 User accounts, reading history, and activity tracking

---

## 🛠️ Technology Stack

### 🎨 Frontend

* React.js

### ⚙️ Backend

* Node.js + Express.js

### 🧠 AI / NLP

* Language model through a provider-agnostic gateway — **NVIDIA NIM** or **Google Gemini**, switchable with one setting, with automatic failover between them

---

## 🔀 Switching the language model provider

NVIDIA NIM is free and needs no billing account, which is why the project was
built on it. It has since become heavily congested: the *same* call has been
measured at 2 seconds and at 62 seconds, and `503 model busy` is routine. That
queueing — not the pipeline — is the dominant cost of an analysis.

So the gateway is provider-agnostic. One line in `backend/.env` decides the order:

```bash
LLM_PROVIDER=gemini,nim   # Gemini leads, NIM catches its failures
LLM_PROVIDER=nim          # NVIDIA NIM only (the code default)
LLM_PROVIDER=nim,gemini   # NIM leads, Gemini catches its failures
```

The first *configured* provider leads; the rest are automatic failover. A
provider with no API key is skipped rather than failing the request, so an
unavailable provider never takes the system down.

Measured head-to-head on three real pipeline tasks, three runs each:

| | NVIDIA NIM (`nemotron-3-super-120b`) | Google Gemini (`gemini-3.1-flash-lite`) |
|---|---|---|
| bias check | 3/3 valid, 6.2s | 3/3 valid, **3.8s** |
| summary | 2/3 valid, 3.5s | **3/3 valid**, **1.6s** |
| persuasion techniques | **1/3 valid**, 10.5s | **3/3 valid**, **4.6s** |
| best-case total | 20.1s | **10.0s** |

Gemini is roughly twice as fast and returned usable output on every run, where
NIM's persuasion check succeeded only once in three — which is what had been
triggering the rule-based fallbacks. Both providers are kept: NIM remains the
more available option and is one setting away.

Keys live in `backend/.env` as `NIM_API_KEY` and `GEMINI_API_KEY`; the model per
provider can be overridden with `NIM_MODEL_NAME` / `GEMINI_MODEL_NAME`.

### How many calls run at once

The gateway caps concurrent model calls, and the right cap turned out to be a
property of the provider rather than a constant. Six identical calls, all valid:

| calls in parallel | NVIDIA NIM | Google Gemini |
|---|---|---|
| 2 | baseline | 37.5s |
| 3 | — | **7.9s** |
| 6 | *slower* than 2 | 9.1s |

NIM degrades when pushed, so it is held at two. Gemini does not, and a cap of two
was throttling the pipeline nearly fivefold. The limit is therefore read from
whichever provider leads, and can be overridden with `LLM_MAX_CONCURRENT`.

> Both vendors keep retired models in their public model lists — NIM's
> `llama-3.1-8b-instruct` and Gemini's `2.5-flash` names both answer a catalogue
> request and then return 404 on a real one. The gateway treats 404/410 as
> "retired" and moves to the next model automatically.
* Custom multi-factor analysis pipeline
* Rule-based fallback analysers, so an outage degrades the report instead of faking one

---

## 🧯 What happens when the AI model is unavailable

A hosted model can be retired, rate-limited or simply overloaded. The system is
built so that none of those silently corrupts a trust report.

* **Model retired (404/410)** → the next model in the fallback chain is adopted
  permanently for that process.
* **Model busy (503) or rate-limited (429)** → the same model is retried with
  backoff before any fallback is considered, so one busy moment does not demote
  a healthy fast model to a slower backup.
* **Model unreachable entirely** → the four content checks — headline honesty,
  fairness, persuasion technique and transparency — fall back to deterministic
  word-pattern and lexicon analysis. These catch less than the model does and
  the report says so, both on the summary and on each affected factor.
* **A check has no evidence to weigh** (no other coverage, no published
  fact-check) → the factor **stands down**: its weight is redistributed across
  the checks that did produce signal, and the reader is told exactly why.

The one thing the system never does is invent a neutral score for a check that
did not run. On a total outage a fabricated article still scores **2.3/10 —
"Be skeptical"**, and ordinary reporting still scores **9.8/10**.

### Making the demo fast

The first analysis of an article costs one round trip per factor, which on the
free tier under load has been measured at up to four minutes. Every report is
cached by article URL for fourteen days, so that cost is paid once. To pay it in
advance, before a demo or presentation:

```bash
npm run prewarm                                  # default categories
npm run prewarm -- business technology --limit 5 # named categories
```

Cached articles then open in about 20 ms. The script skips anything already
cached and is safe to re-run after an interruption. Reports carry a schema
version, so after a pipeline change old cached reports are re-analysed rather
than served.

### 🗄️ Database

* MongoDB

### 📡 News Data

* NewsAPI

---

## 🔮 Future Scope

* 🏆 **News Literacy Levels** — users earn points for reading verified news and level up from "Reader" to "Fact Checker" to "Truth Guardian"
* 🏅 **Reader trust dashboard** — charts of the trust level of what you read



---

## 📌 Conclusion

This platform provides a complete solution for news verification by combining source credibility analysis, clickbait detection, bias detection, cross-source claim verification, and explainable AI into a single working system — helping users not just detect fake news, but understand **why** an article can or cannot be trusted.
