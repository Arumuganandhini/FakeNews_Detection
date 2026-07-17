// backend/eval/report.js
// Aggregates one or more result files from runEval.js into the metrics tables
// used in the paper: classification quality, ranking quality (ROC-AUC), the
// ablation comparison, and calibration (ECE + reliability-diagram bins).
//
// Usage:
//   node eval/report.js                 # report on every file in eval/results/
//   node eval/report.js results/x.jsonl # report on specific file(s)
const fs = require('fs');
const path = require('path');
const { classificationMetrics, rocAuc, bestThreshold, calibration, plattFit } = require('./metrics');

function loadResults(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));
}

function report(file) {
  const items = loadResults(file);
  if (items.length < 4) {
    console.log(`\n${path.basename(file)}: only ${items.length} items — skipping.`);
    return null;
  }

  // Split half/half (by even/odd position) so the decision threshold is tuned
  // on one half and reported on the other — no test-set leakage.
  const val = items.filter((_, i) => i % 2 === 0);
  const test = items.filter((_, i) => i % 2 === 1);
  const threshold = bestThreshold(val);
  const m = classificationMetrics(test, threshold);
  const auc = rocAuc(items);
  // Calibration: raw scores vs Platt-scaled probabilities. The scaling is
  // fitted on the validation half only and evaluated on the test half.
  const rawCal = calibration(test);
  const platt = plattFit(val);
  const scaledCal = calibration(test, 10, it => platt.apply(it.score));

  const name = path.basename(file).replace('.jsonl', '');
  console.log(`\n=== ${name} ===`);
  console.log(`items: ${items.length} (val ${val.length} / test ${test.length}), threshold: ${threshold}`);
  console.log(`accuracy:  ${(m.accuracy * 100).toFixed(1)}%`);
  console.log(`precision: ${(m.precision * 100).toFixed(1)}%  recall: ${(m.recall * 100).toFixed(1)}%  F1(real): ${(m.f1 * 100).toFixed(1)}%`);
  console.log(`macro-F1:  ${(m.macroF1 * 100).toFixed(1)}%   ROC-AUC: ${auc === null ? 'n/a' : auc.toFixed(3)}`);
  console.log(`ECE raw:   ${rawCal.ece}  ->  Platt-calibrated: ${scaledCal.ece}  (< 0.1 is well calibrated)`);
  console.log(`confusion: TP ${m.confusion.tp} TN ${m.confusion.tn} FP ${m.confusion.fp} FN ${m.confusion.fn}`);
  return {
    name, n: items.length, threshold, ...m, auc,
    ece: rawCal.ece, eceCalibrated: scaledCal.ece,
    platt: { a: platt.a, b: platt.b },
    calibrationBins: rawCal.bins, calibrationBinsScaled: scaledCal.bins
  };
}

function main() {
  let files = process.argv.slice(2);
  if (!files.length) {
    const dir = path.join(__dirname, 'results');
    if (!fs.existsSync(dir)) { console.error('No results directory yet — run runEval.js first.'); process.exit(1); }
    files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f));
  }
  const summaries = files.map(report).filter(Boolean);

  if (summaries.length > 1) {
    console.log('\n=== Ablation comparison (paper table) ===');
    console.log('| Configuration | N | Accuracy | Macro-F1 | ROC-AUC | ECE raw | ECE calibrated |');
    console.log('|---|---|---|---|---|---|---|');
    for (const s of summaries) {
      console.log(`| ${s.name} | ${s.n} | ${(s.accuracy * 100).toFixed(1)}% | ${(s.macroF1 * 100).toFixed(1)}% | ${s.auc === null ? 'n/a' : s.auc.toFixed(3)} | ${s.ece} | ${s.eceCalibrated} |`);
    }
  }

  // Reliability-diagram data for the calibration figure.
  const outFile = path.join(__dirname, 'results', 'summary.json');
  fs.writeFileSync(outFile, JSON.stringify(summaries, null, 2));
  console.log(`\nFull summary (incl. calibration bins) written to ${outFile}`);
}

main();
