# 🛡️ Pure Press — AI-Powered News Trust and Credibility Analysis Platform

## 📖 Project Overview

The rapid growth of digital media and social networking platforms has made it difficult for users to identify trustworthy news. Fake news, biased reporting, clickbait content, and manipulated media are spreading faster than ever before.

This project builds an AI-powered platform that not only detects fake news but also evaluates the credibility, trustworthiness, and reliability of news articles — going beyond a simple "Fake vs Real" label to give users a full **Trust Score** with plain-language explanations.

---

## 🎯 Problem Statement

Most existing fake news detection systems only classify news as either "Fake" or "Real". These systems have several limitations:

- They do not explain *why* a news article is fake.
- They do not analyze source credibility.
- They do not identify political or emotional bias.
- They do not verify claims across multiple trusted news sources.
- They provide limited transparency to users.
- Most systems mainly support English content.

As a result, users still struggle to understand whether a news article can truly be trusted.

---

## 🔍 Existing Systems & Their Limitations

Current fake news detection systems generally use Machine Learning / Deep Learning / NLP models (Naive Bayes, SVM, Random Forest, CNN, LSTM, BERT), but typically offer:

- Fake/Real classification only
- No credibility analysis
- No source reliability checking
- No bias detection
- No claim verification
- No explanation for the prediction
- Limited multilingual support

---

## 🚀 Our Solution

Instead of simply classifying news as Fake or Real, **Pure Press** analyzes news content, source, writing style, bias level, and supporting evidence — then generates a single weighted **Trust Score (0–100)** with an Explainable AI breakdown of *why* that score was given.

---

## ✨ Key Features & Implementation Status

| # | Module | Status | Description |
|---|--------|--------|-------------|
| 1 | 🔍 Fake News Detection | ✅ **Implemented** | Fine-tuned BERT model (ISOT dataset, 44,000+ articles) classifies Fake / Real with a confidence score |
| 2 | 🏛️ Source Credibility Analysis | 🟡 **Basic version implemented** | Checks whether the news source (e.g. BBC, The Hindu, Reuters) is trustworthy; reliable sources get higher credibility scores |
| 3 | ⚖️ Bias Detection | ✅ **Implemented** | Trained on the MBIC dataset (1,500+ hand-labeled sentences) to detect political/emotional bias and one-sided reporting |
| 4 | 🎣 Clickbait Detection | ✅ **Implemented** | DistilBERT model trained on 32,000 headlines to catch sensational/misleading titles |
| 5 | ✅ Cross-Source Verification | 🔜 **Planned** | Will compare important claims against multiple trusted sources (Reuters, BBC, PTI) — credibility rises if claims match, falls if conflicting |
| 6 | 💡 Explainable AI | ✅ **Implemented** | Instead of showing only a score, the system explains the reasons (e.g. "Low source reliability", "Clickbait headline detected") |
| 7 | 🌍 Multilingual News Analysis | 🔜 **Planned / training in progress** | XLM-RoBERTa model for Tamil, Hindi, Malayalam — addresses the English-only limitation of existing systems |
| 8 | ✔️ Claim-Level Fact Checking | 🔜 **Future Scope** | Sentence-by-sentence claim verification (e.g. "Virat Kohli scored 500 runs in one over" → False Claim) — more granular than article-level classification |
| 9 | 📝 News Summarization | 🔜 **Future Scope** | Converts long articles into short summaries for better readability |
| 10 | 📈 News Propagation Analysis | ✅ **Implemented** | Compares how fast/far fake vs real news spreads, using the FakeNewsNet dataset (23,000+ articles) |
| 11 | 📡 Real-Time Breaking News Monitoring | 🔜 **Planned** | Will continuously monitor trusted news feeds via NewsAPI and alert on suspicious news |

Also implemented:
- 🔐 User authentication (Signup/Login) with SQLite + SHA-256 password hashing
- 🎨 Custom-designed dark-themed UI with animated carousels and interactive dashboards

---

## 📚 Research Gap

Most existing systems focus only on fake news classification. Very few systems combine **Credibility Analysis + Bias Detection + Cross-Source Verification + Explainable AI + Multilingual Support + Claim-Level Fact Checking + News Summarization** within a single platform — which is what this project aims to do.

---

## 🎯 Expected Outcome

The system helps users:
- Identify trustworthy news
- Understand bias in reporting
- Verify important claims
- Avoid misinformation
- Understand *why* a news article received a specific trust score

---

## 🛠️ Technology Stack (as actually implemented)

| Layer | Technology |
|-------|-----------|
| **Frontend / App** | Streamlit (with embedded Bootstrap 5 HTML components for carousels) |
| **Backend Logic** | Python |
| **Machine Learning** | BERT, DistilBERT (Hugging Face Transformers), PyTorch |
| **Database** | SQLite (user authentication) |
| **Data Handling** | Pandas |

> **Note:** The original proposal considered React.js / Flask / MongoDB. The team built the working prototype with **Streamlit + SQLite** instead, for faster full-stack development within a single Python codebase. This can be migrated to React/Flask/MongoDB in a later phase if needed (see Future Scope).

---

## 📂 Folder Structure

```
project-root/
├── app.py                      # Main Streamlit application
├── requirements.txt
├── .gitignore
├── README.md
├── users.db                    # Auto-created on first run (not committed)
├── models/                     # Trained model weights (not committed - see below)
│   ├── fake_news_bert_model/
│   ├── bias_bert_model/
│   └── clickbait_bert_model/
└── datasets/
    └── 08_News_Propagation/
        └── propagation_analysis.csv
```

> The `models/` folder is excluded from git (see `.gitignore`) since trained model weights are large. Each teammate should keep their own local copy of the trained models in the paths shown above.

---

## 🚀 Setup & Run Locally

1. **Clone the repo**
   ```bash
   git clone <repo-url>
   cd <repo-folder>
   ```

2. **Create a virtual environment** (recommended)
   ```bash
   python -m venv venv
   venv\Scripts\activate      # Windows
   source venv/bin/activate   # Mac/Linux
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Add the trained models**
   Place your trained model folders inside `models/` exactly as shown in the folder structure above.

5. **Add the dataset**
   Place `propagation_analysis.csv` inside `datasets/08_News_Propagation/`.

6. **Run the app**
   ```bash
   streamlit run app.py
   ```

7. Open the local URL Streamlit prints in the terminal (usually `http://localhost:8501`).

---

## 🔮 Future Scope

- Complete **Multilingual Analysis** module (Tamil/Hindi/Malayalam) once training finishes
- Implement **Cross-Source Verification** using a live news API
- Implement **Claim-Level Fact Checking** (sentence-level verification)
- Implement **News Summarization** for long articles
- Implement **Real-Time Monitoring** for breaking news alerts
- Expand **Source Credibility** from basic lookup to a full MBFC-style scoring system
- Browser Extension
- Mobile Application
- Social Media Integration
- Advanced Deepfake Detection
- Deploy on Streamlit Community Cloud / a cloud VM for public access

---

## 📌 Conclusion

The proposed AI-Powered News Trust and Credibility Analysis Platform provides a complete solution for news verification by combining fake news detection, credibility analysis, bias detection, multilingual support, claim verification, and explainable AI into a single intelligent platform.

---

## 👥 Contributors

- Nandha Kumar
- Mugilan
- Nandhini

---

## 📄 License

This project was built for academic purposes.