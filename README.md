# 🛡️ AI-Powered News Trust and Credibility Analysis Platform

**Final-Year Project — Team CO5** · Mugilan K S (23CSR138) · Nandha Kumar S (23CSR140) · Nandhini A (23CSR141)
**Guide:** Ms. M. Kannukkiniyal · **Course:** 22CSP72 Project Work II

Most fake-news detectors only say **"Fake" or "Real"** — with no reasons, no
evidence, and no idea how confident they really are. This platform instead
analyzes every news article from **four independent angles** and produces an
**explainable trust score** the user can actually inspect.

---

## ✨ How It Works

Each article is analyzed by four parallel checkers:

| # | Checker | What it does |
|---|---------|--------------|
| 1 | **Source Reputation** | Looks up the outlet in a curated database of ~120 rated news sources |
| 2 | **Headline Quality** | Detects clickbait signals in the headline |
| 3 | **Neutral Language** | Flags biased or emotionally manipulative sentences, with reasons |
| 4 | **Cross-Source Verification** | Extracts the article's main claims and checks whether *other* independent outlets report the same facts |

The four results combine into one **transparent weighted trust score** — a
formula anyone can audit, not another AI guess. The verification step never
"verifies from memory": the LLM only compares the article against real
coverage retrieved via NewsAPI, and honestly reports **"unverified"** (with
its weight redistributed) when no independent coverage exists.

The final score is **calibrated** (Platt scaling): when the system says 70%
trust, it is right about 70% of the time.

## 📊 Measured Results

Evaluated on 300 articles from the standard **ISOT dataset** (150 fake / 150
real), with source-identity leakage controlled:

| Approach | Accuracy | ROC-AUC |
|----------|----------|---------|
| Asking the LLM directly (single prompt) | 82.0% | 0.838 |
| **Our 4-factor pipeline (same LLM)** | **94.7%** | **0.987** |

Removing any single checker lowers accuracy — every module contributes.
Full evaluation framework in [`backend/eval/`](backend/eval/) (resumable,
seeded, reproducible). Research paper draft in
[`docs/paper/`](docs/paper/paper-draft.md).

## 🖥️ Platform Features

- 📰 Daily news feed (NewsAPI) with category browsing
- 🛡️ One-click **"Analyze Trustworthiness"** report per article: score dial,
  factor bars, highlighted biased sentences, and evidence links
- ✍️ AI summaries (short and detailed) per article
- 🧠 News-literacy quizzes generated from article content
- 👤 Accounts, reading history, and activity tracking

## 🛠️ Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 |
| Backend | Node.js + Express |
| Database | MongoDB (Mongoose) |
| AI Model | Llama-3.1-8B via NVIDIA NIM API |
| News Data | NewsAPI |
| Auth | JWT + bcrypt |

## 🚀 Running Locally

```bash
# Backend
cd backend
npm install
# create backend/.env with:
#   MONGO_URI=mongodb://127.0.0.1:27017/news_curator
#   JWT_SECRET=<any long random string>
#   NIM_API_KEY=<free key from build.nvidia.com>
#   NEWS_API_KEY=<free key from newsapi.org>
npm run dev

# Frontend (second terminal)
cd frontend
npm install
npm start
```

## 📁 Repository Layout

```
backend/
  agents/          # the 4 analysis checkers + orchestrator + legacy baseline
  eval/            # evaluation framework (benchmark runner, metrics, reports)
  routes/ models/  # Express API + MongoDB schemas
frontend/
  src/components/TrustReport.js   # explainable trust report UI
docs/
  proposal/        # project proposal documents
  paper/           # research paper draft
```

## 📚 Key References

1. K. Shu et al., *dEFEND: Explainable Fake News Detection*, ACM KDD 2019.
2. B. Wang et al., *Explainable Fake News Detection with Large Language Model
   via Defense Among Competing Wisdom*, ACM Web Conference 2024.
3. H. Ahmed, I. Traore, S. Saad, *Detection of Online Fake News Using N-Gram
   Analysis and Machine Learning Techniques*, ISDDC 2017 (ISOT dataset).
4. S. Amri et al., *ExFake: Towards an Explainable Fake News Detection Based
   on Content and Social Context Information*, 2023.
5. C. Guo et al., *On Calibration of Modern Neural Networks*, ICML 2017.
