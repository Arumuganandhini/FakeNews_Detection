# An Explainable Multi-Factor Pipeline for News Trust Assessment with Calibrated Scores

> Working draft skeleton. Numbers marked *(n=100, preliminary)* will be replaced
> by the n=300 run; sections marked TODO need prose from the team.
> Authors: Mugilan K S, Nandha Kumar S, Nandhini A — Guide: Ms. M. Kannukkiniyal

## Abstract (draft)

Most automated fake-news systems output a binary fake/real label from an opaque
classifier, offering users no reason to trust the judgment. We present an
explainable trust-assessment pipeline that decomposes credibility into
independent, human-inspectable factors — source reputation, headline
(clickbait) quality, biased/emotional language, and cross-source claim
verification — and combines them into a transparent weighted trust score with
per-factor evidence (flagged sentences, matched source ratings, and links to
corroborating coverage from independent outlets). On the ISOT benchmark, with
source-identity leakage explicitly controlled, the content-based pipeline
achieves 92.0% accuracy and 0.993 ROC-AUC *(n=100, preliminary)*, outperforming
a single-prompt LLM baseline (84.0%, 0.883). We further show that a
one-parameter-pair Platt scaling step reduces expected calibration error from
0.273 to 0.054, yielding trust scores that are not only accurate but honest
about their own confidence. The system runs on live news in a deployed web
application.

## 1. Introduction

- Misinformation problem; users need *reasons*, not labels. (TODO: prose)
- Limitations of binary fake/real classifiers (cite survey rows from Phase I).
- Contributions (keep this list explicit in the paper):
  1. An explainable multi-factor trust pipeline over live news, with
     per-factor evidence shown to the user.
  2. Evidence-grounded cross-source verification: claims are checked against
     retrieval from independent outlets; the LLM performs only claim
     extraction and stance judgment over retrieved evidence, never verifies
     from parametric memory, and abstains ("unverified", weight redistributed)
     when no coverage exists.
  3. A leakage-controlled evaluation on ISOT with an ablation study against a
     single-prompt LLM baseline.
  4. Calibrated trust scores via Platt scaling, with reported ECE — rarely
     provided in fake-news systems.

## 2. Related Work

TODO: expand the Phase I literature survey rows into paragraphs
(ExFake 2023; Muñoz et al. 2024; Wang et al. 2024 defense-among-competing-wisdom;
Jadhav et al. 2025). Position: prior work is classification-centric; ours is
assessment-centric (score + evidence + calibration), and modular rather than
end-to-end.

## 3. System Architecture

Figure 1: pipeline diagram (TODO: draw — article → 4 parallel factors →
weighted aggregation → trust report UI).

- **Source reputation** (weight 0.25): curated database of ~120 outlets with
  factual-reporting ratings and editorial lean; fuzzy name/domain matching.
- **Headline quality** (0.15): LLM structured scoring of clickbait signals.
- **Neutral language** (0.25): LLM flags specific sentences with bias type
  (sensationalism, one-sided reporting, emotional manipulation) and reason —
  these are surfaced verbatim in the UI.
- **Cross-source verification** (0.35): claim extraction → NewsAPI retrieval
  from independent outlets (article's own source excluded) → stance judgment
  per claim over the retrieved evidence with cited items → verdict
  supported / contradicted / unverified.
- **Aggregation**: fixed weights; when verification is uninformative its
  weight is redistributed proportionally (the system never pretends to
  verify). Verdict bands map score to user-facing labels.
- Implementation: Node/Express + React; LLM = llama-3.1-8b-instruct via
  NVIDIA NIM; MongoDB. (Model is swappable; prompts in appendix.)

## 4. Evaluation Methodology

- Dataset: ISOT (43,294 usable articles after length filtering; 21,915 fake /
  21,379 real).
- **Leakage control** (emphasize — this is a methodological contribution):
  (a) all ISOT real articles originate from Reuters, so source identity is
  hidden from the pipeline during evaluation; (b) agency prefixes
  ("CITY (Reuters) –") are stripped from article text.
- Stratified seeded sampling; identical article set across all configurations.
- Threshold and Platt parameters fitted on a validation half; all reported
  metrics from the held-out test half.
- Verification factor disabled for dataset runs (historical articles have no
  live coverage; production behavior — weight redistribution — is identical).
  Verification evaluated separately in §5.3.
- Metrics: accuracy, macro-F1, ROC-AUC, ECE (10-bin).
- Baseline: the original single-prompt credibility agent (same LLM, one
  holistic prompt), representing the "LLM black box" approach.

## 5. Results

### 5.1 Main results and ablation *(n=100, preliminary — replace with n=300)*

| Configuration | Accuracy | Macro-F1 | ROC-AUC | ECE raw | ECE calibrated |
|---|---|---|---|---|---|
| Single-prompt baseline | 84.0% | 84.0% | 0.883 | 0.242 | 0.119 |
| Full pipeline (clickbait + bias) | **92.0%** | **92.0%** | **0.993** | 0.273 | **0.054** |
| Ablation: clickbait only | 92.0% | 92.0% | 0.986 | — | — |
| Ablation: bias only | 92.0% | 92.0% | 0.942 | — | — |

Talking points (TODO: prose):
- Pipeline beats baseline by +8 accuracy points and +0.11 AUC.
- Both factors contribute; combination is best (AUC ordering 0.942 < 0.986 < 0.993).
- Accuracy ties across ablations at this sample size; AUC discriminates.

### 5.2 Calibration

- Raw scores rank well but cluster mid-range → ECE 0.273.
- Platt scaling (fitted on validation half) → ECE 0.054: a "70% trust" score
  now means ≈70% empirical probability of being real.
- Figure 2: reliability diagram before/after (data in
  `backend/eval/results/summary.json`, `calibrationBins` /
  `calibrationBinsScaled`).

### 5.3 Cross-source verification (live-news study)

TODO: small study on current articles (e.g., 30 claims, manual annotation of
verdict correctness). Report: coverage rate, verdict precision, and an example
walkthrough (claim → retrieved outlets → cited stance → verdict).

### 5.4 Qualitative examples

TODO: 2–3 trust reports (one reliable article, one fake, one mixed) with the
flagged sentences and factor breakdown as figures/screenshots.

## 6. Discussion and Limitations

- ISOT is 2016–2017 US political news; distribution shift to current news is
  unmeasured (mitigated partly by the live deployment).
- Stance judgment reads headlines/descriptions, not full bodies; an NLI model
  is a drop-in upgrade (future work).
- LLM-based factors inherit model biases; low temperature + structured output
  mitigate variance but not bias.
- Single dataset, single LLM; n=300 and multi-seed runs address sample noise.

## 7. Conclusion

TODO after final numbers.

## References

TODO: carry over from Phase I deck ([1]–[4]) plus ISOT dataset citation
(Ahmed, Traore, Saad 2017/2018), Platt (1999), calibration ECE
(Guo et al. 2017), NewsAPI.

---

### Reproducibility appendix (keep in repo even if cut from paper)

```bash
cd backend
node eval/prepareIsot.js
node eval/runEval.js --data eval/data/isot.csv --config content-only --sample 300
node eval/runEval.js --data eval/data/isot.csv --config no-bias      --sample 300
node eval/runEval.js --data eval/data/isot.csv --config no-clickbait --sample 300
node eval/runEval.js --data eval/data/isot.csv --config baseline     --sample 300
node eval/report.js
```
Seed 42; identical stratified sample across configs; results JSONL per article.
