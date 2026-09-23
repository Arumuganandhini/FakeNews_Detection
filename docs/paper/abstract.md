# Project Abstract

**Title**

Adversarially Asymmetric Evidence: A Calibrated Likelihood-Ratio Model for Fake
News Detection

**Team CO5** — Mugilan K S (23CSR138), Nandha Kumar S (23CSR140), Nandhini A (23CSR141)
**Guide** — Ms. M. Kannukkiniyal
Department of Computer Science and Engineering · Course 22CSP72, Project Work II

---

## 1. Abstract

Fake news detectors score articles on features the author of the article
chooses. Headline wording, emotional register, the presence of named sources,
the absence of clickbait — every one of these is set by whoever wrote the text,
and a detector that rewards them is a detector a competent fabricator can
satisfy on purpose. We measured this on our own earlier system: invented
articles written in plain newsroom register scored 7.3 out of 10, and four of
six deceptive items were presented to the reader as credible.

The underlying error is treating misinformation detection as ordinary
classification. In ordinary classification the features are drawn from nature.
Here an adversary controls them, and that changes what a feature is worth. We
formalise the consequence as an asymmetry: **an observation under the author's
control may incriminate an article but can never exonerate it**, because a
capable adversary can always produce the exonerating value. Detectors trained on
corpora of crude fabrications learn the opposite and do not notice, since such
corpora contain no competent fakes to contradict them.

The scoring model follows from this. Each observation contributes a likelihood
ratio — how much more often it occurs in fabricated than in genuine articles —
estimated from labelled data rather than assigned by hand, and accumulated as
additive log-odds in decibans. The output is P(fake news): a probability, which
unlike a 0–10 score refers to something outside the system and can be checked
against outcomes. Three properties follow directly from the arithmetic rather
than from special cases in the code. An uninformative observation has a ratio of
one and contributes exactly nothing. An observation nobody has measured
contributes nothing, instead of a number someone invented. And author-controlled
evidence is admitted one-sidedly, at every stage — including after calibration,
where we found the correction silently reversing the rule and restoring the
exculpatory weight it was meant to remove.

Measured on held-out ISOT data, with likelihood ratios estimated on a training
half only: accuracy rises from 0.888 to 0.954 against the hand-weighted rule
this replaces, expected calibration error where the system accuses falls from
0.229 to 0.127, and precision among flagged articles rises from 0.848 to 0.975.
Isotonic calibration reduces overall calibration error from 0.335 to 0.056 on
the content model. Two further results matter more than the headline figures.
The four content checks correlate at r = 0.78 and constitute **1.2 effective
independent factors of four**, so the previous design counted one piece of
evidence four times. And every residual calibration error in the shipped system
points in the direction of greater suspicion: the model never overstates
confidence in an article's favour.

On an adversarial set of fabrications written to read like ordinary reporting,
the old rule presented four of six as credible and the current model presents
none, while condemning none of the genuine articles. Corroboration is counted in
independent sources rather than articles — collapsing shared ownership, wire
syndication and near-duplicate reprints — and a deterministic rule set issues a
verdict with its grounds. Language is identified locally across fifteen
languages, claims are searched across language boundaries, and video, screenshot
and forwarded text are ingested with provenance. Every decisive step is
deterministic local code: the test suite and both benchmarks run with all
external keys removed.

**Keywords** — fake news detection, adversarial evidence, likelihood ratio,
weight of evidence, probability calibration, source independence, multilingual
fact verification

---

## 2. Base Paper

> **S. Amri, H.-C. Mputu Boleilanga, and E. Aïmeur, "ExFake: Towards an
> Explainable Fake News Detection Based on Content and Social Context
> Information," arXiv:2311.10784, Nov. 2023.**

ExFake judges an online post by fusing content, social-context signals (the
credibility and history of the users circulating it) and evidence from trusted
external entities, coupling the decision to an explainable-AI assistant for
ordinary readers. It matches this project on objective, on method — fusion of
heterogeneous signal families rather than one classifier — on external
grounding, and on audience.

Its fusion is additive and symmetric, which is the property we identify as
unsound under adversarial control and replace.

**Alternatives considered and rejected as the base.** *VeraCT Scan* [3] (2024)
already occupies the retrieval-and-justify ground, leaving a narrower delta.
*TELLER* [2] (Findings of ACL 2024) explains through logic rules rather than
retrieved evidence. *TRUST-VL* [6] (EMNLP 2025) is a vision-language model
trained on 198K samples; adopting it as the base would frame this project as an
under-resourced attempt at the same thing, whereas the contribution here is in
how evidence is weighed. Every comparative reference in Section 8 is from 2023
or later; the two pre-2020 entries are cited only as the provenance of standard
techniques.

---

## 3. The Defect

Additive scoring over author-controlled features fails in a direction that is
easy to miss and hard to repair by tuning.

| Observation | Set by the author? | Usable as exculpatory evidence? |
|---|---|---|
| Headline style | Yes | **No** |
| Neutral wording | Yes | **No** |
| Absence of persuasion techniques | Yes | **No** |
| Named sources, attributed quotes | **Yes — they can be invented** | **No** |
| Publisher's historical record | No — earned over years | Yes |
| Independent corroboration | No — requires other newsrooms | Yes |

Only the last two rows resist the author. The previous design weighted all of
them together and, when corroboration found nothing, redistributed its share
across the rest — so an absence of evidence increased the influence of precisely
the signals a fabricator controls. Measured on the adversarial set, this
produced a mean score of 7.3/10 for invented articles.

No choice of weights repairs it, because the fault is not in the magnitudes but
in admitting the evidence in both directions at all.

ISOT cannot expose this. Its fabrications are crude, so on that corpus polished
writing genuinely does predict a genuine article, and a detector that learns the
association scores well while being wide open to a competent fake. This is why
the project carries a second benchmark.

---

## 4. Points of Novelty

All six are implemented, tested and measured.

**N1 · Adversarial evidence asymmetry.** An observation the author controls is
admitted only in the incriminating direction: its likelihood ratio is clamped at
one on the exculpatory side, at every stage of the computation. This is the
central claim, and it is not a heuristic — it follows from the observation that a
capable adversary drives P(favourable | fabricated) toward P(favourable |
genuine), so the exculpatory ratio tends to one whatever a crude-fake corpus
says. We know of no fake-news system that applies it. The rule also has to
survive calibration: fitting a correction on labelled data silently reversed it
and handed back a large exculpatory weight, which our regression test now
prevents.

**N2 · Measured weights instead of chosen ones.** Every ratio is estimated from
labelled articles by `eval/estimateWeights.js`, stored with the counts that
produced it, shrunk to the conservative end of a 95% interval, and reported to
the reader in decibans. "Why 0.18?" is no longer a question the system has to
dodge. A factor with too little data to estimate — transparency, at n=18 —
contributes exactly zero rather than an invented weight.

**N3 · Correlation-aware combination.** The four content checks were treated as
four independent factors. Measured, they correlate at r = 0.78 and amount to 1.2
effective independent factors, so their summed weight is scaled accordingly.
Without this the same evidence was counted four times.

**N4 · An output that means something.** P(fake news) rather than a 0–10 score
with no referent. It is checkable — across articles scored 0.7, about seventy
per cent should be fabricated — and we check it, reporting calibration error
separately for the accusing and exonerating directions, because a single figure
conceals the trade the asymmetry makes.

**N5 · Independence-aware corroboration.** Counting articles overstates
corroboration, often tenfold. A curated ownership model of 70 media groups,
agency-syndication detection and near-duplicate collapse reduce retrieved
coverage to the sources it actually represents, and every merge is reported with
its reason. A deterministic relevance gate additionally discards retrieved
coverage that shares no anchor — place, name or number — with the claim, after
the model has spoken: on the adversarial set the model had reported an invented
chemical leak as *supported* by real coverage of an unrelated evacuation.

**N6 · The decisive logic is local and deterministic.** Likelihood ratios,
independence, calibration, verdict rules and language identification contain no
model call. The language model extracts claims and judges stance over retrieved
text: a sensor, not the judge. The suite (76 tests) and both benchmarks run with
every API key removed.

---

## 5. What the System Does Not Claim

- **It cannot certify truth.** *Corroborated* means independent outlets report
  the same facts — the strongest evidence available without primary
  investigation, and not proof.
- **It abstains, and says so.** *Unverified* is a first-class outcome. Most
  claims outside major news land there.
- **Its probability is calibrated on ISOT, not in deployment.** The priors and
  corroboration rates are declared parameters, stated with their justification
  and reported as declared in every analysis. They are measurable and the
  scripts exist; until run, the system says which numbers rest on assumption.
- **It does not perform synthetic-media forensics.** A separate problem; the
  architecture admits such a detector as another factor.

---

## 6. Evaluation

Likelihood ratios are estimated on a training half; every figure comes from the
held-out half. The split is a hash of the article id, so runs are reproducible.

### 6.1 Against the rule it replaces

n = 829 held-out ISOT articles, content factors only (source identity is hidden
on this corpus and historical articles have no live coverage).

| | Accuracy | ROC-AUC | ECE when accusing | Precision when accusing |
|---|---|---|---|---|
| Legacy hand-weighted sum | 0.888 | 0.970 | 0.229 | 0.848 |
| **Weight of evidence (shipped)** | **0.954** | 0.957 | **0.127** | **0.975** |

Calibration of the content model, before and after isotonic regression fitted on
the training half: **ECE 0.335 → 0.056**.

### 6.2 The cost of the asymmetry, stated plainly

Turning the clamp off raises ROC-AUC from 0.957 to 0.978 on ISOT. That gain is
real and it is a trap: it comes from learning that polished prose indicates a
genuine article, which holds on a corpus of crude fakes and fails against a
competent one. We report both and ship the clamp.

The clamp also costs calibration on the exonerating side, which is what raises
overall ECE from 0.056 to 0.285 in the shipped configuration: the system refuses
to become confident that a well-written article is genuine. Every residual error
points toward more suspicion, never less — it never overstates confidence in an
article's favour.

### 6.3 Adversarial set

Ten items: five fabrications in plain newsroom register, one high-impact
fabrication, two genuine reports, one satire, one commentary. Each scored twice
from identical factor outputs.

| Measure | Legacy | Current |
|---|---|---|
| Deceptive items presented as credible | 4 / 6 | **0 / 6** |
| Verdict matched expectation | — | **6 / 6** |
| Genuine articles wrongly condemned | — | **0 / 2** |
| Mean legacy score of the fabrications | **7.3 / 10** | (unchanged — the point) |

The fabrications still read well, and always will. What changed is that reading
well no longer determines the answer.

### 6.4 Status of the older ISOT figure

The 94.7% / 82.0% comparison came from a four-factor configuration on a model
since withdrawn by its provider. It is retained as the measurement that
motivated the architecture, not as a claim about the current system.

---

## 7. Reproducing It

```bash
cd backend
npm test                          # 76 tests, no API keys required
node eval/estimateWeights.js      # measure the likelihood ratios
node eval/validateScoring.js      # held-out comparison against the old rule
node eval/validateScoring.js --no-clamp   # the asymmetry ablation
node eval/adversarialBench.js --no-model  # well-written fabrications
```

---

## 8. References

### Primary and comparative work (2023–2026)

[1] S. Amri, H.-C. Mputu Boleilanga, and E. Aïmeur, "ExFake: Towards an
Explainable Fake News Detection Based on Content and Social Context Information,"
arXiv:2311.10784, 2023. **(Base paper)**

[2] H. Liu, W. Wang, H. Li, and H. Li, "TELLER: A Trustworthy Framework for
Explainable, Generalizable and Controllable Fake News Detection," in *Findings of
the Association for Computational Linguistics: ACL 2024*, 2024.

[3] C. Niu, Y. Guan, Y. Wu, J. Zhu, J. Song, R. Zhong, K. Zhu, S. Xu, S. Diao,
and T. Zhang, "VeraCT Scan: Retrieval-Augmented Fake News Detection with
Justifiable Reasoning," arXiv:2406.10289, 2024.

[4] B. Wang, J. Ma, H. Lin, Z. Yang, R. Yang, Y. Tian, and Y. Chang, "Explainable
Fake News Detection with Large Language Model via Defense Among Competing
Wisdom," in *Proc. ACM Web Conference (WWW)*, 2024.

[5] I. Vykopal, M. Pikuliak, S. Ostermann, and M. Šimko, "Generative Large
Language Models in Automated Fact-Checking: A Survey," arXiv:2407.02351, 2024.

[6] Z. Yan, P. Qi, W. Hsu, and M.-L. Lee, "TRUST-VL: An Explainable News
Assistant for General Multimodal Misinformation Detection," in *Proc. 2025 Conf.
Empirical Methods in Natural Language Processing (EMNLP)*, 2025.

[7] K. Xuan, L. Yi, F. Yang, R. Wu, Y. R. Fung, and H. Ji, "LEMMA: Towards
LVLM-Enhanced Multimodal Misinformation Detection with External Knowledge
Augmentation," arXiv:2402.11943, 2024.

[8] J. Piskorski, N. Stefanovitch, G. Da San Martino, and P. Nakov,
"SemEval-2023 Task 3: Detecting the Category, the Framing, and the Persuasion
Techniques in Online News in a Multi-lingual Setup," in *Proc. 17th Int. Workshop
on Semantic Evaluation (SemEval-2023)*, 2023, pp. 2343–2361.

[9] D. Yang, "Calibrated Selective Fact-Checking via Evidence Chain Evaluation,"
arXiv:2607.18240, 2026.

### Dataset

[10] H. Ahmed, I. Traore, and S. Saad, "Detection of Online Fake News Using N-Gram
Analysis and Machine Learning Techniques," in *Proc. Int. Conf. Intelligent,
Secure, and Dependable Systems in Distributed and Cloud Environments*, 2017,
pp. 127–138. *(Source of the ISOT corpus, not comparative work.)*

### Methodological foundations

[11] I. J. Good, *Probability and the Weighing of Evidence*. London: Charles
Griffin, 1950. *(Weight of evidence in decibans.)*

[12] C. Guo, G. Pleiss, Y. Sun, and K. Q. Weinberger, "On Calibration of Modern
Neural Networks," in *Proc. 34th Int. Conf. Machine Learning (ICML)*, 2017,
pp. 1321–1330.

[13] B. Zadrozny and C. Elkan, "Transforming Classifier Scores into Accurate
Multiclass Probability Estimates," in *Proc. 8th ACM SIGKDD Int. Conf. Knowledge
Discovery and Data Mining*, 2002, pp. 694–699. *(Isotonic calibration.)*

---

## Appendix A — Short Abstract (150 words)

Fake news detectors score articles on features their authors choose: headline
wording, tone, the presence of named sources. A competent fabricator supplies
all of them, so such systems reward skilled deception — our earlier pipeline
rated invented articles 7.3 out of 10. We identify the cause as treating
adversarial detection as ordinary classification, and formalise the correction:
an observation under the author's control may incriminate an article but can
never exonerate it. Each observation contributes a likelihood ratio estimated
from labelled data rather than a hand-chosen weight, accumulated as additive
log-odds, yielding a calibrated probability rather than an arbitrary score. On
held-out data, accuracy rises from 0.888 to 0.954, precision when accusing from
0.848 to 0.975, and calibration error from 0.229 to 0.127. The four content
checks prove to be 1.2 effective independent factors, not four. On well-written
fabrications, zero of six now read as credible.
