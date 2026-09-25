# Adversarially Asymmetric Evidence for Calibrated Fake News Detection

**Mugilan K S (23CSR138), Nandha Kumar S (23CSR140), Nandhini A (23CSR141)**
Guide: Ms. M. Kannukkiniyal
Department of Computer Science and Engineering
Course: 22CSP72 — Project Work II

---

## Abstract

*Automated fake-news detection scores how an article is written: its tone, its
headline, whether it names sources. Every such signal is chosen by whoever
wrote it, so a fabrication in newsroom register scores as a genuine report. On a weighted-sum pipeline of this kind we measured invented articles at
7.3 of 10, four of six deceptive items reading as credible, and the failure was
systematic: when corroboration was absent the verification term redistributed
its weight onto the signals an author controls. We attribute this to treating
adversarial detection as ordinary classification. Where features are selected
by an adversary rather than drawn from nature, an asymmetry follows, stated
here as an admissibility rule: an observation under the author's control may
count against an article, never in its favour. We build a scoring model on that
rule. Each observation contributes a likelihood ratio estimated from labelled
articles rather than a hand-assigned weight, and the ratios accumulate as
additive log-odds into a calibrated probability. Support is admitted only from
outside the author's control: corroboration counted in independent sources
rather than retrieved articles, and premises checked against a reference work.
Input carrying no verifiable claim is declined rather than scored. On a
held-out split of 120 articles the model matches the rule it replaces on
accuracy — 114 correct against 115 — and ranks slightly worse, while
calibration error where the system accuses falls twentyfold, from 0.267 to
0.013. The trade is deliberate: the discrimination given up is supplied by
evidence an adversary controls.*

**Index Terms** — Adversarial evidence, fake news detection, likelihood ratio,
probability calibration, selective prediction, source independence, weight of
evidence.

---

## 1. Introduction

The volume of news reaching a reader now exceeds any individual's capacity to
verify it. Automated assistance is therefore attractive, and a large body of
work addresses it — but almost all of that work is framed as *classification*:
given an article, output "fake" or "real".

Classification is the wrong output for this problem, for three reasons.

**A label carries no reason.** A reader told that an article is 87% likely to be
fake learns nothing they can act on, check, or disagree with. The judgment is
unfalsifiable from the reader's position, which is precisely the epistemic
situation misinformation already puts them in.

**A label hides which evidence it rests on.** An article may be untrustworthy
because its outlet has a poor record, because its headline oversells its
content, because it leans on unattributable authority, or because other outlets
report the facts differently. These are different problems requiring different
reader responses, and a single score conflates them.

**Confidence is usually dishonest.** Guo et al. [6] showed that modern neural
classifiers are systematically overconfident: a model reporting 90% confidence
may be correct only 60% of the time. Calibration is rarely reported in
misinformation systems, so a stated confidence generally cannot be interpreted
as a probability.

We take an *assessment* view instead of a classification view, and separate two
questions that a single score conflates. Whether a story holds up is answered by
a verdict with its grounds; how well it is written is reported alongside, and
never mixed into it. A well-written fabrication should read as exactly that —
well written, and unsupported — rather than averaging to something reassuring.

### 1.1 Contributions

1. **An admissibility rule for adversarial evidence.** Observations under the
   author's control are admitted only in the incriminating direction, at every
   stage of the computation including after calibration. Section 7.2 reports
   what the rule costs and why the cost is worth paying; Section 4.3 states it
   formally.
2. **Measured weights in place of assigned ones.** Every likelihood ratio is
   estimated from labelled articles, shrunk to the conservative end of a 95%
   interval, and stored with the counts that produced it. A factor with too
   little data to estimate contributes exactly zero and is named as such in the
   report, rather than receiving an invented weight.
3. **Correlation-aware combination.** The content checks correlate at a mean
   r = 0.55 and amount to 1.52 effective independent factors of four — the
   strongest pair, headline quality and language, at r = 0.93 — so their summed
   weight is scaled accordingly, where the previous design counted one piece of
   evidence four times.
4. **Independence-aware corroboration.** Retrieved coverage is reduced to the
   sources it actually represents by a curated ownership model, agency-syndication
   detection and near-duplicate collapse, with every merge reported to the reader.
   A deterministic relevance gate additionally discards retrieved coverage sharing
   no anchor with the claim, after the model has spoken.
5. **Premise verification separate from event verification.** A news index cannot
   adjudicate a claim resting on a false premise, because the invented event is
   reported nowhere; a reference work settles it in one lookup (Section 4.4).
6. **An input admissibility gate.** Content carrying no verifiable claim receives
   no verdict, only a statement of what would make it checkable — a system that
   answers questions it cannot answer teaches readers to distrust the answers it
   gets right.
7. **A leakage-controlled held-out evaluation** against the rule this replaces,
   with calibration reported separately for the accusing and exonerating
   directions, and an adversarial benchmark that ISOT cannot substitute for.

---

## 2. Related Work

**Explainable detection.** Shu et al. [1] (dEFEND) generate explanations by
jointly attending over article sentences and user comments, surfacing the
comments most indicative of deception. The explanations are genuine, but the
method requires a social-media comment stream, which does not exist for an
article a reader has just been sent. Amri et al. [3] (ExFake) combine content
with social context and external evidence; again the dependency is on signals
that arrive after an article circulates. Our factors are computed from the
article and from independent news retrieval only, so a report is available on
first sight.

**Classification on ISOT.** Ahmed et al. [2] established the ISOT dataset and
n-gram baselines. Reported accuracy on ISOT is routinely above 0.98, which
reflects properties of the corpus more than the difficulty of the task. Verma
[14] audits three leakage channels in it: a subject field whose values are
disjoint across the two classes, on which a classifier reading no article text
at all attains F1 = 1.000; a newswire agency tag present in 99.21% of real
articles and 0.04% of fake ones; and exact duplicates spanning 19.37% of a naive
test split. Removing all three costs only 1.21 F1 points, so a strong lexical
signal survives — which is the deeper problem for our purposes, since that
signal is exactly what an adversary writing carefully does not emit. We treat
high ISOT accuracy as a methodological hazard rather than a result, control the
channels we can (Section 6.2), and report the adversarial benchmark
(Section 7.7) as the measurement ISOT cannot substitute for.

**LLM-based verification.** Wang et al. [4] use a large language model to weigh
competing crowd reports about a claim. The approach is powerful but needs many
reports per claim. Our verification uses the model in a deliberately narrow
role — extract claims, judge stance over retrieved articles — which keeps the
factual burden on retrieval rather than on the model.

**Evidence retrieval.** Thorne et al. [5] (FEVER) formalised claim verification
against retrieved evidence, using Wikipedia as the corpus. Wikipedia is
unsuitable for breaking news, which is the case that matters here; we retrieve
from live news coverage by independent outlets instead, and accept that this
yields *unverified* far more often — an outcome we report rather than hide.

**Propaganda technique detection.** Da San Martino et al. [7] defined
SemEval-2020 Task 11, labelling persuasion techniques at span level across
fourteen categories. To our knowledge the taxonomy has remained a research task;
we adopt it as a reader-facing factor, naming the technique and quoting the span
that exhibits it.

**Calibration.** Guo et al. [6] demonstrated systematic overconfidence in modern
networks and evaluated remedies including Platt scaling [8]. We apply the
technique to a trust score and report ECE before and after, which is uncommon in
this application area.

**Selective prediction.** Declining to answer is not a concession but a
recognised decision rule. Chow [11] characterised the Bayes-optimal reject
region under an explicit cost of abstention; El-Yaniv and Wiener [12] formalised
the risk–coverage trade-off it induces, and Geifman and El-Yaniv [13] carried
the framework to deep networks. Misinformation systems rarely adopt it: the
standard protocol forces a label on every item, so a system that would have
abstained is scored as though it had guessed. Our verdict classes make
abstention a first-class outcome with its own ceiling, and we report the rate at
which it is used rather than treating it as a failure to classify.

**Weight of evidence.** The additive log-odds formulation is Good's [9]: a unit
of evidence contributes the logarithm of a likelihood ratio, in decibans, and
independent contributions add. We adopt it because the arithmetic is auditable
line by line — each row of a report states what was observed and what it was
worth — where a weighted sum states only a conclusion.

**Position.** Prior work is classification-centric and, with the exception of
[1] and [3], does not surface evidence. None of the systems above specifies what
they output when a component *fails*. Our contribution is assessment-centric:
score, evidence, calibration, and defined behaviour under partial failure.

---

## 3. Research Gap

1. Existing systems return a label rather than an explanation supported by
   evidence the reader can check.
2. Few systems cross-check claims against independent news coverage; those that
   do rarely report how often no coverage is found.
3. Calibration is almost never reported, so stated confidences are not
   interpretable as probabilities.
4. Propaganda-technique detection exists as a benchmark task but has not been
   integrated into a system a non-specialist reader can use.
5. **No published system specifies its behaviour when a component fails.** In
   practice the common implementation — emitting a neutral score — is
   indistinguishable at the interface from a completed check. We treat this as a
   correctness property, not an implementation detail.
6. No single deployed platform combines source assessment, headline analysis,
   language analysis, source transparency, persuasion-technique detection,
   cross-source verification, and calibrated explainable scoring.

---

## 4. System Architecture

### 4.1 Overview

Input enters as a feed item, a URL, pasted text, a screenshot or a video link. A
normalisation layer reduces each to the same object — text, a title-like claim,
and a provenance record — reading a publisher's page, a video transcript, or the
text inside an image as required. For a feed item the article reader fetches the
publisher's page, because a news API supplies roughly 200 characters of body
text, and accepts the result only if it passes a title-consistency check
(Section 5.1).

An **admissibility gate** then runs before anything expensive. Content that
asserts nothing a newsroom could confirm or deny receives no verdict at all, only
a statement of what would make it checkable. This precedes the pipeline because a
verdict on an unverifiable fragment is not a weak answer but a meaningless one.

```
  article · link · pasted text · screenshot · video
                       │
                       ▼
            ┌──────────────────────┐
            │  Normalise + gate    │ ── declines unverifiable input
            └──────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
  AUTHOR-CONTROLLED              INDEPENDENT OF THE AUTHOR
  headline · language            provenance record
  persuasion · attribution       corroboration (independent sources)
        │                        premise check (reference work)
        │                              │
        ▼                              ▼
  admitted one-sidedly           admitted in both directions
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  Weight of evidence, in      │  measured likelihood ratios,
        │  additive log-odds           │  correlation-damped, calibrated
        └──────────────────────────────┘
                       ▼
     P(fake news)  ·  verdict + grounds  ·  writing quality, reported apart
```

The split down the middle is the architecture. Everything on the left is chosen
by whoever wrote the text and is admitted only where it incriminates; everything
on the right is outside that author's reach and is the only thing that may speak
in the article's favour.

Beneath all of it sits an **LLM gateway** (Section 4.5) that abstracts provider
and model, and a **cache** keyed by article URL.

### 4.2 The observations

**[1] Source reputation** (weight 0.15). A curated database of 90 outlets, each
with a factual-reporting rating, editorial lean, and outlet type, matched by name
and domain alias. Matching is whole-word and prefix-based; substring matching was
found to produce false positives (Section 5.2).

**[2] Headline quality** (0.10). Structured scoring of clickbait signals —
curiosity gap, sensational verbs, unsubstantiated superlatives, listicle
framing — returning the specific signals present rather than a score alone.

**[3] Language** (0.15). Flags individual sentences exhibiting political bias,
one-sided reporting, emotional manipulation, or opinion presented as fact. Each
flagged sentence is returned verbatim with its type and a reason, and is
displayed to the reader as a quotation.

**[4] Source transparency** (0.18). Answers a question the other content factors
cannot: *could a reader go and verify any of this?* A five-point journalism
checklist — names its sources (3), uses attributed quotes (2), points to primary
evidence (2), gives concrete detail (2), claims are measured (1) — scored out of
ten. The factor additionally returns unattributable appeals ("experts say",
"sources close to the investigation") quoted exactly, with a penalty of 0.5 per
distinct phrase capped at 2.0.

This factor is deliberately independent of external evidence, which makes it the
one content factor that remains informative for an obscure story no other outlet
has covered — precisely when cross-source verification abstains.

**[5] Persuasion technique** (0.15). Detects techniques from the SemEval-2020
Task 11 taxonomy [7], reduced to fourteen categories that occur in mainstream
reporting and are recognisable to a non-specialist. Each detection must quote the
span it applies to. At most three are reported, each costing 2.6 points from a
base of 10.

**[6] Cross-source verification** (0.27). Claims are extracted from the article,
then for each claim the system retrieves coverage from *other* outlets (the
article's own source excluded) and judges stance over the retrieved items,
citing the specific articles that support or contradict. Verdicts are
*supported*, *contradicted*, *unverified*, or *undetermined*.

The fourth is not a refinement but a correction we were forced into. A retrieval
that fails and a retrieval that returns nothing are represented identically by
every HTTP client and, in our first implementation, by every layer above it: a
rate-limited index, an unparseable stance judgement and a genuinely uncovered
story all arrived as an empty evidence list. The system then reported "no other
outlet is reporting this" — a statement about the world — on the strength of an
outage. We observed exactly this on a wire report that five major outlets were
carrying at the time, whose headlines the system had already retrieved. Each
point at which a failure can be silently coerced into a finding is therefore
made explicit: the retrieval, the stance judgement and the aggregate each
distinguish *did not run* from *ran and found nothing*, and only the latter
reaches the verdict rules. An item whose verification did not run is reported as
unchecked, and the corroboration term contributes zero rather than the small
positive weight that absence of coverage otherwise carries.

This is the same discipline the asymmetry argument rests on, applied to the
system's own instruments. A detector that cannot distinguish its own blindness
from the absence of a thing will, under load, manufacture the evidence it failed
to collect — and it will do so in the accusing direction, because absence of
corroboration is what it has been taught to treat as mildly incriminating.

### 4.3 Weighing the evidence

Let $O$ be the observations made about an item. Each contributes a likelihood
ratio

$$\Lambda(o) \;=\; \frac{P(o \mid \text{fabricated})}{P(o \mid \text{genuine})}$$

estimated from labelled articles by binning the observation and counting, with a
Jeffreys prior and shrinkage to the conservative end of a 95% interval, so a bin
supported by few articles contributes nothing. Ratios are reported in decibans,
$W(o) = 10\log_{10}\Lambda(o)$, because decibans add: the posterior is a sum a
reader can check by hand.

$$\text{logit}\,P(\text{fabricated}\mid O) \;=\; \text{logit}\,\pi \;+\; \sum_{o \in O} W(o)$$

where $\pi$ is a prior conditioned on provenance.

**The admissibility rule.** Partition $O$ into $O_A$, the observations selected
by the author, and $O_I$, those outside the author's control. For $o \in O_A$ we
admit

$$W^{\dagger}(o) \;=\; \max\bigl(0,\; W(o)\bigr).$$

The justification is adversarial rather than statistical. A capable author drives
$P(o = \text{favourable} \mid \text{fabricated})$ toward
$P(o = \text{favourable} \mid \text{genuine})$, so the exculpatory ratio tends to
1 whatever an estimation corpus reports. A corpus of crude fabrications will
measure $\Lambda < 1$ for fluent prose and be correct about that corpus and
wrong about any competent adversary; the clamp declines to learn it. Three
consequences follow directly rather than as special cases: an uninformative
observation has $\Lambda = 1$ and contributes exactly zero, so abstention is
arithmetic rather than a code path; an unmeasured observation likewise
contributes zero and is named in the report; and presentation cannot establish
credibility at any value.

**Correlation damping.** Members of $O_A$ measure overlapping properties of the
same prose and are not conditionally independent. Under equicorrelation $\bar r$
the effective count of independent factors among $k$ is
$k / (1 + (k-1)\bar r)$, and the family's summed weight is scaled by
$n_\text{eff}/k$. Measured on the clean corpus, $\bar r = 0.55$ over four checks
gives $n_\text{eff} = 1.52$, a damping factor of 0.379. The strongest pair,
headline quality and language, correlates at $r = 0.93$: on this corpus they are
very nearly one observation reported twice.

**Calibration.** The clamp discards exculpatory evidence and leaves genuine
articles massed at the prior, which makes the raw posterior systematically
under-confident. An isotonic map fitted on held-out data corrects the
ranking-to-probability step; the corpus base rate is divided out in log-odds
space before the article's own prior is applied, so the map transports between
populations rather than importing the corpus composition. The clamp is
re-applied after calibration, because a monotone map fitted where fluent prose
does predict a genuine article will otherwise restore precisely the exculpatory
weight the rule removes.

**Verdict.** Separately from the probability, an ordered rule set assigns one of
seven classes from the evidence ledger and states the rule that fired. The
probability expresses graded belief; the verdict states what has been
*established*, and the two come apart exactly where it matters — an uncorroborated
story may carry a low probability of fabrication merely because most articles are
genuine, while nothing whatever about it has been established.

### 4.4 Premise verification

Cross-source verification asks whether other newsrooms report the same event, and
has a structural blind spot: a claim resting on a false premise describes an
event nobody reports, so the search correctly returns nothing and the finding
that matters — that the premise is false — is missed. Named subjects are
therefore resolved against a reference work and the article's statements about
them tested for direct conflict. A contradiction must quote the reference text,
and a quotation not found in the retrieved entry is discarded.

The two channels are not merged. A reference work is not an independent newsroom
reporting an event; it is a record of stable facts, and it is admitted only where
it is strong — refuting a premise, never corroborating an event.

### 4.5 Provider-independent model access

All factors reach the language model through a single gateway that owns
concurrency limiting, retry policy, and structured-output parsing. Provider and
model are configuration, and the gateway distinguishes three failure classes:

- **Withdrawn model** (HTTP 404/410) — adopt the next model permanently.
- **Congestion** (HTTP 429/503) — retry the same model with exponential backoff,
  honouring `Retry-After`, without demoting a healthy primary.
- **Exhausted provider** — fall through to the next configured provider.

Both events occurred during development. The model used for the Phase I
benchmark was withdrawn mid-project, and every analysis began failing with HTTP
410; separately, the primary provider became congested enough that identical
requests were observed at 2 s and at 62 s. The gateway is a direct response to
both.

### 4.6 Degradation

If no provider answers, each content factor falls back to a deterministic
analyser using lexicons and surface patterns — the methods by which these tasks
were measured before neural models, and the reason lexicon baselines accompany
the SemEval propaganda task. Degraded results are marked as such in the report,
at both the summary and per-factor level, so a weaker analysis is never presented
as a full one. Section 7.6 reports its discriminative power.

---

## 5. Implementation

Backend: Node.js and Express with MongoDB. Frontend: React. News retrieval:
NewsAPI. Language model: NVIDIA NIM or Google Gemini, selected by configuration.

### 5.1 Article acquisition and verification

A news API returns roughly 200 characters of body text with a truncation marker.
Fetching the publisher's page instead yields 2,000–6,000 characters at a cost of
1–3 seconds and no model call.

Page extraction is not reliable enough to trust unconditionally. In testing, an
Associated Press article returned the page's navigation and newsletter
promotions rather than the story, and the resulting summary confidently described
an unrelated trade dispute. Extracted text is therefore accepted only if at least
half of the headline's distinctive terms appear in it; otherwise the feed
snippet is used. Across a ten-article sample, extraction was accepted for seven.

Text supplied to the model is bounded (Section 7.3).

### 5.2 Source matching

Outlet matching was initially substring-based, which matched "Yahoo
Entertainment" against the entry for "RT". Matching now tokenises both sides and
requires an exact or whole-word prefix match, in two passes.

### 5.3 Structured output handling

Factors require JSON. Three failure modes were observed and are handled in the
gateway: fenced or prose-wrapped output; malformed values (unquoted strings,
trailing commas); and truncation. For truncation the parser recovers the
elements that completed rather than discarding the reply. A separate defect — the
news API's `[+8026 chars]` marker being echoed by the model and captured as the
start of a JSON array — is prevented by stripping the marker before any prompt is
built.

### 5.4 Caching and pre-warming

Trust reports and summaries are cached by article URL with a 14-day expiry.
Reports carry a schema version; a cached report from an earlier pipeline is
re-analysed rather than served, so a pipeline change cannot leave a reader
viewing an outdated breakdown. A pre-warm script analyses a category in advance.

---

## 6. Evaluation Methodology

### 6.1 Dataset

ISOT [2]: 43,294 usable articles after length filtering (21,915 fake, 21,379
real). Stratified seeded sampling; the identical article set is used across all
configurations.

### 6.2 Leakage control

ISOT's real articles originate from Reuters, so outlet identity alone predicts
the label. Two controls are applied: source identity is hidden from the pipeline
during evaluation, and agency prefixes of the form `CITY (Reuters) –` are
stripped from article text. Reported figures are therefore content-based.

Cross-source verification is disabled for dataset runs, since historical
articles have no live coverage; the production path in that situation —
a corroboration outcome of none — is identical.

### 6.3 Protocol and metrics

Threshold and Platt parameters are fitted on a validation half; all reported
metrics come from the held-out test half. Metrics: accuracy, macro-F1, ROC-AUC,
and 10-bin expected calibration error. The baseline is a single holistic
credibility prompt using the same model, representing the LLM-black-box approach.

Transient API failures abort and retry the affected article rather than recording
a neutral fallback, so that infrastructure noise cannot enter the results.

---

## 7. Results

### 7.1 Against the rule this replaces

Likelihood ratios are estimated on a training half and every figure below comes
from the held-out half; the split is a hash of the article identifier, so runs
are reproducible and independent of write order. Source identity is hidden on
this corpus and historical articles have no live coverage, so neither provenance
nor corroboration is exercised — this measures the content half of the model
alone, which is the honest scope of the claim.

The corpus is 239 articles whose measurement channel is recorded: every factor
in it was produced by the language model rather than by the deterministic
fallback the system uses when the model is unavailable. An earlier table was
estimated on 1,642 records that did not record the channel, in unknown
proportion; those are excluded here (Section 8.1). Of 239, 119 train and 120
test.

n = 120 held-out articles:

| Model | Acc. | AUC | ECE | ECE-a | Prec-a | Brier |
|---|---|---|---|---|---|---|
| Legacy sum | 0.958 | 0.978 | 0.237 | 0.267 | 0.968 | 0.101 |
| WoE, raw | 0.950 | 0.973 | 0.308 | 0.257 | 0.967 | 0.142 |
| WoE, isotonic | 0.950 | 0.957 | 0.028 | 0.013 | 0.967 | 0.048 |

ECE-a and Prec-a are expected calibration error and precision computed over the
predictions where the system accuses, that is where it states a probability of
fabrication above one half. Lower is better for every column but accuracy, AUC
and precision.

**The accuracy difference is one article.** 114 correct against 115, of 120. We
draw no conclusion from it, and the earlier claim that accuracy rose from 0.888
to 0.954 does not survive the clean re-estimation: it was measured on the
contaminated corpus and is withdrawn. On ISOT the two models classify
equivalently, and the legacy rule ranks slightly better (AUC 0.978 against
0.957).

What does separate them is calibration, by a factor of twenty where it matters
most. Where the system accuses — which is where a false statement does harm —
expected calibration error falls from 0.267 to 0.013, and the Brier score from
0.101 to 0.048. A hand-weighted sum that is right about which articles are
fabricated can still be badly wrong about how sure it is; the reader sees the
confidence, not the ranking.

This is the result the design predicts rather than a disappointing one. The
admissibility rule removes evidence from the model — all of the exculpatory
evidence a corpus of crude fabrications makes available — so discrimination on
that corpus can only fall or hold. What is bought with it is a probability that
means what it says, and a system whose residual error points toward suspicion
rather than toward false reassurance.

### 7.2 What the admissibility rule costs

Disabling the clamp raises ROC-AUC from 0.957 to 0.973 on the clean corpus, and
the legacy hand-weighted rule — which admits exculpatory style evidence freely —
reaches 0.978. The gain is real and it is a trap: it comes from learning that fluent prose indicates a
genuine article, which holds on a corpus whose fabrications are crude and fails
against a competent one. ISOT contains no competent fabrications to expose the
error; the adversarial set of Section 7.7 contains ten. We report both
configurations and ship the clamp.

### 7.3 Classification and ablation *(historical configuration)*

n = 300 per configuration, stratified 150 fake / 150 real, seed 42, model
`meta/llama-3.1-8b-instruct`, four-factor pipeline:

| Configuration | Accuracy | Macro-F1 | ROC-AUC | ECE raw | ECE calibrated |
|---|---|---|---|---|---|
| Single-prompt baseline | 82.0% | 81.9% | 0.838 | 0.215 | 0.151 |
| **Pipeline (clickbait + bias)** | **94.7%** | **94.7%** | **0.987** | 0.277 | **0.073** |
| Ablation: clickbait only | 93.3% | 93.3% | 0.975 | 0.339 | 0.118 |
| Ablation: bias only | 92.7% | 92.7% | 0.934 | 0.359 | 0.204 |

Decomposing the judgment into focused factors outperformed a single holistic
prompt over the *same* model by 12.7 accuracy points and 0.149 AUC. The ablation
ordering is clean — bias-only 0.934 < clickbait-only 0.975 < combined 0.987 —
so both factors contribute and their combination is strictly best.

**This table must be read as a historical result.** The model has since been
withdrawn by its provider, and the transparency and persuasion factors did not
exist when it was produced. It is retained because it is the measurement that
motivated the architecture; it is not a claim about the present system. The
re-run is Section 10.1.

### 7.4 Calibration *(historical configuration)*

Raw scores rank well but cluster mid-range, giving ECE 0.277. Platt scaling [8],
fitted on the validation half, reduces this to 0.073 — inside the conventional
well-calibrated range — so a 70% trust score corresponds to approximately 70%
empirical probability. Reliability-diagram data is in
`backend/eval/results/summary.json`.

### 7.5 Input length and structured-output reliability

Model reply budgets are shared between reasoning and the required JSON. Feeding
more article text is therefore not monotonically beneficial. Measured on a
reasoning model with a fixed budget:

| Input characters | Short summary | Detailed summary |
|---|---|---|
| 800 | 6.8 s, 361 chars | 3.6 s, 504 chars |
| 1,500 | 9.6 s, 666 chars | 32.7 s, **empty** |
| 3,000 | 32.8 s, **no JSON** | 23.9 s, **empty** |

Beyond roughly 800 characters the model exhausted its budget before emitting
parseable output. Text supplied to factors and summarisers is bounded at 900
characters accordingly — still four to five times the news API's snippet. This is
a property of the deployed model rather than of the architecture, and the bound
is configuration.

### 7.6 Degradation

The deterministic fallback was evaluated with the language model made
unreachable:

| Article | Score, zero model calls | Verdict |
|---|---|---|
| Fabricated, loaded language, unattributable sourcing | **2.3 / 10** | Be skeptical |
| Ordinary attributed reporting | **9.8 / 10** | Looks trustworthy |

The degraded system retains useful separation. It detected loaded language,
name-calling, bandwagon and appeal-to-fear, and quoted four unattributable
phrases.

This section also records a defect found during Phase II and corrected. Four
content factors previously answered a failed model call with a neutral score of
5/10 and a `failed` flag that the aggregator did not read. A total outage
therefore produced a confident "Mostly fine ≈5.5/10" report assembled from four
placeholders, indistinguishable at the interface from a completed analysis. This
is the concrete instance of gap 5 in Section 3.

### 7.7 Adversarial benchmark

ISOT cannot test the failure this work addresses. Its fabrications are
conspicuously crude, so any system scoring style performs well on it while
remaining open to a competent fake — which is why a pipeline reporting 94.7% on
ISOT simultaneously rated invented articles at 7.3 out of 10. The benchmark
supplies the missing case: ten items, five fabrications written in plain newsroom
register with named sources and no clickbait, one high-impact fabrication with
manipulation signals, two genuine reports, one satirical piece and one
commentary. Each is scored twice from *identical factor outputs* — once under the
legacy additive rule with abstention redistribution, once under the current one.

| Measure | Legacy | Current |
|---|---|---|
| Deceptive items presented as credible | 4 / 6 | **0 / 6** |
| Verdict matched expectation | — | **6 / 6** |
| Genuine articles wrongly condemned | — | **0 / 2** |
| Mean legacy score of the fabrications | **7.3 / 10** | unchanged |

The last row is the finding. The fabrications still read as trustworthy and
always will; what changed is that reading well no longer determines the answer.

Two limitations are material. The genuine items are written by us, as the
fabrications must be, which makes the false-positive figure weaker than the
false-negative one; `--live-genuine` substitutes current articles from the feed
for exactly this reason. And ten items is a demonstration, not a population
estimate.

### 7.8 Evidence grounding

Because every factor quotes the article, its output is directly checkable. On a
hand-constructed article containing both verifiable facts and deliberately loaded
wording, all nine spans quoted by the system — four flagged sentences, three
persuasion techniques with their quotations, one unattributable phrase, and the
named sources — were present verbatim. The transparency checklist passed four of
its five checks and failed *claims are measured*, correctly attributing the
failure to the sentence *"Everyone knows parking is already impossible
downtown."* Cross-source verification abstained, as the article does not exist.

A live-news verification study with manual annotation of verdict correctness
(target: 30 claims, reporting coverage rate and verdict precision) is
outstanding.

### 7.9 System behaviour

Measured on the deployed system:

| Property | Phase I | Current |
|---|---|---|
| Cold analysis, one article | ~60 s (to 116 s under congestion) | **11–19 s** |
| Cached analysis | full recomputation | **~5 ms** |
| First factor visible to the reader | on completion | **< 1 s** |
| Automated backend tests passing | — | **42 / 42** |

Provider comparison, three structured tasks, three runs each:

| Task | NVIDIA NIM (`nemotron-3-super-120b`) | Google Gemini (`gemini-3.1-flash-lite`) |
|---|---|---|
| Bias | 3/3 valid, 6.2 s | 3/3 valid, **3.8 s** |
| Summary | 2/3 valid, 3.5 s | **3/3 valid**, **1.6 s** |
| Persuasion | **1/3 valid**, 10.5 s | **3/3 valid**, **4.6 s** |

Concurrency tolerance is provider-specific, and assuming otherwise is costly.
Six identical calls:

| Parallelism | NVIDIA NIM | Google Gemini |
|---|---|---|
| 2 | baseline | 37.5 s |
| 3 | — | **7.9 s** |
| 6 | slower than 2 | 9.1 s |

The gateway therefore takes its concurrency limit from the leading provider. The
latency reduction in the table above is attributable to four changes measured
independently: provider selection, provider-aware concurrency, parallel
per-claim verification, and overlapping claim extraction with the content
factors.

---

## 8. Discussion

**On abstention as a correctness property.** The defect in Section 7.4 is the
clearest argument for the design. A system that emits a neutral score on failure
is not merely imprecise; it is *misleading in a specific direction*, because a
neutral score on a 0–10 scale reads as mild reassurance. Any system combining
independently-failing components inherits this hazard, and we suggest that
defined failure behaviour belongs in the specification of such systems rather
than in their implementation.

**On the division of labour with the model.** The model is used for judgments
that are linguistic (is this sentence loaded? does this article name sources?)
and never for judgments that are factual (is this claim true?). Factual weight
rests on retrieval. This is why the system abstains often on cross-source
verification, and we regard the abstention rate as an honest cost rather than a
weakness to be engineered away.

**On a component we removed.** A seventh factor matching claims against
professional fact-checkers was implemented and validated: given a claim Snopes
had rated, it retrieved the page, read `"False"` from its ClaimReview markup, and
cited the URL; given a different claim on the same topic, it correctly declined
to match. It is not in the running system. Google's Fact Check Tools API requires
a billing-enabled account, and the keyless alternative — locating fact-check
pages through news search — consumes a request budget of 100 per day that the
article feed itself depends on. Direct search of fact-checker sites was tested
and is unusable, as their result pages render in JavaScript. The code is retained
and documented for reactivation.

**Threats to validity.** ISOT is 2016–2017 US political news; distribution shift
to current news is unmeasured. Stance judgment reads headlines and descriptions
rather than full bodies; a natural-language-inference model is a drop-in upgrade.
Language-model factors inherit model bias, which low temperature and structured
output reduce variance but not bias in. The source database covers 90 outlets,
so smaller publishers frequently receive no reliability record — the most common
gap observed in deployment. The Section 7.1 measurement is single-dataset and
single-model.

---

### 8.1 Limitations and threats to validity

We state these plainly, because several bear directly on how the numbers above
should be read.

**The corpus is small.** The weights and the held-out comparison rest on 239
articles, 119 training and 120 test. A one-article difference in accuracy is
not a difference, and we do not treat it as one. The earlier figures, estimated
on 1,642 records, were larger but of unknown provenance: the guard intended to
exclude pattern-matcher observations tested a flag the checks never set, so it
never fired, and the proportion of fallback observations was unknown. That
instrumentation is corrected, the channel is recorded per observation, and this
table is estimated with `--clean-only` from records that state it. We prefer
239 articles of known provenance to 1,642 of unknown, and state the cost:
ISOT's score distribution is bimodal, so the middle bands remain thin and
several contribute nothing. The re-estimation stopped at 239 rather than the
intended 300 because both model providers became unavailable mid-run — one
returning 503, the other out of quota — and the remaining articles were not
worth waiting on at the rate the run had dropped to.

**Priors and corroboration rates are declared, not measured.** The provenance
priors and the likelihood ratios attached to corroboration are set from
reasoning about publishing practice rather than estimated from labelled data.
Each is labelled *declared* in the stored table and in every report, and each
carries a note stating what would measure it. This is a stated assumption, not
a hidden one, but it is an assumption.

**The adversarial set is small and partly self-authored.** Six deceptive and two
genuine items, of which the deceptive items were written by the authors to
satisfy every presentation check. This measures whether the admissibility rule
does what it is designed to do; it does not estimate a rate in the wild, and a
set written by the people who designed the defence is not an independent test of
it.

**ISOT is not a test of the capability claimed.** Its fake articles are crude
enough that presentation alone separates the classes [14], which is the opposite
of the adversary this work is designed against. We use it to estimate likelihood
ratios for presentation observations — a purpose for which crude fabrications
are adequate — and not as evidence of performance against a careful adversary.

**Corroboration depends on a commercial news index.** Coverage of local and
non-English reporting is uneven, and an absence of retrieved coverage may
reflect the index rather than the world. The system reports *unverified* in that
case rather than a verdict, which is the correct behaviour, but the rate at
which it does so is a property of the index as much as of the article.

**The one-sided rule costs discrimination.** Section 7.2 reports AUC of 0.957
with the rule enforced against 0.978 without it. We argue the difference is
bought with evidence a competent adversary supplies at will, but on a corpus of
incompetent adversaries the unconstrained model is genuinely the better
classifier, and we do not claim otherwise.

---

## 9. Conclusion

Detecting fake news is not ordinary classification, and the difference is not a
detail of implementation. When an adversary writes the features, the value of a
feature changes: it may still incriminate, but it can no longer exonerate,
because the favourable value is precisely what the adversary supplies. A detector
that learns otherwise has learned the habits of whichever crude fabrications its
corpus happened to contain.

We stated that asymmetry as an admissibility rule, built a scoring model on it in
which every weight is a likelihood ratio measured from labelled data rather than
a constant chosen by hand, and reported the result as a probability that can be
checked against outcomes rather than a score on an invented scale. Held out, this
leaves accuracy where the rule it replaces left it — 114 correct against 115, of
120 — and reduces calibration error where the system accuses twentyfold, from
0.267 to 0.013. It also costs something, and we report that too: two points of
ranking performance, on a corpus that cannot express the attack the rule defends
against.

The property we regard as central is what the system does when it does not know.
It declines input carrying no verifiable claim, says what is missing, and
distinguishes a check that found nothing from one that could not run — a
distinction we got wrong three times during development, each time in a new
place, and each time with the same effect of presenting an absence of knowledge
as a clean bill of health.

---

## 10. Future Work

### 10.1 Immediate

Re-run the full benchmark on the current six-factor pipeline and current model,
with ablations for the transparency and persuasion factors, replacing
Section 7.1. Complete the live-news verification study in Section 7.5.

### 10.2 Planned

**Reading trust history.** Per-article scores are already stored; presenting a
reader's own reading reliability over time requires only the visualisation.

**Self-extending source ratings.** The 90-outlet database is hand-curated, and
unrecognised outlets are the most frequent gap in deployment. Because every
analysis already yields a per-outlet score, ratings for unlisted outlets can be
accumulated from articles already assessed, and validated against the
hand-curated entries.

---

## References

[1] K. Shu, L. Cui, S. Wang, D. Lee, and H. Liu, "dEFEND: Explainable Fake News
Detection," in *Proc. 25th ACM SIGKDD Int. Conf. Knowledge Discovery and Data
Mining (KDD)*, Anchorage, AK, USA, 2019, pp. 395–405.

[2] H. Ahmed, I. Traore, and S. Saad, "Detection of Online Fake News Using
N-Gram Analysis and Machine Learning Techniques," in *Proc. Int. Conf.
Intelligent, Secure, and Dependable Systems in Distributed and Cloud
Environments (ISDDC)*, Vancouver, BC, Canada, 2017, pp. 127–138.

[3] S. Amri, H.-C. Mputu Boleilanga, and E. Aïmeur, "ExFake: Towards an
Explainable Fake News Detection Based on Content and Social Context
Information," arXiv:2311.10784, Nov. 2023.

[4] B. Wang, J. Ma, H. Lin, Z. Yang, R. Yang, Y. Tian, and Y. Chang,
"Explainable Fake News Detection with Large Language Model via Defense Among
Competing Wisdom," in *Proc. ACM Web Conf. (WWW)*, Singapore, 2024,
pp. 2452–2463.

[5] J. Thorne, A. Vlachos, C. Christodoulopoulos, and A. Mittal, "FEVER: A
Large-scale Dataset for Fact Extraction and VERification," in *Proc. Conf.
North American Chapter Assoc. Computational Linguistics (NAACL-HLT)*,
New Orleans, LA, USA, 2018, pp. 809–819.

[6] C. Guo, G. Pleiss, Y. Sun, and K. Q. Weinberger, "On Calibration of Modern
Neural Networks," in *Proc. 34th Int. Conf. Machine Learning (ICML)*, Sydney,
Australia, 2017, pp. 1321–1330.

[7] G. Da San Martino, A. Barrón-Cedeño, H. Wachsmuth, R. Petrov, and P. Nakov,
"SemEval-2020 Task 11: Detection of Propaganda Techniques in News Articles," in
*Proc. 14th Workshop on Semantic Evaluation (SemEval)*, Barcelona, Spain, 2020,
pp. 1377–1414.

[8] J. C. Platt, "Probabilistic Outputs for Support Vector Machines and
Comparisons to Regularized Likelihood Methods," in *Advances in Large Margin
Classifiers*, A. J. Smola, P. Bartlett, B. Schölkopf, and D. Schuurmans, Eds.
Cambridge, MA, USA: MIT Press, 1999, pp. 61–74.

[9] I. J. Good, *Probability and the Weighing of Evidence*. London, U.K.:
Charles Griffin, 1950.

[10] B. Zadrozny and C. Elkan, "Transforming Classifier Scores into Accurate
Multiclass Probability Estimates," in *Proc. 8th ACM SIGKDD Int. Conf.
Knowledge Discovery and Data Mining (KDD)*, Edmonton, AB, Canada, 2002,
pp. 694–699.

[11] C. K. Chow, "On Optimum Recognition Error and Reject Tradeoff," *IEEE
Trans. Inf. Theory*, vol. 16, no. 1, pp. 41–46, Jan. 1970.

[12] R. El-Yaniv and Y. Wiener, "On the Foundations of Noise-free Selective
Classification," *J. Machine Learning Research*, vol. 11, pp. 1605–1641, 2010.

[13] Y. Geifman and R. El-Yaniv, "Selective Classification for Deep Neural
Networks," in *Advances in Neural Information Processing Systems (NeurIPS)*,
Long Beach, CA, USA, 2017, pp. 4878–4887.

[14] Y. Verma, "What Does 99% Accuracy Measure? A Reproducible Audit of Shortcut
Learning in a Widely Used Fake News Corpus," arXiv:2609.25006, 2026.

[15] H. Jeffreys, *Theory of Probability*, 3rd ed. Oxford, U.K.: Clarendon
Press, 1961.

---

## Appendix A — Reproducibility

Every figure in Sections 7.1, 7.2 and 7.7 is reproducible without any API key,
because the estimation, the held-out comparison and the adversarial benchmark all
run on stored factor outputs and deterministic analysers:

```bash
cd backend
npm test                                  # 103 tests, no keys required
node eval/estimateWeights.js              # measure the likelihood ratios
node eval/validateScoring.js              # Section 7.1
node eval/validateScoring.js --no-clamp   # Section 7.2, the ablation
node eval/adversarialBench.js --no-model  # Section 7.7
```

Reproducing Section 7.3, the historical ISOT run, additionally needs a model
provider and the corpus:

```bash
node eval/prepareIsot.js
node eval/runEval.js --data eval/data/isot.csv --config content-only --sample 300
node eval/runEval.js --data eval/data/isot.csv --config baseline     --sample 300
node eval/report.js
```

Replacing the declared corroboration rates with measured ones needs a news-API
quota:

```bash
node eval/measureCorroborationRates.js
```

Seed 42; identical stratified sample across configurations; per-article results
written as JSONL. Provider and model are set by `LLM_PROVIDER`,
`NIM_MODEL_NAME`, and `GEMINI_MODEL_NAME`; concurrency by `LLM_MAX_CONCURRENT`.

## Appendix B — Measured weights of evidence

Estimated by `eval/estimateWeights.js --clean-only` over 239 labelled articles
whose measurement channel is recorded, in decibans after shrinkage to the
conservative end of a 95% interval. Positive values point toward fabrication.
Values in the exculpatory half are shown as measured and are **not** admitted
for author-controlled observations (Section 4.3).

| Observation | Band | Fab / Gen | Measured (db) | Admitted (db) |
|---|---|---|---|---|
| Headline quality | 0–2 | 37 / 0 | +7.2 | +7.2 |
| Headline quality | 2–4 | 48 / 0 | +8.4 | +8.4 |
| Headline quality | 4–6 | 14 / 1 | +3.2 | +3.2 |
| Headline quality | 8–10 | 4 / 124 | −10.0 | 0 |
| Language (bias) | 0–2 | 93 / 0 | +11.2 | +11.2 |
| Language (bias) | 2–4 | 17 / 2 | +3.3 | +3.3 |
| Language (bias) | 6–8 | 1 / 22 | −4.1 | 0 |
| Language (bias) | 8–10 | 1 / 100 | −10.8 | 0 |
| Persuasion technique | 2–4 | 106 / 38 | +3.8 | +3.8 |
| Persuasion technique | 4–6 | 5 / 52 | −5.6 | 0 |
| Persuasion technique | 8–10 | 0 / 21 | −3.7 | 0 |
| Source transparency | 2–4 | 22 / 7 | +1.9 | +1.9 |
| Source transparency | 8–10 | 26 / 82 | −2.8 | 0 |
| Source reputation | all bands | 361 / 378 | 0 | 0 |

Bands omitted from the table are those where the counts were too thin for the
interval to exclude a ratio of one; each contributes exactly zero and is named
as unmeasured in the report rather than receiving an assigned weight. Source
reputation measures zero because source identity is hidden on this corpus to
defeat its label leak; provenance enters through the prior instead.

Transparency is newly measurable. On the previous corpus it had 18 labelled
examples and contributed nothing; with 239 it separates the classes weakly but
in the expected direction, and now carries a small admitted weight.

The style family is damped by 0.379 — four checks correlating at a mean r = 0.55
are 1.52 effective independent factors, not four — and capped at 8 db in total.
The strongest pair is headline quality and language, at r = 0.93: on this corpus
they are very nearly one observation reported twice, which is what the damping
exists to prevent.

**Declared, not measured.** The provenance priors (0.02 to 0.35 by publisher
band), the five-way corroboration distribution, and the style cap are stated
parameters, labelled as declared in every report.
