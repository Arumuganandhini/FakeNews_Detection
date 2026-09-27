# Measured results

Every figure here comes from a script in `backend/eval/` that can be re-run.
The command that produces each table is given with it. Nothing in this file is
an estimate or a target.

Measured on 2026-09-28. Machine: Windows 11, 28 logical cores, 15.7 GB RAM,
NVIDIA RTX 5050 Laptop GPU with 8 GB VRAM. Local model `llama3.1:8b` (4.92 GB)
served by Ollama 0.34.4. Hosted providers: NVIDIA NIM
(`nvidia/nemotron-3-super-120b-a12b`) and Google Gemini
(`gemini-3.1-flash-lite`).

---

## 1. Which provider runs which model task

```
node eval/benchmarkProviders.js --runs 3 --write
```

Ten model calls, three runs each, on fixed inputs, with the environment pinned
per provider so a failing local model cannot fall through to a hosted one and
be recorded as a local success.

**Valid** means the reply parsed and carried the keys the caller cannot proceed
without; a content check that fell back to the pattern matcher counts as
invalid. **Correct** is reported only for tasks with a known right answer.
**Drift** is the mean absolute difference from the NIM reference on the 0–10
scale the content factors use.

| Task | ollama | NIM | Gemini | drift | routed to |
|---|---|---|---|---|---|
| clickbait | 100%, 1.8 s | 100%, 4.4 s | 100%, 3.0 s | 0.17 | ollama |
| bias | 100%, 4.4 s | 67%, 8.0 s | 100%, 10.4 s | 0 | ollama |
| manipulation | 100%, 3.5 s | 100%, 11.3 s | 100%, 39.5 s | 0 | ollama |
| transparency | 100%, 1.9 s | 100%, 7.7 s | 100%, 9.2 s | 2.0 | ollama |
| summary | 100%, 0.7 s | 100%, 4.2 s | 100%, 3.3 s | — | ollama |
| detailed summary | 100%, 0.9 s | 67%, 9.0 s | 100%, 5.3 s | — | ollama |
| claim extraction | 100%, 1.6 s | 67%, 39.2 s | 33%, 25.1 s | — | ollama |
| coverage keywords | 100%, 0.3 s | 100%, 5.4 s | 100%, 3.4 s | — | ollama |
| stance judgement | 100%, 1.0 s, **correct 100%** | 100%, 3.3 s, correct 100% | 100%, 1.7 s, correct 100% | — | ollama |
| **premise check** | 100%, 2.4 s, **correct 0%** | 100%, 10.9 s, correct 100% | 100%, 10.8 s, correct 100% | — | **NIM** |

**Local model leads on 9 of 10 tasks.** Latency is 3× to 20× lower, and on
claim extraction the hosted providers were the unreliable ones (67% and 33%
valid against 100%).

### The exception, and why the gate exists

The premise check is the one task the local model cannot do. Asked whether an
article calling Rahul Gandhi "Prime Minister" conflicts with his encyclopedia
entry, `llama3.1:8b` returns well-formed JSON, in 2.4 seconds, reporting no
conflict — three times out of three. Both hosted models report the conflict and
quote the line that settles it: *"the 12th leader of the Opposition in Lok
Sabha"*.

An earlier version of this benchmark measured only whether a reply parsed. By
that measure the local model won this task outright, and routing it there would
have silently disabled the premise channel, which exists precisely to catch the
case it had just missed. A task with a known right answer must now get it right
in at least 80% of runs to be routed locally.

### Thresholds

| Gate | Value |
|---|---|
| Minimum valid-reply rate for local routing | 0.80 |
| Minimum correctness, where a known answer exists | 0.80 |
| Maximum score drift from the hosted reference | 2.0 |

Transparency sits exactly on the drift limit (local 10, hosted 8). It is routed
locally, and it is the decision in this table most likely to change on a larger
sample.

---

## 2. End-to-end functional check

```
node eval/functionalCheck.js
```

Cases whose correct answer is known in advance. Written to
`eval/results/functional.json`.

| Case | Verdict | Rule fired | Time |
|---|---|---|---|
| Corroborated event | REAL | corroborated-by-multiple-independent-sources | 25.9 s |
| Fabricated event | CANNOT VERIFY | no-independent-coverage | 18.5 s |
| False premise | **FAKE** | **premise-contradicted-by-reference** | 14.6 s |
| Well-written fabrication | CANNOT VERIFY | no-independent-coverage | 15.7 s |

**4 of 4 correct. Median analysis 18.5 s. No check degraded.**

The false-premise row is the one that changed when the routing was installed.
Before it, the same case returned CANNOT VERIFY by `no-independent-coverage` —
the right verdict reached for the wrong reason, with the premise channel
contributing nothing.

The well-written fabrication is the case the whole design exists for: calm
prose, named sources, no clickbait, describing an event that never happened. It
does not reach a positive verdict.

---

## 3. Deterministic components

No network and no model. Same command as above.

| Component | Result |
|---|---|
| Admissibility gate | 4/4 — unfalsifiable, question, too-short, checkable claim |
| Language detection | 4/4 — English, Tamil, Kannada, Hindi |
| Source reputation | Associated Press 9.5/10 matched; unknown outlet correctly unmatched |

---

## 4. Network operations

These address external services and are not model calls. Which model answers
has no bearing on them.

| Operation | Result |
|---|---|
| News index query | 8 articles from 4 distinct outlets, 0.4–0.7 s |
| Article page fetch | 2,000–6,000 characters against the feed's ~200 |
| Reference lookup | resolves named subjects, 2.4–10.9 s including judgement |

---

## 4a. Adversarial benchmark

```
node eval/adversarialBench.js --no-model   # deterministic analysers only
node eval/adversarialBench.js              # deployed configuration
```

Ten written items: five fabrications in plain newsroom register, one
high-impact fabrication carrying manipulation signals, two genuine reports, one
satirical piece, one commentary. Each scored twice from identical factor
outputs — once under the legacy additive rule, once under the current one.

The two configurations give different answers and both belong in the record.

| | deterministic | deployed, with live corroboration |
|---|---|---|
| Deceptive items read as credible | 4/6 → **0/6** | 4/6 → **1/6** |
| Verdict matched expectation | **6/6** | 5/6 |
| Genuine articles wrongly condemned | **0/2** | 1/2 |
| Legacy mean score of the fabrications | 7.3/10 | 7.1/10 |

The deterministic row is reproducible on any machine with no network and no
model. The deployed row was measured once, and both of its failures were
diagnosed:

**The genuine article condemned (`real-02`)** quotes a council transport
secretary named Meera Krishnan. The reference lookup resolved that name to the
encyclopedia entry for Meera Krishnan the Indian actress and reported the
conflict it had been asked to find: the article says transport secretary, the
entry says actress. Both true, about different people. The judge is now asked
whether the entry is about the same subject before a contradiction is admitted,
and the case is covered by a regression test. Verified directly — that article
now returns `consistent`, while "Prime Minister Rahul Gandhi" remains
`contradicted`.

**The fabrication read as credible (`fab-04`)** is an invented "secret chemical
leak forces overnight evacuation of three districts", and the corroboration
channel returned `corroborated-by-multiple-independent-sources`. The item is
written without a single proper noun, so the retrieved coverage was about some
other chemical incident. The relevance gate in `agents/evidenceRelevance.js`
exists to discard coverage sharing no anchor with the claim and did not discard
this. **This is unfixed.**

**The deployed row has not been re-measured since the name-collision fix.** The
NewsAPI developer quota — 100 requests in 24 hours — was exhausted by the day's
measurement, and a run without corroboration reports `verification-unavailable`
for most items, which produces a clean-looking 0/6 and 6/6 that is an artefact
of abstention rather than evidence. Those numbers are not reported here. The
run should be repeated once quota resets.

One thing that did hold under quota exhaustion: every affected item reported
`verification-unavailable`, not "no other outlet is reporting this". A search
that could not run is not a finding of absence.

---

## 4b. What the one-sided rule costs

```
node eval/validateScoring.js --clean-only
node eval/validateScoring.js --clean-only --no-clamp
```

Isotonic-calibrated figures on the same 120 held-out articles.

| | clamp enforced | clamp disabled |
|---|---|---|
| Accuracy | 0.950 | 0.958 |
| ROC-AUC | 0.957 | 0.983 |
| ECE where accusing | **0.013** | 0.039 |

The clamp costs 0.026 AUC and one article of accuracy, and buys a threefold
reduction in calibration error where the system accuses. The discrimination
given up comes from learning that fluent prose indicates a genuine article,
which holds on a corpus of crude fabrications and fails against a careful one.

---

## 4c. Latency and degradation

Measured over HTTP against the running backend, local model warm.

| | measured |
|---|---|
| Cold analysis, one article | 27.2 s (functional-check median 18.5 s) |
| Cached analysis, same URL | **2.7 – 3.4 ms** |
| First check visible to the reader | **1.47 s** |
| Full six-check stream | 9.2 s on a short article |

With nothing reachable — no model, no local runtime, no news index — the
deterministic analysers alone still separate the cases:

| Article | Writing score | Factors degraded |
|---|---|---|
| Fabricated, loaded language, unattributable sourcing | **3.5 / 10** | 4, all marked |
| Ordinary attributed reporting | **8.5 / 10** | 4, all marked |

---

## 5. Scoring model, held out

```
node eval/estimateWeights.js --clean-only
node eval/validateScoring.js --clean-only
```

239 ISOT articles whose measurement channel is recorded; 119 train, 120 test.

| Model | Accuracy | AUC | ECE | ECE accusing | Brier |
|---|---|---|---|---|---|
| Legacy hand-weighted sum | 0.958 | 0.978 | 0.237 | 0.267 | 0.101 |
| Weight of evidence, raw | 0.950 | 0.973 | 0.308 | 0.257 | 0.142 |
| Weight of evidence, isotonic | 0.950 | 0.957 | 0.028 | **0.013** | 0.048 |

The accuracy difference is one article — 114 correct against 115. The separation
is in calibration where the system accuses: **0.267 to 0.013, a factor of
twenty**, with the Brier score halved.

Style factors correlate at mean r = 0.55, giving 1.52 effective independent
factors of four. The strongest pair, headline quality and language, correlates
at 0.93.

---

## 6. Test suite

```
npm test           # backend
CI=true npx react-scripts test --watchAll=false   # frontend
```

| Suite | Result |
|---|---|
| Backend | 129 / 129 |
| Frontend | 14 / 14 |

`test/pipeline.nomodel.test.js` runs the whole pipeline with every model and
the news index unreachable, which is what establishes that the contribution is
the method rather than the API.

---

## Reproducing

All figures depend on `backend/.env` carrying `OLLAMA_HOST`, `OLLAMA_MODEL` and
at least one hosted key. The routing table at `backend/data/taskRouting.json`
records the measurements behind each decision and its own generation date; a
system with different hardware or a different local model should re-run
`benchmarkProviders.js` rather than inherit this one.
