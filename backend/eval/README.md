# Evaluation framework

Measures the trust-analysis pipeline on labeled fake/real news datasets, and
produces the numbers the paper needs: accuracy, macro-F1, ROC-AUC, an ablation
table, and calibration (ECE).

## Dataset format

A CSV with a header row and columns `title,text,label` (label: `1` = real,
`0` = fake). Place files under `eval/data/`.

Recommended: the ISOT Fake News dataset (~44k articles). Two known pitfalls
this harness handles automatically:

- **Source leak:** all ISOT real articles come from Reuters, so the source
  name gives the label away. The runner hides the source from the pipeline
  by default (`--show-source` to disable).
- **Agency-prefix leak:** real articles begin with `CITY (Reuters) -`. The
  runner strips agency prefixes before analysis.

## Running

```bash
cd backend
# Main result (content factors; verification off for historical articles)
node eval/runEval.js --data eval/data/isot.csv --config full --sample 100

# Ablations
node eval/runEval.js --data eval/data/isot.csv --config no-bias --sample 100
node eval/runEval.js --data eval/data/isot.csv --config no-clickbait --sample 100

# Baseline: the original single-prompt credibility agent
node eval/runEval.js --data eval/data/isot.csv --config baseline --sample 100

# Metrics + ablation table
node eval/report.js
```

Runs are resumable — re-running the same command skips finished articles.
Sampling is stratified (half real / half fake) and seeded, so every config
evaluates the identical article set.

The decision threshold is tuned on one half of the results and metrics are
reported on the other half (no test-set leakage).

## Why verification is off for dataset runs

Cross-source verification searches *live* news coverage. Historical dataset
articles (ISOT is 2016-2017) have no live coverage to corroborate, so the
factor would always return "unverified" and its weight is redistributed —
identical to production behavior. Report verification quality separately
with a small live-news study (`--config full+verify` on current articles).

## Cost / time

Each article uses 2 LLM calls (clickbait + bias); the baseline uses 1.
At the default 30 requests/min budget, 100 articles ≈ 8-10 minutes per config.
