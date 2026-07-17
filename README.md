# 🛡️ AI-Powered News Trust and Credibility Analysis Platform

## 📖 Project Overview

The rapid growth of digital media has made it difficult for users to identify trustworthy news. Fake news, biased reporting, and clickbait content spread faster than ever before.

Most fake news detectors only answer one question — "Fake or Real?" — with no reasons, no evidence, and no measure of confidence.

This project goes further. It analyzes every news article from **four independent angles** and produces an **explainable trust score** that users can actually inspect and understand.

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

Instead of one black-box prediction, every article passes through **four parallel checkers**:

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

### 🔄 4. Cross-Source Verification

The most important checker:

* Extracts the article's main factual claims
* Searches what **other independent news outlets** reported
* Compares the claims against that real coverage

If other outlets confirm the claims → trust increases.
If they contradict the claims → trust decreases and the user is alerted.
If no coverage exists → the system honestly reports **"unverified"** instead of guessing.

The AI never "verifies from memory" — every verdict is grounded in retrieved evidence, with links the user can click and check.

---

## 🤖 Explainable Trust Score

The four results combine into one trust score through a **transparent weighted formula** — not another AI guess. The user sees the full breakdown:

* Overall score dial with a verdict (Trustworthy / Exercise Caution / Low Credibility)
* Individual bars for each of the four factors
* The highlighted biased sentences
* The verified/contradicted claims with evidence links

The score is also **calibrated**: when the system says 70% trust, it is actually right about 70% of the time.

---

## 📊 Tested Results

Tested on 300 articles from the standard **ISOT fake news dataset** (150 fake, 150 real):

| Approach | Accuracy |
|----------|----------|
| Asking the AI model directly (single prompt) | 82.0% |
| **Our 4-factor pipeline (same AI model)** | **94.7%** |

Removing any single checker lowers the accuracy — proof that every module contributes. The full testing framework is included in the repository and every result is reproducible.

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

* Llama 3.1 (via NVIDIA NIM API)
* Custom multi-factor analysis pipeline

### 🗄️ Database

* MongoDB

### 📡 News Data

* NewsAPI

---

## 🔮 Future Scope

* 🏆 **News Literacy Levels** — users earn points for reading verified news and level up from "Reader" to "Fact Checker" to "Truth Guardian"
* 🔀 **Compare Coverage** — see side-by-side how different outlets report the same story
* 🔗 **Analyze Any Article** — paste any news link and get a full trust report
* 📈 **Personal Trust Dashboard** — charts of the trust level of what you read

---

## 📌 Conclusion

This platform provides a complete solution for news verification by combining source credibility analysis, clickbait detection, bias detection, cross-source claim verification, and explainable AI into a single working system — helping users not just detect fake news, but understand **why** an article can or cannot be trusted.
