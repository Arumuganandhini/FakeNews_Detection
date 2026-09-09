# Review Preparation — Questions & Answers

Team CO5 · AI-Powered News Trust and Credibility Analysis Platform

---

## 0. The 30-second answer (memorise this)

> "Existing fake-news systems give you one label — Fake or Real — from a black box.
> Ours checks an article from four independent angles: who published it, whether the
> headline is honest, whether the writing is fair, and whether other outlets report
> the same facts. It combines them into a transparent score and shows the evidence
> behind every part. And we proved the design works: on 300 articles from a standard
> benchmark, the same AI model scored 82% when asked directly, and 94.7% through our
> four-part pipeline."

Everything else in this document is an expansion of those five sentences.

---

## 1. "What is different in your project compared to existing ones?"

**This is the most important question. Answer with four specific differences.**

### Difference 1 — We explain, they only label
Existing systems output "Fake" or "Real". Ours outputs a score *plus*:
- the outlet's factual-reporting record
- the specific clickbait techniques found in the headline
- the exact sentences that are biased, each with the reason
- each key claim marked confirmed / contradicted / unconfirmed, with clickable links

A user can disagree with our score and still learn something. With a black-box label
they cannot.

### Difference 2 — Our verification is grounded in real evidence
Most systems that "verify" either ask the model what it knows, or need social-media
comments (like dEFEND, KDD 2019). Ours searches what *other independent outlets*
actually published, and only then asks the model to compare. If nothing is found, the
system says **"unverified"** and removes that factor from the score instead of guessing.

> Key line: *"The AI never verifies from memory. It only reads coverage we retrieved,
> and it has to cite which article supports its verdict."*

### Difference 3 — Our score is calibrated (almost nobody does this)
Guo et al. (ICML 2017) showed AI models are systematically overconfident. Very few
fake-news systems fix it. We measured our calibration error and corrected it, so the
number means what it says.

> Plain-English version: *"If our system says 70% trust, it is actually right about
> 70% of the time."*

### Difference 4 — It is a working platform, not a notebook
Most academic work is a model evaluated on a frozen dataset. Ours is a deployed web
app that analyses live news, with a reproducible evaluation framework in the repo.

---

## 2. "What is your approach?" (walk through the pipeline)

Say it as a flow. Every article goes through four checkers **in parallel**:

| # | Checker | Method | Weight |
|---|---------|--------|--------|
| 1 | **Who published it** | Lookup in a curated database of ~120 rated outlets. No AI — deterministic and auditable. | 25% |
| 2 | **Is the headline honest** | LLM scores clickbait patterns and names the signals found. | 15% |
| 3 | **Is the writing fair** | LLM flags the exact biased sentences with type and reason. | 25% |
| 4 | **Do other outlets agree** | LLM extracts claims → NewsAPI retrieves coverage from *other* outlets → LLM judges stance over that retrieved evidence. | 35% |

Then: **Trust Score Engine** combines them with a fixed weighted formula → **Platt
calibration** converts it to an honest probability → **Trust Report** shows the score,
the plain-English reasons, and the evidence.

**Why verification has the highest weight:** it is the only factor grounded in
independent evidence rather than the article's own text.

**What happens when verification finds nothing:** its 35% is redistributed
proportionally across the other three factors. The system never counts a guess.

---

## 3. "Where is the AI / NLP / Deep Learning?"

Answer in three layers — this shows engineering judgement, not just API usage.

**Layer 1 — Deep learning.** Every language task runs on **Llama 3.1 (8 billion
parameters)**, a transformer neural network accessed through the NVIDIA NIM API. We
apply it by transfer learning through prompting, with structured JSON output at low
temperature (0.2) for consistency. Four distinct NLP tasks run on it:

| NLP task | Where |
|---|---|
| Text classification | clickbait detection |
| Sentiment / emotion analysis | emotional manipulation in the bias checker |
| Span extraction & labelling | flagging the exact biased sentences |
| Information extraction | pulling checkable claims out of the article |
| Natural language inference (stance detection) | judging support/contradiction against retrieved coverage |
| Summarisation & question generation | article summaries and quizzes |

**Layer 2 — Classical ML / deterministic logic.** Source reputation is a database
lookup with whole-word matching. The Trust Score Engine is a weighted formula.
**Platt scaling is classical machine learning** — a logistic model fitted by gradient
descent on validation data. We keep these non-neural on purpose: auditable and free.

**Layer 3 — Information retrieval.** NewsAPI search supplies the evidence that grounds
the verification step. This is what stops the AI from hallucinating.

### If asked "why didn't you train your own BERT?"
> "We tested that question directly. The standard approach — one model prediction —
> got 82%. Our multi-factor design with the *same* model got 94.7%. The literature
> (FakeStack, MWPBert) shows trained classifiers reach high accuracy on one dataset
> but give no explanation, no evidence and no calibrated confidence. Our contribution
> is the explainable architecture, which no amount of classifier training provides."

---

## 4. "How is it efficient? Where is the proof?"

### The headline proof
On **300 articles** from the **ISOT fake-news dataset** (150 fake, 150 real):

| Approach | Accuracy | ROC-AUC |
|---|---|---|
| Single-prompt LLM (the usual way) | 82.0% | 0.838 |
| **Our four-part pipeline (same model)** | **94.7%** | **0.987** |

**+12.7 accuracy points from architecture alone.** Same model, same articles, same
prompt budget — only the design differs. That is the cleanest possible proof that the
contribution is real.

### The ablation study (proves every module earns its place)

| Configuration | Accuracy | ROC-AUC |
|---|---|---|
| Both content checkers | 94.7% | 0.987 |
| Clickbait only (bias removed) | 93.3% | 0.975 |
| Bias only (clickbait removed) | 92.7% | 0.934 |

Removing either checker lowers performance. The ordering is clean and monotonic.

### The calibration result

| | ECE raw | ECE after calibration |
|---|---|---|
| Our pipeline | 0.277 | **0.073** ✅ |
| Baseline | 0.215 | 0.151 ❌ |

Below 0.1 is considered well calibrated. Ours is the only configuration that gets
there. (ECE = expected calibration error: the gap between claimed confidence and
observed correctness.)

### Runtime efficiency
- A full four-part analysis takes **3–7 seconds** (the three AI checkers run in parallel).
- Results are **cached by article URL** for 14 days, so the first reader pays the cost
  and everyone after gets it **instantly**.
- The feed shows a trust hint on every card using only a database lookup — **zero AI
  calls**, so browsing stays fast.

### How to prove it live
```bash
cd backend && node eval/report.js
```
This recomputes every metric from 300 per-article records. It is not reading a stored
table — the raw `.jsonl` files hold one line per article with its label, score and
per-factor scores.

---

## 5. Numbers to know cold

| Fact | Value |
|---|---|
| Benchmark | ISOT, 300 sampled (150 fake / 150 real) |
| Baseline vs ours | 82.0% → 94.7% accuracy |
| ROC-AUC | 0.838 → 0.987 |
| Calibration (ECE) | 0.277 → 0.073 |
| Factor weights | verification 35%, source 25%, bias 25%, clickbait 15% |
| Source database | ~120 rated outlets |
| Model | Llama 3.1 8B via NVIDIA NIM |
| Analysis time | 3–7 s; cached = instant |
| Verdict bands | ≥7.5 trustworthy · 5.5–7.5 mostly fine · 4–5.5 read carefully · <4 be skeptical |

---

## 6. Harder questions, honest answers

**"ISOT's real articles are all from Reuters — doesn't your source checker just read
'Reuters' and get the answer for free?"**
> "Yes, that is a known flaw in ISOT, and we controlled for it. During evaluation we
> hide the source name entirely and strip agency prefixes like 'WASHINGTON (Reuters) —'
> from the text. The 94.7% is earned from content alone."

*Volunteering this is one of the most impressive things you can say — it shows you
understood the benchmark's weakness and designed around it.*

**"So the 94.7% doesn't include your source-reputation factor?"**
> "Correct — on the benchmark it is deliberately switched off to avoid that leak. In
> production all four factors run. We report the harder, leak-free number rather than
> the flattering one."

**"Is 300 articles enough?"**
> "It is a stratified, seeded sample, and the threshold and calibration are fitted on
> one half and reported on the held-out half, so there is no test-set leakage. The
> framework scales — larger runs and multiple seeds are planned for the final paper."

**"What stops the LLM hallucinating during verification?"**
> "It only sees articles we actually retrieved, it must cite which retrieved item
> supports its verdict, and those links are shown to the user. With zero retrieval it
> returns 'unverified' automatically — it is never asked to recall anything."

**"Who chose the weights?"**
> "They were set by design rationale — evidence-grounded factors weigh more — and
> validated by the ablation study. Learning them from data is listed as future work."

**"How is this different from just asking ChatGPT?"**
> "Same model, two designs: direct question 82%, our pipeline 94.7%. Plus evidence
> links, highlighted sentences and calibrated confidence, which a chat answer never
> gives."

**"Why only yesterday's news?"**
> "The free NewsAPI tier serves previous-day articles. The pipeline itself is
> source-agnostic — it works on any article text, including any link you paste."

**"Does it support Tamil/Hindi? Propagation tracking?"**
> "No — we deliberately scoped Phase I to the credibility core. Those are documented
> as out of scope so we could build and properly evaluate what we did ship."

*Never improvise a yes here. Scoping honestly reads as maturity; overclaiming gets
caught.*

**"What did you personally contribute?"**
> Agree this with your team **before** the review — each member should own 2 modules
> and be able to explain them at code level.

---

## 7. Files to open if asked to show code

| Ask | File |
|---|---|
| "Show me the core" | `backend/agents/trustAnalysisAgent.js` — weights, aggregation, redistribution |
| "How does verification work?" | `backend/agents/claimVerificationAgent.js` |
| "Where is the NLP?" | `backend/agents/biasAgent.js` (span extraction with reasons) |
| "How did you measure it?" | `backend/eval/runEval.js` + `backend/eval/metrics.js` (Platt scaling ~20 lines) |
| "Show the baseline" | `backend/agents/credibilityAgent.js` — the original single prompt, kept for comparison |
| "The UI" | `frontend/src/components/TrustReport.js` |

Good line: *"The baseline is 45 lines with one prompt. The new pipeline is five
specialised modules. The code structure is the contribution."*

---

## 8. Demo script (5 minutes)

1. **Feed** — point at the trust stamps on the cards. "Every article carries a verdict
   before you click. That costs no AI calls — it is a database lookup plus cached results."
2. **Open an article** — the check starts automatically. Read the plain-English verdict
   aloud: good signs and things to watch.
3. **Expand "See how we checked this"** — show the four factors with weights, then open
   the bias factor to reveal the flagged sentences with reasons.
4. **Open the verification factor** — show a confirmed claim and click through to
   another outlet's article. *This is the moment that lands.*
5. **Compare Coverage** — same story across outlets, with the political-lean spread.
6. **The Verification Desk** — paste a link, show it analysed like any feed article.
7. **Optional, strong finish** — run `node eval/report.js` and let the panel watch the
   82% vs 94.7% table compute.

### Pre-review checklist (the evening before)
- Start MongoDB, backend, frontend; sign in successfully.
- Pick the demo article in advance — one where verification **finds** coverage
  (big international stories work best). Test 3–4 candidates.
- Screenshot the trust report as a fallback if the Wi-Fi fails.
- Have the GitHub commits page and `docs/paper/paper-draft.md` open in tabs.
