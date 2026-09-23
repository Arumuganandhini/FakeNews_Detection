# Abstract

**Adversarially Asymmetric Evidence for Calibrated Fake News Detection**

**Mugilan K S (23CSR138) · Nandha Kumar S (23CSR140) · Nandhini A (23CSR141)**

**Guide: Ms. M. Kannukkiniyal**

Department of Computer Science and Engineering

Course 22CSP72 — Project Work II

---

## Abstract

A reader who receives a news story as a link, a forwarded message or a screenshot
must decide whether to believe it. Systems built for this purpose
score the language of an article: its tone, its headline, and whether it names
its sources. Each signal is selected by the author, so a fabrication written in
conventional newsroom register attains the same score as a genuine report; on such a design, invented articles averaged 7.3 out of 10 and
four of six were presented to readers as credible. This work treats detection as
an adversarial problem and adopts the principle that follows from it: an
observation under the author's control may count against an article but never in
its favour. Support is therefore admitted only from outside the author's control,
namely corroboration by independent newsrooms, counted in distinct sources rather
than retrieved articles so that common ownership and syndicated copy collapse,
together with verification of the article's premises against a reference work
where a news index cannot adjudicate. Each observation contributes a
likelihood ratio estimated from labelled articles rather than a weight assigned
by hand, and these combine into a calibrated probability. The system operates
across languages, declines input too unspecific to verify and reports what is
absent, returns a definite verdict rather than a score, and assesses writing
quality separately, since a well-written account may still be false. On held-out
data, accuracy increased from 0.888 to 0.954 and precision among flagged articles
from 0.848 to 0.975.

**Keywords** — fake news detection, adversarial evidence, likelihood ratio,
probability calibration, source independence, claim verification

---

## Contributions

1. An adversarial admissibility rule under which observations controlled by the
   author of a text are admitted only in the incriminating direction, so that
   presentation cannot establish credibility.
2. Corroboration measured in independent sources rather than in retrieved
   articles, with common ownership, agency syndication and near-duplicate
   reprints collapsed before any count is taken.
3. Verification of an article's premises against a reference work, conducted
   separately from verification of its events against news coverage, addressing
   claims that a news index cannot adjudicate.
4. Likelihood ratios estimated from labelled data, each traceable to the counts
   that produced it, in place of weights assigned by hand.
5. An input admissibility gate that declines content containing no verifiable
   claim and states the information required to make it verifiable.
6. Separation of veracity from presentation quality, reported as distinct
   outputs rather than combined into a single score.

---

## References

[1] S. Amri, H.-C. Mputu Boleilanga, and E. Aïmeur, "ExFake: Towards an
Explainable Fake News Detection Based on Content and Social Context Information,"
arXiv:2311.10784, 2023.

[2] H. Liu, W. Wang, H. Li, and H. Li, "TELLER: A Trustworthy Framework for
Explainable, Generalizable and Controllable Fake News Detection," in *Findings of
the Association for Computational Linguistics: ACL 2024*, 2024.

[3] C. Niu et al., "VeraCT Scan: Retrieval-Augmented Fake News Detection with
Justifiable Reasoning," arXiv:2406.10289, 2024.

[4] I. Vykopal, M. Pikuliak, S. Ostermann, and M. Šimko, "Generative Large
Language Models in Automated Fact-Checking: A Survey," arXiv:2407.02351, 2024.

[5] Z. Yan, P. Qi, W. Hsu, and M.-L. Lee, "TRUST-VL: An Explainable News
Assistant for General Multimodal Misinformation Detection," in *Proc. 2025 Conf.
Empirical Methods in Natural Language Processing*, 2025.

[6] J. Piskorski, N. Stefanovitch, G. Da San Martino, and P. Nakov,
"SemEval-2023 Task 3: Detecting the Category, the Framing, and the Persuasion
Techniques in Online News in a Multi-lingual Setup," in *Proc. 17th Int. Workshop
on Semantic Evaluation*, 2023, pp. 2343–2361.
