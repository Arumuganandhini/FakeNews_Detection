"""
AI-Powered News Trust and Credibility Analysis Platform
Full Streamlit Web App - Newspaper themed, 9-module dashboard
"""

import streamlit as st
import streamlit.components.v1 as components
import torch
import pandas as pd
import sqlite3
import hashlib
from transformers import AutoTokenizer, AutoModelForSequenceClassification

st.set_page_config(page_title="Pure Press | News Trust Platform", page_icon="📰", layout="wide")

MODELS_PATH = "models"

# ---------------- Database (SQLite) ----------------
def init_db():
    conn = sqlite3.connect("users.db")
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def create_user(username, email, password):
    conn = sqlite3.connect("users.db")
    c = conn.cursor()
    try:
        c.execute(
            "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
            (username, email, hash_password(password))
        )
        conn.commit()
        return True, "Account created successfully!"
    except sqlite3.IntegrityError:
        return False, "Username or email already exists."
    finally:
        conn.close()

def verify_user(username, password):
    conn = sqlite3.connect("users.db")
    c = conn.cursor()
    c.execute("SELECT password_hash FROM users WHERE username = ?", (username,))
    row = c.fetchone()
    conn.close()
    if row and row[0] == hash_password(password):
        return True
    return False

init_db()

if "page" not in st.session_state:
    st.session_state.page = "home"
if "logged_in" not in st.session_state:
    st.session_state.logged_in = False
if "username" not in st.session_state:
    st.session_state.username = ""

def go_to(page_name):
    st.session_state.page = page_name


@st.cache_resource
def load_models():
    fake_news_tokenizer = AutoTokenizer.from_pretrained(f"{MODELS_PATH}/fake_news_bert_model")
    fake_news_model = AutoModelForSequenceClassification.from_pretrained(f"{MODELS_PATH}/fake_news_bert_model")

    bias_tokenizer = AutoTokenizer.from_pretrained(f"{MODELS_PATH}/bias_bert_model")
    bias_model = AutoModelForSequenceClassification.from_pretrained(f"{MODELS_PATH}/bias_bert_model")

    clickbait_tokenizer = AutoTokenizer.from_pretrained(f"{MODELS_PATH}/clickbait_bert_model")
    clickbait_model = AutoModelForSequenceClassification.from_pretrained(f"{MODELS_PATH}/clickbait_bert_model")

    return {
        "fake_news": (fake_news_tokenizer, fake_news_model),
        "bias": (bias_tokenizer, bias_model),
        "clickbait": (clickbait_tokenizer, clickbait_model),
    }


def predict_fake_news(text, tokenizer, model):
    inputs = tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=256)
    with torch.no_grad():
        outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)
    fake_prob = probs[0][0].item()
    real_prob = probs[0][1].item()
    return {"prediction": "Real" if real_prob > fake_prob else "Fake",
            "confidence": max(fake_prob, real_prob), "real_prob": real_prob}


def predict_bias(text, tokenizer, model):
    inputs = tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=256)
    with torch.no_grad():
        outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)
    biased_prob = probs[0][1].item()
    return {"prediction": "Biased" if biased_prob > 0.5 else "Non-biased", "bias_score": biased_prob}


def predict_clickbait(text, tokenizer, model):
    inputs = tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=64)
    with torch.no_grad():
        outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)
    clickbait_prob = probs[0][1].item()
    return {"prediction": "Clickbait" if clickbait_prob > 0.5 else "Not Clickbait", "clickbait_score": clickbait_prob}


def calculate_trust_score(headline, article_text, models):
    fake_tok, fake_model = models["fake_news"]
    bias_tok, bias_model = models["bias"]
    click_tok, click_model = models["clickbait"]

    fake_result = predict_fake_news(article_text, fake_tok, fake_model)
    bias_result = predict_bias(article_text, bias_tok, bias_model)
    clickbait_result = predict_clickbait(headline, click_tok, click_model)

    fake_news_score = fake_result["real_prob"] * 100
    bias_score = (1 - bias_result["bias_score"]) * 100
    clickbait_score = (1 - clickbait_result["clickbait_score"]) * 100

    trust_score = (fake_news_score * 0.5) + (bias_score * 0.3) + (clickbait_score * 0.2)

    if trust_score >= 70:
        risk_level, color = "Low Risk", "green"
    elif trust_score >= 40:
        risk_level, color = "Medium Risk", "orange"
    else:
        risk_level, color = "High Risk", "red"

    reasons = []
    if fake_result["prediction"] == "Fake":
        reasons.append("Content patterns match known fake news characteristics.")
    if bias_result["prediction"] == "Biased":
        reasons.append("Language shows signs of political or emotional bias.")
    if clickbait_result["prediction"] == "Clickbait":
        reasons.append("Headline uses sensational or clickbait-style language.")
    if not reasons:
        reasons.append("No major credibility red flags detected.")

    return {
        "trust_score": round(trust_score, 2), "risk_level": risk_level, "color": color,
        "fake_news": fake_result, "bias": bias_result, "clickbait": clickbait_result,
        "reasons": reasons,
    }


MODULES = [
    {"id": "fake_news", "icon": "🔍", "title": "Fake News Detection",
     "desc": "BERT-based Fake/Real classification", "status": "active",
     "detail": "Uses a fine-tuned BERT model trained on 44,000+ labeled news articles (ISOT dataset) to classify whether an article is fake or real, with a confidence score."},
    {"id": "source_cred", "icon": "🏛️", "title": "Source Credibility",
     "desc": "Publisher trust rating lookup", "status": "basic",
     "detail": "Cross-references the publisher domain against MBFC-style credibility and bias ratings to flag low-reliability sources."},
    {"id": "bias", "icon": "⚖️", "title": "Bias Detection",
     "desc": "Political & emotional bias analysis", "status": "active",
     "detail": "Trained on the MBIC dataset (1,500+ hand-labeled sentences) to detect politically or emotionally biased language in news text."},
    {"id": "clickbait", "icon": "🎣", "title": "Clickbait Detection",
     "desc": "Headline sensationalism check", "status": "active",
     "detail": "A DistilBERT model trained on 32,000 headlines identifies sensational, exaggerated, or misleading clickbait-style titles."},
    {"id": "cross_verify", "icon": "✅", "title": "Cross-Source Verification",
     "desc": "Compare claims with trusted sources", "status": "coming_soon",
     "detail": "Will compare a claim against live articles from Reuters, BBC, and PTI using a news API to check if it's independently verified."},
    {"id": "explainable", "icon": "💡", "title": "Explainable AI",
     "desc": "Why the AI made this decision", "status": "active",
     "detail": "Instead of a black-box label, this module surfaces plain-language reasons behind every prediction — low credibility, high bias, clickbait language, etc."},
    {"id": "multilingual", "icon": "🌐", "title": "Multilingual Analysis",
     "desc": "Tamil, Hindi, Malayalam support", "status": "coming_soon",
     "detail": "An XLM-RoBERTa model trained on Tamil and Malayalam offensive/misinformation datasets (60,000+ rows) — training in progress."},
    {"id": "propagation", "icon": "📈", "title": "News Propagation",
     "desc": "How news spreads across platforms", "status": "active",
     "detail": "Analyzes tweet-spread data from the FakeNewsNet dataset (23,000+ articles) to compare how fast and far fake vs real news spreads."},
    {"id": "realtime", "icon": "⚡", "title": "Real-Time Monitoring",
     "desc": "Live breaking news alerts", "status": "coming_soon",
     "detail": "Will continuously monitor trusted news feeds via NewsAPI and auto-analyze breaking news as it's published."},
]

CARD_TILT = ["-6deg", "3deg", "-3deg", "6deg", "-4deg", "4deg", "-5deg", "2deg", "-2deg"]
CARD_BG = ["#b8dcc0", "#eab8c8", "#b8cdf0", "#f0d98f", "#cbb3ea", "#a3ded3", "#e8b8a5", "#b3c2e3", "#d9c3a0"]
CARD_BORDER = ["#5fa876", "#d16b84", "#5a84c4", "#c99a2e", "#8b6bc9", "#4fa89a", "#c98060", "#5a6bc0", "#a68a5a"]

# Jewel-tone gradients for the dark-theme "Platform Highlights" carousel (start, end, accent border)
CARD_JEWEL = [
    ("#1e0a3c", "#6d28d9", "#a78bfa"),   # deep violet
    ("#0a1a4c", "#2563eb", "#60a5fa"),   # deep blue
    ("#3c0a4c", "#c026d3", "#e879f9"),   # magenta-purple
    ("#0a2e4c", "#0891b2", "#67e8f9"),   # teal-blue
    ("#4c0a2e", "#db2777", "#f472b6"),   # pink-red
    ("#1a0a4c", "#4338ca", "#818cf8"),   # indigo
    ("#0a3c2e", "#059669", "#5eead4"),   # emerald
    ("#3c2e0a", "#d97706", "#fbbf24"),   # amber
    ("#2e0a4c", "#7c3aed", "#c4b5fd"),   # violet-2
]

# ---------------- CSS ----------------
st.markdown("""
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
""", unsafe_allow_html=True)

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Lora:ital@0;1&display=swap');

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(18px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes cardEntrance {
    0% { opacity: 0; transform: translateY(40px) scale(0.85) rotate(-4deg); }
    60% { opacity: 1; transform: translateY(-6px) scale(1.02) rotate(1deg); }
    100% { opacity: 1; transform: translateY(0) scale(1) rotate(0deg); }
}

.stApp {
    background:
        radial-gradient(circle at 12% 65%, rgba(216, 27, 178, 0.55) 0%, transparent 45%),
        radial-gradient(circle at 88% 10%, rgba(37, 60, 230, 0.55) 0%, transparent 50%),
        linear-gradient(135deg, #0a0118 0%, #1a0933 30%, #2d0a5e 60%, #150730 100%);
    background-attachment: fixed;
    background-size: cover;
}
/* Global light-text fallback for the dark theme.
   NOTE: h1-h4 intentionally excluded here — card/step headings set their
   own dark color further down and must not be repainted light by this rule. */
.stApp, .stApp p, .stApp span, .stApp label, .stApp li,
.stApp .stMarkdown, .stApp div[data-testid="stMarkdownContainer"] {
    color: #f0eaff;
}


.navbar-brand {
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-size: 26px;
    letter-spacing: 1px;
    color: #ffffff;
    padding-top: 8px;
}
.navbar-brand span {
    font-family: 'Lora', serif;
    font-style: italic;
    font-weight: 400;
    font-size: 14px;
    color: #b9a6e0;
    margin-left: 10px;
}
.nav-user {
    font-family: 'Lora', serif;
    padding-top: 14px;
    text-align: right;
    font-size: 16px;
    color: #f0eaff;
}
.navbar-divider {
    border-bottom: 2px solid rgba(255,255,255,0.25);
    margin: 8px 0 24px 0;
}

.hero-wrap {
    text-align: center;
    padding: 10px 10px 10px 10px;
    margin-bottom: 24px;
    animation: fadeInUp 0.6s ease;
}
.stat-box {
    text-align: center;
    padding: 16px 10px;
    background: linear-gradient(135deg, #ffffff 0%, #f3eefc 100%);
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.5);
    margin-bottom: 30px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.25);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    animation: fadeInUp 0.8s ease;
}
.stat-box:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 22px rgba(155,127,255,0.35);
}
.stat-num {
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-size: 38px;
    color: #6d28d9;
}
.stat-label {
    font-family: 'Lora', serif;
    font-size: 17px;
    color: #555;
    margin-top: 4px;
}
.brand {
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-size: 28px;
    letter-spacing: 2px;
    color: #ffffff;
}
.brand-sub { font-family: 'Lora', serif; font-style: italic; color: #b9a6e0; font-size: 13px; }
.hero-title {
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-size: 52px;
    color: #ffffff;
    margin: 18px 0 6px 0;
}
.hero-sub {
    font-family: 'Lora', serif;
    font-style: italic;
    color: #cbbfe6;
    font-size: 21px;
    margin-bottom: 20px;
}
.section-title {
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-style: italic;
    font-size: 30px;
    text-align: center;
    color: #ffffff;
    margin-top: 30px;
    text-shadow: 0 2px 12px rgba(155,127,255,0.5);
}
.section-line {
    width: 60px; height: 3px; background: linear-gradient(90deg, #9b7fff, #d81bb2); margin: 8px auto 30px auto;
}

.card {
    background: var(--bgcolor, #eee);
    border-radius: 6px;
    padding: 22px 16px;
    text-align: center;
    box-shadow: 4px 6px 14px rgba(0,0,0,0.15);
    border: 1px solid rgba(0,0,0,0.06);
    height: 210px;
    transform: rotate(var(--tilt, 0deg));
    transition: transform 0.35s cubic-bezier(.25,.8,.25,1), box-shadow 0.35s ease;
    cursor: default;
    animation: fadeInUp 0.7s ease;
}
.card:hover {
    transform: rotate(0deg) translateY(-10px) scale(1.04);
    box-shadow: 8px 16px 32px rgba(0,0,0,0.28);
    z-index: 10;
    position: relative;
}
.card .icon {
    font-size: 26px;
    margin-bottom: 8px;
    transition: transform 0.35s ease;
}
.card:hover .icon { transform: scale(1.25) rotate(-8deg); }
.card h3 {
    font-family: 'Playfair Display', serif;
    font-size: 24px !important;
    font-weight: 800 !important;
    color: #1a1a1a !important;
    margin: 6px 0 8px 0;
    line-height: 1.25;
}
.card p { font-family: 'Lora', serif; font-size: 16px !important; color: #333 !important; margin-bottom: 6px; }
.badge {
    display: inline-block;
    padding: 3px 12px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 700;
    font-family: 'Lora', serif;
}
.badge-active { background: #1a1a1a; color: #faf6ea; box-shadow: 0 0 0 rgba(26,26,26,0.4); animation: pulseGlow 2.5s infinite; }
.badge-basic { background: #b08d3f; color: #faf6ea; }
.badge-soon { background: #ffffffaa; color: #555; border: 1px solid #999; }

@keyframes pulseGlow {
    0% { box-shadow: 0 0 0 0 rgba(26,26,26,0.25); }
    70% { box-shadow: 0 0 0 6px rgba(26,26,26,0); }
    100% { box-shadow: 0 0 0 0 rgba(26,26,26,0); }
}

.flat-card {
    background: linear-gradient(160deg, #ffffff 55%, var(--flatbg, #f5f5f5) 100%);
    border-radius: 6px;
    box-shadow: 0 3px 10px rgba(0,0,0,0.08);
    margin-bottom: 8px;
    overflow: hidden;
    height: 250px;
    border: 1.5px solid var(--flatborder, #e0e0e0) !important;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    animation: cardEntrance 0.7s cubic-bezier(.25,.8,.25,1) both;
}
.flat-card:nth-child(1) { animation-delay: 0.05s; }
.flat-card:hover {
    transform: translateY(-8px);
    box-shadow: 0 14px 28px rgba(79,95,174,0.25);
}
.flat-card-bar { height: 5px; }
.flat-card p { min-height: 34px; font-size: 16px !important; color: #333 !important; }
.flat-card .icon { font-size: 28px !important; margin-bottom: 4px; }
.flat-card h3 { font-size: 24px !important; font-weight: 800 !important; color: #1a1a1a !important; margin: 4px 0 8px 0 !important; line-height: 1.25; }

.step-card {
    background: linear-gradient(135deg, #ffffff 0%, #f0eafc 100%);
    border: 1px solid rgba(0,0,0,0.06);
    border-radius: 6px;
    padding: 20px 14px;
    text-align: center;
    height: 190px;
    transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
    animation: fadeInUp 0.7s ease;
}
.step-card:hover {
    transform: translateY(-6px);
    box-shadow: 0 12px 24px rgba(155,127,255,0.3);
    border-color: #9b7fff;
}
.step-circle {
    width: 40px; height: 40px;
    background: linear-gradient(135deg, #9b7fff, #d81bb2);
    color: white;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Playfair Display', serif;
    font-weight: 700;
    margin: 0 auto 12px auto;
    transition: transform 0.3s ease, background 0.3s ease;
}
.step-card:hover .step-circle { transform: scale(1.15); }
.step-card h3 { font-family: 'Playfair Display', serif; font-size: 18px; margin-bottom: 6px; color: #1a1a1a; }
.step-card p { font-family: 'Lora', serif; font-size: 14px; color: #444; }

.flow-step {
    background: linear-gradient(135deg, #ffffff 0%, #f3eefc 100%);
    border: 1px solid rgba(0,0,0,0.06);
    border-radius: 8px;
    padding: 16px 22px;
    display: flex;
    align-items: center;
    gap: 18px;
    box-shadow: 0 6px 16px rgba(0,0,0,0.12);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    animation: fadeInUp 0.6s ease;
}
.flow-step:hover { transform: translateX(6px); box-shadow: 0 8px 20px rgba(155,127,255,0.25); }
.flow-step h3 { font-family: 'Playfair Display', serif; font-size: 24px !important; font-weight: 800 !important; margin: 0 0 4px 0; color: #1a1a1a !important; }
.flow-step p { font-family: 'Lora', serif; font-size: 17px !important; color: #333 !important; margin: 0; }
.flow-num {
    min-width: 38px; height: 38px;
    background: linear-gradient(135deg, #9b7fff, #d81bb2);
    color: white;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Playfair Display', serif;
    font-weight: 700;
    font-size: 16px;
}
.highlight-step {
    background: linear-gradient(135deg, #f3eefc 0%, #fbe8f5 100%);
    border: 1.5px solid #9b7fff;
}
.flow-arrow {
    text-align: center;
    font-size: 22px;
    color: #b39dff;
    margin: 6px 0;
    animation: fadeIn 0.8s ease;
}
.module-chip {
    background: linear-gradient(135deg, #ffffff 0%, #f3eefc 100%);
    border: 1px solid rgba(0,0,0,0.06);
    border-radius: 8px;
    padding: 10px 4px;
    text-align: center;
    margin-top: 10px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.10);
    transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}
.module-chip:hover {
    transform: translateY(-4px) scale(1.06);
    box-shadow: 0 8px 16px rgba(155,127,255,0.3);
    border-color: #9b7fff;
}
.chip-label {
    font-family: 'Lora', serif;
    font-size: 14px;
    color: #333;
    margin-top: 4px;
    line-height: 1.25;
    font-weight: 600;
}

.cta-banner {
    background: linear-gradient(135deg, #7c3aed 0%, #d81bb2 50%, #4338ca 100%);
    border-radius: 10px;
    padding: 40px 20px;
    text-align: center;
    color: white;
    margin-top: 40px;
    animation: fadeIn 1s ease;
    box-shadow: 0 10px 30px rgba(155,127,255,0.4);
}
.cta-banner h2 { font-family: 'Playfair Display', serif; font-size: 28px; margin-bottom: 8px; color: #ffffff; }
.cta-banner p { font-family: 'Lora', serif; font-style: italic; opacity: 0.9; margin-bottom: 0; color: #ffffff; }

div[data-testid="stButton"] button {
    border-radius: 4px !important;
    border: 1.5px solid rgba(0,0,0,0.15) !important;
    background: linear-gradient(135deg, #ffffff 0%, #f0eafc 100%) !important;
    color: #1a1a1a !important;
    font-family: 'Lora', serif !important;
    font-weight: 800 !important;
    letter-spacing: 0.5px;
    box-shadow: 0 3px 10px rgba(0,0,0,0.15);
    transition: all 0.25s cubic-bezier(.25,.8,.25,1) !important;
}
div[data-testid="stButton"] button:hover {
    background: linear-gradient(135deg, #9b7fff, #d81bb2) !important;
    color: #ffffff !important;
    border-color: transparent !important;
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(155,127,255,0.45);
}
div[data-testid="stButton"] button:active { transform: translateY(0); }

div[data-testid="stButton"] button[kind="primary"] {
    background: linear-gradient(135deg, #9b7fff, #d81bb2) !important;
    color: white !important;
    font-weight: 800 !important;
    border: none !important;
    box-shadow: 0 4px 14px rgba(155,127,255,0.45) !important;
}
div[data-testid="stButton"] button[kind="primary"]:hover {
    background: linear-gradient(135deg, #b39dff, #ec4bce) !important;
    box-shadow: 0 8px 20px rgba(155,127,255,0.6) !important;
    transform: translateY(-3px) scale(1.02);
}

/* ---- Login button: smaller size, yellow-to-red gradient, white text, blue text-shadow ---- */
.st-key-nav_login button {
    background: linear-gradient(120deg, #ffd93d 0%, #ff512f 100%) !important;
    color: #ffffff !important;
    text-shadow: 1px 1px 4px #1e3a8a, 0 0 8px #1e3a8a !important;
    border: none !important;
    font-family: 'Playfair Display', serif !important;
    font-weight: 700 !important;
    font-style: italic !important;
    font-size: 13px !important;
    letter-spacing: 0.5px !important;
    padding: 4px 10px !important;
    min-height: 32px !important;
    box-shadow: 0 4px 14px rgba(255,81,47,0.4) !important;
    animation: btnPulse 3s ease-in-out infinite;
}
.st-key-nav_login button:hover {
    background: linear-gradient(120deg, #ffe066 0%, #ff6b47 100%) !important;
    transform: translateY(-3px) scale(1.05);
    box-shadow: 0 10px 24px rgba(255,81,47,0.55) !important;
}

/* ---- Signup button: gold-yellow-white gradient, white text, blue text-shadow ---- */
.st-key-nav_signup button {
    background: linear-gradient(120deg, #d4af37 0%, #ffe259 45%, #ffffff 100%) !important;
    color: #ffffff !important;
    text-shadow: 1px 1px 4px #1e3a8a, 0 0 8px #1e3a8a !important;
    border: none !important;
    font-family: 'Playfair Display', serif !important;
    font-weight: 700 !important;
    font-style: italic !important;
    font-size: 13px !important;
    letter-spacing: 0.5px !important;
    padding: 4px 10px !important;
    min-height: 32px !important;
    box-shadow: 0 4px 14px rgba(212,175,55,0.45) !important;
    animation: btnPulse 3s ease-in-out infinite 0.4s;
}
.st-key-nav_signup button:hover {
    background: linear-gradient(120deg, #e6c34a 0%, #fff08a 45%, #ffffff 100%) !important;
    transform: translateY(-3px) scale(1.05);
    box-shadow: 0 10px 24px rgba(212,175,55,0.6) !important;
}

@keyframes btnPulse {
    0%, 100% { box-shadow: 0 4px 14px rgba(255,81,47,0.35); }
    50% { box-shadow: 0 4px 22px rgba(255,81,47,0.6); }
}

/* ---- Native Streamlit inputs/metrics readable on dark background ---- */
.stApp input,
.stApp textarea,
.stApp div[data-testid="stTextInput"] input,
.stApp div[data-testid="stTextArea"] textarea,
.stTextInput input,
.stTextArea textarea {
    background-color: #ffffff !important;
    color: #1a1a1a !important;
    -webkit-text-fill-color: #1a1a1a !important;
    caret-color: #1a1a1a !important;
    font-size: 18px !important;
    border: 1px solid rgba(0,0,0,0.15) !important;
    border-radius: 6px !important;
}
.stApp input::placeholder, .stApp textarea::placeholder { color: #888 !important; font-size: 18px !important; }
.stApp input::selection, .stApp textarea::selection { background: #9b7fff !important; color: #ffffff !important; }
.stApp div[data-testid="stMetricValue"] { color: #ffffff !important; }
.stApp div[data-testid="stMetricLabel"] { color: #cfc4e8 !important; }
.stApp div[data-testid="stDataFrame"] { border-radius: 8px; overflow: hidden; }
.stApp code { color: #ec4bce !important; background: rgba(255,255,255,0.08) !important; }
</style>
""", unsafe_allow_html=True)


def render_login():
    st.button("← Back to Home", on_click=go_to, args=("home",))
    st.markdown('<div class="section-title">Login</div><div class="section-line"></div>', unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1, 1.2, 1])
    with col2:
        username = st.text_input("Username")
        password = st.text_input("Password", type="password")
        if st.button("Login", type="primary", use_container_width=True):
            if verify_user(username, password):
                st.session_state.logged_in = True
                st.session_state.username = username
                st.success(f"Welcome back, {username}!")
                go_to("home")
                st.rerun()
            else:
                st.error("Invalid username or password.")
        st.write("Don't have an account?")
        if st.button("Go to Signup", use_container_width=True):
            go_to("signup")
            st.rerun()


def render_signup():
    st.button("← Back to Home", on_click=go_to, args=("home",))
    st.markdown('<div class="section-title">Sign Up</div><div class="section-line"></div>', unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1, 1.2, 1])
    with col2:
        username = st.text_input("Choose a Username")
        email = st.text_input("Email")
        password = st.text_input("Choose a Password", type="password")
        confirm_password = st.text_input("Confirm Password", type="password")
        if st.button("Create Account", type="primary", use_container_width=True):
            if not username or not email or not password:
                st.warning("Please fill in all fields.")
            elif password != confirm_password:
                st.error("Passwords do not match.")
            elif len(password) < 6:
                st.error("Password must be at least 6 characters.")
            else:
                success, message = create_user(username, email, password)
                if success:
                    st.success(message + " Please login now.")
                    go_to("login")
                    st.rerun()
                else:
                    st.error(message)
        st.write("Already have an account?")
        if st.button("Go to Login", use_container_width=True):
            go_to("login")
            st.rerun()


def render_navbar():
    nav_l, nav_r = st.columns([4, 1.4])
    with nav_l:
        st.markdown('<div class="navbar-brand">📰 PURE PRESS <span>Daily Intelligence</span></div>', unsafe_allow_html=True)
    with nav_r:
        if st.session_state.logged_in:
            b1, b2 = st.columns(2)
            with b1:
                st.markdown(f'<div class="nav-user">👋 {st.session_state.username}</div>', unsafe_allow_html=True)
            with b2:
                if st.button("Logout", key="nav_logout", use_container_width=True):
                    st.session_state.logged_in = False
                    st.session_state.username = ""
                    st.rerun()
        else:
            b1, b2 = st.columns(2)
            with b1:
                if st.button("Login", key="nav_login", use_container_width=True):
                    go_to("login")
                    st.rerun()
            with b2:
                if st.button("Sign Up Free", key="nav_signup", use_container_width=True):
                    go_to("signup")
                    st.rerun()
    st.markdown('<div class="navbar-divider"></div>', unsafe_allow_html=True)


# ---------------- Carousel builder (real Bootstrap carousel, runs in isolated iframe so JS works) ----------------
def render_highlight_carousel():
    """Big carousel shown ABOVE 'Discover Our Features' - 3 modules per slide, linear-gradient card backgrounds."""
    per_slide = 3
    slides = [MODULES[i:i + per_slide] for i in range(0, len(MODULES), per_slide)]

    indicators_html = ""
    items_html = ""
    for idx, slide in enumerate(slides):
        active = "active" if idx == 0 else ""
        indicators_html += (
            f'<button type="button" data-bs-target="#highlightCarousel" '
            f'data-bs-slide-to="{idx}" class="{active}" '
            f'aria-current="{"true" if idx == 0 else "false"}" aria-label="Slide {idx+1}"></button>'
        )

        cards_html = ""
        for i, mod in enumerate(slide):
            pos = idx * per_slide + i
            start, end, accent = CARD_JEWEL[pos % len(CARD_JEWEL)]
            badge_text = {"active": "✅ Active", "basic": "🟡 Basic", "coming_soon": "🔜 Coming Soon"}[mod["status"]]
            cards_html += f"""
            <div class="col-md-4 col-12 hl-col">
                <div class="hl-card" style="background:linear-gradient(150deg, {start} 0%, {end} 100%); border-color:{accent};">
                    <div class="hl-icon">{mod['icon']}</div>
                    <h2>{mod['title']}</h2>
                    <p>{mod['desc']}</p>
                    <span class="hl-badge" style="border-color:{accent}; color:{accent};">{badge_text}</span>
                </div>
            </div>
            """
        items_html += f'<div class="carousel-item {active}"><div class="row justify-content-center g-4 px-4">{cards_html}</div></div>'

    html_code = f"""
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Lora:ital@0;1&display=swap');
        html, body {{
            margin: 0; padding: 0 14px;
            background: transparent;
            font-family: 'Lora', serif;
        }}
        .hl-col {{ padding-left: 14px; padding-right: 14px; margin-bottom: 12px; }}
        .hl-card {{
            border-radius: 16px;
            border: 2.5px solid;
            padding: 30px 18px;
            text-align: center;
            min-height: 250px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 26px rgba(0,0,0,0.4);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }}
        .hl-card:hover {{
            transform: translateY(-8px) scale(1.02);
            box-shadow: 0 18px 36px rgba(0,0,0,0.5);
        }}
        .hl-icon {{ font-size: 44px; margin-bottom: 10px; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.4)); }}
        .hl-card h2 {{
            font-family: 'Playfair Display', serif;
            font-weight: 800;
            font-style: italic;
            font-size: 22px;
            margin: 0 0 8px 0;
            color: #ffffff;
        }}
        .hl-card p {{
            font-size: 15px;
            color: #e8e0f8;
            margin: 0 0 14px 0;
        }}
        .hl-badge {{
            display: inline-block;
            padding: 4px 14px;
            border-radius: 20px;
            border: 1.5px solid;
            font-size: 13px;
            font-weight: 700;
            font-family: 'Lora', serif;
            background: rgba(255,255,255,0.12);
        }}
        #highlightCarousel {{ padding-bottom: 14px; }}
        .carousel-control-prev, .carousel-control-next {{ width: 6%; }}
        .carousel-control-prev-icon, .carousel-control-next-icon {{
            background-color: rgba(255,255,255,0.9);
            border-radius: 50%;
            padding: 16px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.4);
            filter: invert(1);
        }}
        .carousel-indicators {{ margin-bottom: -8px; }}
        .carousel-indicators [data-bs-target] {{
            background-color: #b39dff;
            width: 9px; height: 9px;
            border-radius: 50%;
        }}
    </style>

    <div id="highlightCarousel" class="carousel slide" data-bs-ride="carousel" data-bs-interval="2800">
        <div class="carousel-indicators">{indicators_html}</div>
        <div class="carousel-inner">{items_html}</div>
        <button class="carousel-control-prev" type="button" data-bs-target="#highlightCarousel" data-bs-slide="prev">
            <span class="carousel-control-prev-icon" aria-hidden="true"></span>
        </button>
        <button class="carousel-control-next" type="button" data-bs-target="#highlightCarousel" data-bs-slide="next">
            <span class="carousel-control-next-icon" aria-hidden="true"></span>
        </button>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    """
    components.html(html_code, height=400, scrolling=False)


# ---------------- Testimonials carousel (second carousel for extra "real website" feel) ----------------
def render_testimonials_carousel():
    testimonials = [
        {"name": "Priya R.", "role": "Journalism Student", "quote": "Helped me double-check sources before submitting my reports.", "emoji": "🎓"},
        {"name": "Nandhini", "role": "Daily Reader", "quote": "The trust score makes it so easy to spot sketchy headlines.", "emoji": "📰"},
        {"name": "Meena S.", "role": "Content Moderator", "quote": "Bias detection is surprisingly accurate for regional news too.", "emoji": "🛡️"},
    ]
    items_html = ""
    for idx, t in enumerate(testimonials):
        active = "active" if idx == 0 else ""
        items_html += f"""
        <div class="carousel-item {active}">
            <div class="testi-card">
                <div class="t-emoji">{t['emoji']}</div>
                <p class="t-quote">"{t['quote']}"</p>
                <p class="t-name">{t['name']} <span>· {t['role']}</span></p>
            </div>
        </div>
        """

    html_code = f"""
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Lora:ital@0;1&display=swap');
        html, body {{ margin:0; padding:0 10px; background:transparent; }}
        .testi-card {{
            max-width: 560px;
            margin: 0 auto;
            text-align: center;
            padding: 30px 20px;
            background: linear-gradient(135deg, #ffffff 0%, #f3eefc 100%);
            border-radius: 14px;
            border: 1px solid rgba(0,0,0,0.06);
            box-shadow: 0 8px 22px rgba(0,0,0,0.20);
        }}
        .t-emoji {{ font-size: 30px; margin-bottom: 10px; }}
        .t-quote {{
            font-family: 'Lora', serif;
            font-style: italic;
            font-size: 17px;
            color: #333333;
            margin-bottom: 12px;
        }}
        .t-name {{
            font-family: 'Playfair Display', serif;
            font-weight: 700;
            font-size: 16px;
            color: #1a1a1a;
            margin: 0;
        }}
        .t-name span {{
            font-family: 'Lora', serif;
            font-weight: 400;
            font-style: italic;
            color: #6d28d9;
            font-size: 14px;
        }}
        .carousel-indicators [data-bs-target] {{
            background-color: #b39dff;
            width: 8px; height: 8px;
            border-radius: 50%;
        }}
    </style>
    <div id="testiCarousel" class="carousel slide" data-bs-ride="carousel" data-bs-interval="3500">
        <div class="carousel-inner">{items_html}</div>
        <div class="carousel-indicators" style="position:static; margin-top:16px;">
            {''.join(f'<button type="button" data-bs-target="#testiCarousel" data-bs-slide-to="{i}" class="{"active" if i==0 else ""}"></button>' for i in range(len(testimonials)))}
        </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    """
    components.html(html_code, height=260, scrolling=False)


def render_home():
    st.markdown("""
    <div class="hero-wrap">
        <div class="hero-title">Smart News Trust Analysis</div>
        <div class="hero-sub">AI-powered credibility scoring, bias detection, and trust scoring for the modern reader</div>
    </div>
    """, unsafe_allow_html=True)

    stat_cols = st.columns(4)
    stats = [
        ("99.96%", "Fake News Accuracy"),
        ("5", "AI Models Trained"),
        ("140K+", "Training Articles"),
        ("4", "Languages Supported"),
    ]
    for i, (num, label) in enumerate(stats):
        with stat_cols[i]:
            st.markdown(f"""
            <div class="stat-box shadow rounded-4">
                <div class="stat-num">{num}</div>
                <div class="stat-label">{label}</div>
            </div>
            """, unsafe_allow_html=True)

    # ---- Section 0 (NEW): Big auto-sliding highlight carousel, ABOVE Discover Our Features ----
    st.markdown('<div class="section-title">Platform Highlights</div><div class="section-line"></div>', unsafe_allow_html=True)
    render_highlight_carousel()

    # ---- Section 1: Discover Our Features -> original static tilted showcase ----
    st.markdown('<div class="section-title" style="margin-top:50px;">Discover Our Features</div><div class="section-line"></div>', unsafe_allow_html=True)

    showcase = MODULES[:5]
    show_cols = st.columns(5)
    for i, mod in enumerate(showcase):
        with show_cols[i]:
            tilt = CARD_TILT[i % len(CARD_TILT)]
            bg = CARD_BG[i % len(CARD_BG)]
            st.markdown(f"""
            <div class="card shadow-lg rounded-3 border-0" style="--tilt:{tilt}; --bgcolor:{bg}; height:250px; margin-top:{20 if i%2==0 else 0}px;">
                <div class="icon">{mod['icon']}</div>
                <h3 style="color:#1a1a1a !important; font-weight:800 !important; font-size:24px !important;">{mod['title']}</h3>
                <p>{mod['desc']}</p>
            </div>
            """, unsafe_allow_html=True)

    # ---- Section 2: Flat functional cards ----
    st.markdown('<div class="section-title" style="margin-top:50px;">Explore All Modules</div><div class="section-line"></div>', unsafe_allow_html=True)

    cols = st.columns(4)
    for i, mod in enumerate(MODULES):
        with cols[i % 4]:
            badge_class = {"active": "badge-active", "basic": "badge-basic", "coming_soon": "badge-soon"}[mod["status"]]
            badge_text = {"active": "Active", "basic": "Basic", "coming_soon": "Coming Soon"}[mod["status"]]
            bs_badge = {"active": "badge rounded-pill bg-dark", "basic": "badge rounded-pill bg-warning text-dark", "coming_soon": "badge rounded-pill bg-light text-secondary border"}[mod["status"]]
            bg = CARD_BG[i % len(CARD_BG)]
            border_color = CARD_BORDER[i % len(CARD_BORDER)]
            st.markdown(f"""
            <div class="card shadow-lg border-0 rounded-4 flat-card" style="--flatbg:{bg}; --flatborder:{border_color};">
                <div class="flat-card-bar" style="background:linear-gradient(90deg, {border_color}, {bg});"></div>
                <div class="card-body" style="padding:14px 16px;">
                    <div class="icon" style="font-size:26px;">{mod['icon']}</div>
                    <h3 class="card-title" style="text-align:left; color:#1a1a1a !important; font-weight:800 !important; font-size:24px !important;">{mod['title']}</h3>
                    <p class="card-text" style="text-align:left;">{mod['desc']}</p>
                    <div style="margin-top:6px;"><span class="{bs_badge}">{badge_text}</span></div>
                </div>
            </div>
            """, unsafe_allow_html=True)
            if st.button("Learn More →", key=f"btn_{mod['id']}", use_container_width=True):
                go_to(mod["id"])
                st.rerun()

    # ---- Section 3: How It Works ----
    st.markdown('<div class="section-title" style="margin-top:60px;">How It Works</div><div class="section-line"></div>', unsafe_allow_html=True)

    st.markdown("""
    <div class="flow-step">
        <div class="flow-num">1</div>
        <div>
            <h3 style="color:#1a1a1a !important; font-weight:800 !important; font-size:24px !important;">Submit Article</h3>
            <p>User pastes a news headline and article text (any of 4 languages)</p>
        </div>
    </div>
    <div class="flow-arrow">↓</div>
    """, unsafe_allow_html=True)

    st.markdown("""
    <div class="flow-step">
        <div class="flow-num">2</div>
        <div>
            <h3 style="color:#1a1a1a !important; font-weight:800 !important; font-size:24px !important;">9 AI Modules Analyze in Parallel</h3>
            <p>Every module independently scores the article</p>
        </div>
    </div>
    """, unsafe_allow_html=True)

    chip_cols = st.columns(9)
    for i, mod in enumerate(MODULES):
        with chip_cols[i]:
            st.markdown(f"""
            <div class="module-chip">
                <div style="font-size:18px;">{mod['icon']}</div>
                <div class="chip-label">{mod['title']}</div>
            </div>
            """, unsafe_allow_html=True)

    st.markdown('<div class="flow-arrow">↓</div>', unsafe_allow_html=True)

    st.markdown("""
    <div class="flow-step highlight-step">
        <div class="flow-num">3</div>
        <div>
            <h3 style="color:#1a1a1a !important; font-weight:800 !important; font-size:24px !important;">Trust Score Engine</h3>
            <p>Combines Fake News + Bias + Clickbait + Source + Verification results into one weighted 0–100 score</p>
        </div>
    </div>
    <div class="flow-arrow">↓</div>
    """, unsafe_allow_html=True)

    st.markdown("""
    <div class="flow-step">
        <div class="flow-num">4</div>
        <div>
            <h3 style="color:#1a1a1a !important; font-weight:800 !important; font-size:24px !important;">Get Your Report</h3>
            <p>Trust Score, Risk Level, and plain-language Explainable AI reasons — all on one dashboard</p>
        </div>
    </div>
    """, unsafe_allow_html=True)

    # ---- Section 4: What Readers Say -> testimonials carousel ----
    st.markdown('<div class="section-title" style="margin-top:60px;">What Readers Say</div><div class="section-line"></div>', unsafe_allow_html=True)
    render_testimonials_carousel()

    # ---- Section 5: CTA banner ----
    st.markdown("""
    <div class="cta-banner">
        <h2>Try The Trust Checker Now</h2>
        <p>Paste any news article and get an instant AI-powered credibility report</p>
    </div>
    """, unsafe_allow_html=True)
    cta_cols = st.columns([1, 1, 1])
    with cta_cols[1]:
        if st.button("🔍 Start Analyzing →", key="cta_button", use_container_width=True, type="primary"):
            go_to("fake_news")
            st.rerun()


def render_module_header(mod):
    st.button("← Back to Home", on_click=go_to, args=("home",))
    st.markdown(f"""
    <h1 style="font-family:'Playfair Display', serif; color:#ffffff;">{mod['icon']} {mod['title']}</h1>
    <p style="font-family:'Lora', serif; font-style:italic; color:#cbbfe6; font-size:17px;">{mod['detail']}</p>
    <hr style="border-color:rgba(255,255,255,0.25);">
    """, unsafe_allow_html=True)


def render_trust_check(mod):
    render_module_header(mod)

    with st.spinner("Loading AI models..."):
        models = load_models()

    headline = st.text_input("News Headline", placeholder="e.g. Scientists Discover New Planet")
    article_text = st.text_area("Article Text", height=200, placeholder="Paste the full news article here...")

    if st.button("Check Trust Score", type="primary"):
        if not headline or not article_text:
            st.warning("Please enter both a headline and article text.")
        else:
            with st.spinner("Analyzing..."):
                full_text = headline + " " + article_text
                result = calculate_trust_score(headline, full_text, models)

            st.markdown("---")
            col1, col2 = st.columns(2)
            with col1:
                st.metric("Trust Score", f"{result['trust_score']}/100")
            with col2:
                st.markdown(f"### :{result['color']}[{result['risk_level']}]")
            st.progress(result["trust_score"] / 100)

            c1, c2, c3 = st.columns(3)
            with c1:
                st.write("**Fake News**")
                st.write(f"`{result['fake_news']['prediction']}` ({result['fake_news']['confidence']:.1%})")
            with c2:
                st.write("**Bias**")
                st.write(f"`{result['bias']['prediction']}` ({result['bias']['bias_score']:.1%})")
            with c3:
                st.write("**Clickbait**")
                st.write(f"`{result['clickbait']['prediction']}` ({result['clickbait']['clickbait_score']:.1%})")

            st.markdown("### 💡 Explainable AI — Why this result?")
            for r in result["reasons"]:
                st.write(f"- {r}")


def render_propagation(mod):
    render_module_header(mod)
    try:
        df = pd.read_csv("datasets/08_News_Propagation/propagation_analysis.csv")
        st.write("Average spread (tweet count) comparison: Fake vs Real news")
        chart_data = df.groupby("label")["tweet_count"].mean().reset_index()
        st.bar_chart(chart_data.set_index("label"))
        st.write("Breakdown by source:")
        st.dataframe(df.groupby(["source", "label"])["tweet_count"].mean().reset_index())
    except FileNotFoundError:
        st.error("Propagation analysis file not found.")


def render_placeholder(mod):
    render_module_header(mod)
    st.info("This module is coming soon and will be added as the project progresses.")


MODULE_MAP = {m["id"]: m for m in MODULES}
page = st.session_state.page

render_navbar()

if page == "home":
    render_home()
elif page == "login":
    render_login()
elif page == "signup":
    render_signup()
elif page in ["fake_news", "bias", "clickbait", "explainable"]:
    render_trust_check(MODULE_MAP[page])
elif page == "propagation":
    render_propagation(MODULE_MAP[page])
elif page in ["source_cred", "cross_verify", "multilingual", "realtime"]:
    render_placeholder(MODULE_MAP[page])