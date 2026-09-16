"""
AI-Powered News Trust and Credibility Analysis Platform
Full Streamlit Web App - Newspaper themed, 9-module dashboard
"""

from dotenv import load_dotenv
import os

load_dotenv()

import streamlit as st
import streamlit.components.v1 as components
import torch
import pandas as pd
import sqlite3
import hashlib
import io
import os
import requests
import html as html_lib
from datetime import datetime
from urllib.parse import urlparse
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# ---- New: PDF text extraction ----
from pypdf import PdfReader

# ---- New: Image OCR ----
from PIL import Image
import pytesseract

# On Windows, pytesseract needs the exact path to tesseract.exe unless it's
# on your PATH. Uncomment and edit the line below after installing Tesseract
# (default install location shown):
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# ---- New: Downloadable PDF trust report ----
from io import BytesIO
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

# ---- New: Score breakdown charts ----
import matplotlib.pyplot as plt

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
    # ---- New: Analysis History table ----
    c.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            module TEXT NOT NULL,
            headline TEXT,
            trust_score REAL,
            risk_level TEXT,
            checked_at TEXT
        )
    """)
    conn.commit()
    conn.close()

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


# ---- New: Analysis History helpers ----
def save_history(username, module, headline, trust_score, risk_level):
    if not username:
        return
    conn = sqlite3.connect("users.db")
    c = conn.cursor()
    c.execute(
        "INSERT INTO history (username, module, headline, trust_score, risk_level, checked_at) VALUES (?, ?, ?, ?, ?, ?)",
        (username, module, headline, trust_score, risk_level, datetime.now().strftime("%Y-%m-%d %H:%M")),
    )
    conn.commit()
    conn.close()


def get_history(username):
    conn = sqlite3.connect("users.db")
    c = conn.cursor()
    c.execute(
        "SELECT module, headline, trust_score, risk_level, checked_at FROM history WHERE username = ? ORDER BY id DESC",
        (username,),
    )
    rows = c.fetchall()
    conn.close()
    return rows

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

    # ---- New: Multilingual (Tamil + Malayalam offensive/misinformation) model ----
    # Loaded defensively: if step4_train_multilingual.py hasn't been run yet,
    # the rest of the app keeps working — the Multilingual module just shows
    # a "not trained yet" message instead of crashing the whole dashboard.
    multilingual_tokenizer, multilingual_model = None, None
    try:
        multilingual_tokenizer = AutoTokenizer.from_pretrained(f"{MODELS_PATH}/multilingual_bert_model")
        multilingual_model = AutoModelForSequenceClassification.from_pretrained(f"{MODELS_PATH}/multilingual_bert_model")
    except OSError:
        pass  # model not trained/saved yet — handled in render_multilingual()

    return {
        "fake_news": (fake_news_tokenizer, fake_news_model),
        "bias": (bias_tokenizer, bias_model),
        "clickbait": (clickbait_tokenizer, clickbait_model),
        "multilingual": (multilingual_tokenizer, multilingual_model),
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


def predict_clickbait(headline, tokenizer, model):
    """
    Binary classification on the headline text: index 0 = Not Clickbait,
    index 1 = Clickbait (same convention as predict_fake_news/predict_bias).
    """
    inputs = tokenizer(headline, return_tensors="pt", truncation=True, padding=True, max_length=128)
    with torch.no_grad():
        outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)
    clickbait_prob = probs[0][1].item()
    return {
        "prediction": "Clickbait" if clickbait_prob > 0.5 else "Not Clickbait",
        "clickbait_score": clickbait_prob,
    }

def predict_multilingual(text, tokenizer, model):
    """
    Binary classification on Tamil/Malayalam text: 0 = Not_offensive, 1 = Offensive.
    Trained via step4_train_multilingual.py on the combined DravidianCodeMix
    Tamil + Malayalam dataset (cleaned_multilingual.csv).
    """
    inputs = tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=128)
    with torch.no_grad():
        outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)
    offensive_prob = probs[0][1].item()
    return {
        "prediction": "Offensive / Suspicious" if offensive_prob > 0.5 else "Not Offensive",
        "offensive_score": offensive_prob,
        "trust_score": round((1 - offensive_prob) * 100, 2),
    }


def detect_dravidian_language(text):
    """
    Lightweight script-based language hint (no external API/dependency needed).
    Tamil and Malayalam occupy distinct Unicode blocks, so this is reliable
    for telling them apart even in code-mixed (Tanglish/Manglish) text.
    """
    tamil_chars = sum(1 for ch in text if "\u0B80" <= ch <= "\u0BFF")
    malayalam_chars = sum(1 for ch in text if "\u0D00" <= ch <= "\u0D7F")
    if tamil_chars == 0 and malayalam_chars == 0:
        return "English / Other (Latin script)"
    return "Tamil" if tamil_chars >= malayalam_chars else "Malayalam" 


# =====================================================================
# NEW: Source Credibility — hardcoded publisher reputation lookup
# (no model needed; simple dictionary of known domains)
# =====================================================================

SOURCE_REPUTATION = {
    # ---- High credibility: established wire services / mainstream outlets ----
    "reuters.com": ("High", 92, "International wire service with strict editorial and fact-checking standards."),
    "apnews.com": ("High", 92, "Associated Press — long-standing wire service with a strong accuracy record."),
    "bbc.com": ("High", 90, "Publicly funded broadcaster with an established editorial code."),
    "thehindu.com": ("High", 85, "Long-established Indian national daily with a strong editorial desk."),
    "pib.gov.in": ("High", 90, "Official Government of India press release portal."),
    "thehindubusinessline.com": ("High", 82, "Business desk of a long-established Indian national daily."),
    "ndtv.com": ("Medium", 68, "Mainstream Indian news broadcaster; generally reliable, occasional bias criticism."),
    "indiatoday.in": ("Medium", 65, "Mainstream Indian news outlet; mixed reader-reported bias ratings."),
    "timesofindia.indiatimes.com": ("Medium", 62, "High-circulation Indian daily; known for some clickbait-style headlines."),
    "indianexpress.com": ("Medium", 70, "Mainstream Indian daily with a generally solid accuracy record."),
    # ---- Known low-reliability / satire domains (illustrative examples) ----
    "theonion.com": ("Satire", 20, "Satirical publication — not intended to be read as factual news."),
    "infowars.com": ("Low", 12, "Repeatedly fact-checked and found to publish false or misleading claims."),
    "beforeitsnews.com": ("Low", 10, "User-submitted content site with minimal editorial oversight."),
    "naturalnews.com": ("Low", 15, "Frequently flagged by fact-checkers for pseudo-scientific health claims."),
}


def normalize_domain(raw):
    """Turns a full URL or a bare domain into a clean 'example.com' string."""
    raw = (raw or "").strip().lower()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "https://" + raw
    netloc = urlparse(raw).netloc
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return netloc


def lookup_source_credibility(raw_input):
    """Looks a domain up in the SOURCE_REPUTATION dictionary."""
    domain = normalize_domain(raw_input)
    if not domain:
        return None
    if domain in SOURCE_REPUTATION:
        label, score, note = SOURCE_REPUTATION[domain]
        return {"domain": domain, "found": True, "label": label, "score": score, "note": note}
    return {
        "domain": domain,
        "found": False,
        "label": "Unknown",
        "score": 50,
        "note": "This domain isn't in our reputation database yet. Treat with normal caution and verify independently.",
    }


def calculate_trust_score(headline, article_text, models, source_domain=None):
    fake_tok, fake_model = models["fake_news"]
    bias_tok, bias_model = models["bias"]
    click_tok, click_model = models["clickbait"]

    fake_result = predict_fake_news(article_text, fake_tok, fake_model)
    bias_result = predict_bias(article_text, bias_tok, bias_model)
    clickbait_result = predict_clickbait(headline, click_tok, click_model)

    fake_news_score = fake_result["real_prob"] * 100
    bias_score = (1 - bias_result["bias_score"]) * 100
    clickbait_score = (1 - clickbait_result["clickbait_score"]) * 100

    # ---- New: fold in Source Credibility if a publisher domain was provided ----
    source_result = lookup_source_credibility(source_domain) if source_domain else None

    if source_result:
        weights = {"fake_news": 0.40, "bias": 0.25, "clickbait": 0.15, "source": 0.20}
        trust_score = (
            fake_news_score * weights["fake_news"]
            + bias_score * weights["bias"]
            + clickbait_score * weights["clickbait"]
            + source_result["score"] * weights["source"]
        )
    else:
        weights = {"fake_news": 0.50, "bias": 0.30, "clickbait": 0.20}
        trust_score = (fake_news_score * weights["fake_news"]) + (bias_score * weights["bias"]) + (clickbait_score * weights["clickbait"])

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
    if source_result and source_result["found"] and source_result["label"] in ("Low", "Satire"):
        reasons.append(f"Publisher domain ({source_result['domain']}) has a history of low reliability.")
    if not reasons:
        reasons.append("No major credibility red flags detected.")

    return {
        "trust_score": round(trust_score, 2), "risk_level": risk_level, "color": color,
        "fake_news": fake_result, "bias": bias_result, "clickbait": clickbait_result,
        "source": source_result, "weights": weights,
        "category_scores": {"fake_news": fake_news_score, "bias": bias_score, "clickbait": clickbait_score,
                             **({"source": source_result["score"]} if source_result else {})},
        "reasons": reasons,
    }


# =====================================================================
# NEW: Downloadable PDF Trust Report
# =====================================================================

def generate_trust_report_pdf(headline, article_text, result):
    """Builds a one-page PDF summary of a trust check, returned as a BytesIO buffer."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph("Pure Press — Trust Score Report", styles["Title"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", styles["Normal"]))
    story.append(Spacer(1, 16))

    story.append(Paragraph(f"<b>Headline:</b> {headline}", styles["Normal"]))
    story.append(Spacer(1, 8))
    snippet = article_text.strip()
    if len(snippet) > 700:
        snippet = snippet[:700] + " ..."
    story.append(Paragraph(f"<b>Article excerpt:</b> {snippet}", styles["Normal"]))
    story.append(Spacer(1, 18))

    story.append(Paragraph(f"<b>Trust Score:</b> {result['trust_score']} / 100", styles["Heading2"]))
    story.append(Paragraph(f"<b>Risk Level:</b> {result['risk_level']}", styles["Heading2"]))
    story.append(Spacer(1, 14))

    table_data = [
        ["Module", "Prediction", "Confidence"],
        ["Fake News", result["fake_news"]["prediction"], f"{result['fake_news']['confidence']:.1%}"],
        ["Bias", result["bias"]["prediction"], f"{result['bias']['bias_score']:.1%}"],
        ["Clickbait", result["clickbait"]["prediction"], f"{result['clickbait']['clickbait_score']:.1%}"],
    ]
    if result.get("source"):
        table_data.append(["Source Credibility", result["source"]["label"], f"{result['source']['score']}/100"])

    table = Table(table_data, hAlign="LEFT", colWidths=[160, 160, 120])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6d28d9")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(table)
    story.append(Spacer(1, 18))

    story.append(Paragraph("Explainable AI — Why this result", styles["Heading3"]))
    for r in result["reasons"]:
        story.append(Paragraph(f"• {r}", styles["Normal"]))

    doc.build(story)
    buffer.seek(0)
    return buffer


# =====================================================================
# NEW: Visual score-breakdown charts (donut + bar)
# =====================================================================

def render_score_charts(result):
    """Renders a donut chart (weighted contribution) and a bar chart (raw scores)."""
    cat_scores = result["category_scores"]
    weights = result["weights"]

    label_map = {"fake_news": "Fake News", "bias": "Bias", "clickbait": "Clickbait", "source": "Source"}
    color_map = {"fake_news": "#6d28d9", "bias": "#2563eb", "clickbait": "#db2777", "source": "#059669"}

    labels = [label_map[k] for k in cat_scores]
    raw_values = [cat_scores[k] for k in cat_scores]
    contributions = [cat_scores[k] * weights[k] for k in cat_scores]
    chart_colors = [color_map[k] for k in cat_scores]

    col1, col2 = st.columns(2)

    with col1:
        fig1, ax1 = plt.subplots(figsize=(4, 4))
        ax1.pie(
            contributions, labels=labels, autopct="%1.0f%%",
            colors=chart_colors, wedgeprops={"width": 0.42, "edgecolor": "white"},
        )
        ax1.set_title("How Each Module Contributed\nto the Trust Score")
        st.pyplot(fig1)

    with col2:
        fig2, ax2 = plt.subplots(figsize=(4, 4))
        ax2.barh(labels, raw_values, color=chart_colors)
        ax2.set_xlim(0, 100)
        ax2.set_xlabel("Score (0–100, higher = more trustworthy)")
        ax2.set_title("Raw Score per Category")
        for i, v in enumerate(raw_values):
            ax2.text(v + 1.5, i, f"{v:.0f}", va="center", fontsize=9)
        st.pyplot(fig2)


# =====================================================================
# NEW: Text extraction helpers for PDF and Image uploads
# =====================================================================

def extract_text_from_pdf(uploaded_file):
    """
    Extracts text from an uploaded PDF file.
    Works for text-based PDFs (most news articles saved/printed as PDF).
    Returns "" if nothing could be extracted (e.g. a pure scanned image PDF
    with no OCR layer) so the caller can show a helpful message.
    """
    try:
        uploaded_file.seek(0)
        reader = PdfReader(uploaded_file)
        pages_text = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            pages_text.append(page_text)
        return "\n".join(pages_text).strip()
    except Exception as e:
        st.error(f"Could not read this PDF: {e}")
        return ""


def extract_text_from_image(uploaded_file):
    """
    Extracts text from an uploaded image (screenshot of an article, photo
    of a newspaper clipping, etc.) using Tesseract OCR.
    Tries English first; if very little text is found, also tries
    English+Tamil combined (needs the 'tam' language pack installed
    alongside tesseract-ocr, e.g. `apt install tesseract-ocr-tam`).
    """
    try:
        uploaded_file.seek(0)
        image = Image.open(uploaded_file).convert("RGB")

        text = pytesseract.image_to_string(image, lang="eng").strip()

        if len(text) < 15:
            try:
                text_multi = pytesseract.image_to_string(image, lang="eng+tam").strip()
                if len(text_multi) > len(text):
                    text = text_multi
            except Exception:
                pass  # 'tam' language pack not installed — fall back to English-only result

        return text.strip()
    except Exception as e:
        st.error(f"Could not read text from this image: {e}")
        return ""


def get_article_text_from_input(input_mode, headline_input, text_input, pdf_file, image_file):
    """
    Central dispatcher: given the chosen input mode and whichever
    widget the user actually filled in, returns (headline, article_text).
    Keeps render_trust_check() clean regardless of source type.
    """
    if input_mode == "📝 Paste Text":
        return headline_input, text_input

    elif input_mode == "📄 Upload PDF":
        if pdf_file is None:
            return headline_input, ""
        with st.spinner("Extracting text from PDF..."):
            extracted = extract_text_from_pdf(pdf_file)
        if not extracted:
            st.warning(
                "No selectable text was found in this PDF. It may be a scanned "
                "image PDF — try re-exporting it, or upload it as an image instead."
            )
        return headline_input, extracted

    elif input_mode == "🖼️ Upload Image":
        if image_file is None:
            return headline_input, ""
        with st.spinner("Running OCR on image..."):
            extracted = extract_text_from_image(image_file)
        if not extracted:
            st.warning(
                "No text could be detected in this image. Try a clearer, "
                "higher-resolution screenshot or photo."
            )
        return headline_input, extracted

    return headline_input, ""

# =====================================================================
# NEW: Live News Feed (NewsAPI) — categorized real-time headlines shown
# on both the public Welcome page and the logged-in Home page.
# =====================================================================

NEWSDATA_API_KEY = os.getenv("NEWSDATA_API_KEY", "")  # set as an environment variable — never hardcode a real key here
NEWSDATA_BASE_URL = "https://newsdata.io/api/1/latest"

# NOTE: NewsData.io's own category list does NOT include "general" — the
# closest equivalent is "top" (their top/general headlines category).
# Passing category="general" silently returns zero articles, which is why
# that tab used to be empty.
NEWS_CATEGORIES = [
    ("top", "🗞️ General"),
    ("business", "💼 Business"),
    ("sports", "🏆 Sports"),
    ("technology", "💻 Technology"),
    ("entertainment", "🎬 Entertainment"),
    ("health", "🩺 Health"),
    ("science", "🔬 Science"),
]

# language toggle for the news feed — "en" for English-language India news,
# "ta" for Tamil-language news (both filtered to country=in via NewsData.io)
NEWS_LANGUAGE_OPTIONS = [("en", "English"), ("ta", "தமிழ் (Tamil)")]

# Target number of articles per category tab. NewsData.io returns ~10
# articles per page, so we page through "nextPage" until we hit this
# target (or run out of pages) to comfortably fill a 4-column grid.
TARGET_ARTICLES_PER_CATEGORY = 24
MAX_PAGES_PER_CATEGORY = 3  # safety cap so we don't burn the daily quota


@st.cache_data(ttl=900, show_spinner=False)  # cache 15 min — respects NewsData.io free-tier rate limits
def fetch_live_news(category="top", country="in", language="en", target_count=TARGET_ARTICLES_PER_CATEGORY):
    """
    Fetches live news for one category from NewsData.io, filtered to India
    (country='in') and a chosen language (English or Tamil). Tamil articles
    are pulled from Tamil-language Indian outlets — this is what actually
    surfaces Tamil Nadu-relevant coverage, unlike a generic country filter.

    Pages through NewsData.io's "nextPage" cursor (a single API call only
    returns ~10 articles) so each category tab can show 20-30 articles
    instead of just one page's worth. Returns [] (never raises) if the key
    is missing/invalid or the request fails, so callers can show a
    friendly empty-state instead of crashing.
    """
    if not NEWSDATA_API_KEY:
        return []

    articles = []
    next_page_token = None

    for _ in range(MAX_PAGES_PER_CATEGORY):
        params = {
            "apikey": NEWSDATA_API_KEY,
            "category": category,
            "country": country,
            "language": language,
        }
        if next_page_token:
            params["page"] = next_page_token

        try:
            response = requests.get(NEWSDATA_BASE_URL, params=params, timeout=8)
            response.raise_for_status()
            payload = response.json()
        except Exception as e:
            print(f"NewsData.io fetch failed for category={category}, language={language}: {e}")
            break

        articles.extend(payload.get("results", []) or [])
        next_page_token = payload.get("nextPage")

        if not next_page_token or len(articles) >= target_count:
            break

    # ---- Clean the batch before handing it to the grid ----
    # Drop entries with no usable headline (these used to render as blank/
    # broken cards) and de-duplicate by link (NewsData.io's free-tier
    # pagination sometimes repeats an article across pages, which used to
    # leave visible gaps in the 4-column grid).
    seen_links = set()
    cleaned = []
    for article in articles:
        title = (article.get("title") or "").strip()
        link = article.get("link") or ""
        if not title:
            continue
        if link and link in seen_links:
            continue
        if link:
            seen_links.add(link)
        cleaned.append(article)

    return cleaned[:target_count]
def render_live_news_section():
    """Categorized live news feed — shown on both Welcome (public) and Home (logged-in) pages."""
    st.markdown('<div class="section-title" style="margin-top:50px;">Live News, By Category</div><div class="section-line"></div>', unsafe_allow_html=True)

    if not NEWSDATA_API_KEY:
        st.info(
            "Live news isn't configured yet. Get a free API key from "
            "[newsdata.io](https://newsdata.io) and set it as the `NEWSDATA_API_KEY` "
            "environment variable to enable this section."
        )
        return

    lang_labels = [label for _, label in NEWS_LANGUAGE_OPTIONS]
    selected_lang_label = st.radio("Language", lang_labels, horizontal=True, key="live_news_language")
    selected_lang_code = dict(zip(lang_labels, [code for code, _ in NEWS_LANGUAGE_OPTIONS]))[selected_lang_label]

    tab_labels = [label for _, label in NEWS_CATEGORIES]
    tabs = st.tabs(tab_labels)

    for tab, (cat_id, _) in zip(tabs, NEWS_CATEGORIES):
        with tab:
            with st.spinner(f"Loading {cat_id} news..."):
                articles = fetch_live_news(category=cat_id, language=selected_lang_code)

            if not articles:
                st.write("No live headlines available for this category right now.")
                continue

            # 4 equal-width columns -> consistent grid, however many rows it takes
            num_cols = 4
            cols = st.columns(num_cols)
            for i, article in enumerate(articles):
                with cols[i % num_cols]:
                    # Escape everything that comes from the API before dropping
                    # it into raw HTML — an unescaped "&" or quote inside a
                    # headline was breaking the markup for that card (and
                    # sometimes the ones after it), which is what showed up
                    # as cards with missing photos/text.
                    title = html_lib.escape((article.get("title") or "Untitled").strip())
                    source_raw = article.get("source_id") or "Unknown source"
                    source_name = html_lib.escape(source_raw.upper() if isinstance(source_raw, str) else str(source_raw))
                    url = html_lib.escape(article.get("link") or "#", quote=True)
                    image_url = article.get("image_url")

                    if image_url:
                        image_url_safe = html_lib.escape(image_url, quote=True)
                        # A <img onerror="..."> tag was leaving a small broken-image
                        # icon in the corner when the URL 404'd, because Streamlit's
                        # markdown sandbox doesn't reliably fire inline JS handlers.
                        # A background-image div sidesteps that entirely: if the URL
                        # fails to load, the browser just shows nothing and the
                        # element's own background-color (set in CSS) stays visible —
                        # no broken-icon artifact possible.
                        img_html = f'<div class="news-card-img" style="background-image:url(\'{image_url_safe}\');"></div>'
                    else:
                        img_html = '<div class="news-card-noimg">No Photograph Available</div>'

                    st.markdown(
                        f"""
                        <div class="news-card">
                            {img_html}
                            <div class="news-card-body">
                                <div class="news-card-title">{title}</div>
                            </div>
                            <div class="news-card-footer">
                                <span class="news-card-source">{source_name}</span>
                                <span class="news-card-date">{datetime.now().strftime('%A, %d %B %Y')}</span>
                            </div>
                            <a href="{url}" target="_blank" class="news-card-link">Read more &rarr;</a>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )


MODULES = [
    {"id": "fake_news", "icon": "🔍", "title": "Fake News Detection",
     "desc": "BERT-based Fake/Real classification", "status": "active",
     "detail": "Uses a fine-tuned BERT model trained on 44,000+ labeled news articles (ISOT dataset) to classify whether an article is fake or real, with a confidence score."},
    {"id": "source_cred", "icon": "🏛️", "title": "Source Credibility",
     "desc": "Publisher trust rating lookup", "status": "active",
     "detail": "Cross-references the publisher domain against a curated reputation database to flag low-reliability sources. When a publisher is provided during a trust check, this score also feeds directly into the overall Trust Score."},
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
     "desc": "Tamil, Malayalam support", "status": "active",
     "detail": "An XLM-RoBERTa model fine-tuned on the DravidianCodeMix Tamil and Malayalam offensive/misinformation dataset (60,000+ rows) — detects offensive or suspicious language directly in Tamil or Malayalam text."},
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
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;0,900;1,700&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&display=swap');

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(18px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes cardEntrance {
    0% { opacity: 0; transform: translateY(28px); }
    100% { opacity: 1; transform: translateY(0); }
}

html, :root {
    color-scheme: light;
}

:root {
    --ink: #1a1a1a;
    --paper: #f4f1ea;
    --paper-2: #ece6d8;
    --rule: #1a1a1a;
    --maroon: #7a1414;
    --maroon-2: #9c1f1f;
    --sepia: #6b5b3e;
}

.stApp {
    background: var(--paper);
    background-image:
        repeating-linear-gradient(0deg, rgba(0,0,0,0.015) 0px, rgba(0,0,0,0.015) 1px, transparent 1px, transparent 3px);
    background-attachment: fixed;
}
/* Global ink-on-paper text */
.stApp, .stApp p, .stApp span, .stApp label, .stApp li,
.stApp .stMarkdown, .stApp div[data-testid="stMarkdownContainer"] {
    color: var(--ink);
    font-family: 'Lora', 'Old Standard TT', Georgia, serif;
}

.navbar-brand {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: 34px;
    letter-spacing: 2px;
    color: var(--ink);
    padding-top: 6px;
    text-transform: uppercase;
}
.navbar-brand span {
    font-family: 'Lora', serif;
    font-style: italic;
    font-weight: 400;
    font-size: 13px;
    color: var(--sepia);
    margin-left: 10px;
    text-transform: none;
    letter-spacing: 0.5px;
}
.nav-user {
    font-family: 'Lora', serif;
    font-style: italic;
    padding-top: 14px;
    text-align: right;
    font-size: 15px;
    color: var(--ink);
}
.navbar-divider {
    border-bottom: 3px double var(--rule);
    margin: 4px 0 26px 0;
}

.hero-wrap {
    text-align: center;
    padding: 6px 10px 14px 10px;
    margin-bottom: 6px;
    border-top: 2px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    animation: fadeInUp 0.6s ease;
}
.stat-box {
    text-align: center;
    padding: 18px 10px;
    background: #ffffff;
    border-radius: 0px;
    border: 1.5px solid var(--rule);
    margin-bottom: 30px;
    box-shadow: 4px 4px 0 rgba(0,0,0,0.12);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    animation: fadeInUp 0.8s ease;
}
.stat-box:hover {
    transform: translate(-2px, -2px);
    box-shadow: 6px 6px 0 rgba(122,20,20,0.35);
}
.stat-num {
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-size: 36px;
    color: var(--maroon);
}
.stat-label {
    font-family: 'Lora', serif;
    font-style: italic;
    font-size: 15px;
    color: #444;
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.brand {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: 28px;
    letter-spacing: 2px;
    color: var(--ink);
}
.brand-sub { font-family: 'Lora', serif; font-style: italic; color: var(--sepia); font-size: 13px; }
.hero-title {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: 58px;
    color: var(--ink);
    margin: 10px 0 4px 0;
    letter-spacing: 0.5px;
}
.hero-sub {
    font-family: 'Lora', serif;
    font-style: italic;
    color: #555;
    font-size: 18px;
    margin-bottom: 10px;
    border-top: 1px solid #999;
    padding-top: 8px;
    display: inline-block;
}
.section-title {
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-style: normal;
    font-size: 26px;
    text-align: center;
    color: var(--ink);
    margin-top: 30px;
    text-transform: uppercase;
    letter-spacing: 3px;
    text-shadow: none;
}
.section-line {
    width: 100%;
    max-width: 640px;
    height: 3px;
    background: var(--rule);
    margin: 8px auto 30px auto;
    position: relative;
}
.section-line::after {
    content: "";
    display: block;
    width: 100%;
    height: 1px;
    background: var(--rule);
    margin-top: 4px;
}

.card {
    background: var(--bgcolor, #ffffff);
    border-radius: 0px;
    padding: 22px 16px;
    text-align: center;
    box-shadow: 3px 3px 0 rgba(0,0,0,0.15);
    border: 1.5px solid var(--rule);
    height: 210px;
    transform: none;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    cursor: default;
    animation: fadeInUp 0.7s ease;
}
.card:hover {
    transform: translate(-3px, -3px);
    box-shadow: 6px 6px 0 rgba(122,20,20,0.35);
    z-index: 10;
    position: relative;
}
.card .icon {
    font-size: 26px;
    margin-bottom: 8px;
    transition: transform 0.3s ease;
}
.card:hover .icon { transform: scale(1.15); }
.card h3 {
    font-family: 'Playfair Display', serif;
    font-size: 22px !important;
    font-weight: 800 !important;
    color: #1a1a1a !important;
    margin: 6px 0 8px 0;
    line-height: 1.25;
}
.card p { font-family: 'Lora', serif; font-size: 15px !important; color: #333 !important; margin-bottom: 6px; font-style: italic; }
.badge {
    display: inline-block;
    padding: 3px 12px;
    border-radius: 0px;
    font-size: 12px;
    font-weight: 700;
    font-family: 'Lora', serif;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border: 1px solid var(--rule);
}
.badge-active { background: var(--ink); color: #faf6ea; }
.badge-basic { background: var(--sepia); color: #faf6ea; }
.badge-soon { background: #ffffff; color: #555; border: 1px solid #999; }

.flat-card {
    background: var(--flatbg, #ffffff);
    border-radius: 18px;
    box-shadow: 3px 3px 0 rgba(0,0,0,0.12);
    margin-bottom: 8px;
    overflow: hidden;
    height: 250px;
    border: 1.5px solid var(--rule) !important;
    transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.32s ease,
                border-color 0.32s ease;
    animation: cardEntrance 0.6s ease both;
    position: relative;
}
.flat-card::after {
    /* soft accent glow that fades in at the corners on hover */
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 18px;
    box-shadow: 0 0 0 0 rgba(122,20,20,0);
    transition: box-shadow 0.32s ease;
    pointer-events: none;
}
.flat-card:nth-child(1) { animation-delay: 0.05s; }
.flat-card:hover {
    transform: translateY(-9px) scale(1.015);
    box-shadow: 0 18px 34px rgba(122,20,20,0.22), 0 6px 14px rgba(0,0,0,0.12);
    border-color: var(--flatborder, var(--maroon)) !important;
}
.flat-card:hover::after {
    box-shadow: 0 0 0 3px var(--flatborder, var(--maroon)), 0 0 22px 2px rgba(122,20,20,0.25) inset;
}
.flat-card-bar {
    height: 4px;
    background: var(--maroon) !important;
    transition: height 0.32s ease, filter 0.32s ease;
}
.flat-card:hover .flat-card-bar {
    height: 8px;
    filter: brightness(1.15);
}
.flat-card p { min-height: 34px; font-size: 15px !important; color: #333 !important; font-style: italic; }
.flat-card .icon {
    font-size: 26px !important;
    margin-bottom: 4px;
    display: inline-block;
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.flat-card:hover .icon { transform: scale(1.3) rotate(-8deg); }
.flat-card h3 {
    font-size: 22px !important;
    font-weight: 800 !important;
    color: #1a1a1a !important;
    margin: 4px 0 8px 0 !important;
    line-height: 1.25;
    transition: color 0.32s ease;
}
.flat-card:hover h3 { color: var(--maroon) !important; }
.flat-card .status-badge {
    transition: transform 0.3s ease;
}
.flat-card:hover .status-badge { transform: scale(1.06); }

/* ---- Module status badges (Active / Basic / Coming Soon) on the
   "Explore All Modules" flat cards. Custom classes replace the plain
   Bootstrap bg-dark badge (whose text was getting swallowed by the
   global ink-on-paper text rule above, since Bootstrap's own badge
   text color didn't win the specificity fight). ---- */
.stApp span.status-badge {
    display: inline-block;
    padding: 4px 14px !important;
    border-radius: 999px !important;
    font-family: 'Lora', serif !important;
    font-weight: 700 !important;
    font-size: 12px !important;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    border: 1.5px solid var(--ink) !important;
}
.stApp span.status-badge-active {
    background: #4caf50 !important;
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
    border-color: #2e7d32 !important;
    text-shadow: none;
}
.stApp span.status-badge-basic {
    background: #f5e3a8 !important;
    color: #5a4300 !important;
    -webkit-text-fill-color: #5a4300 !important;
    border-color: #b8942e !important;
}
.stApp span.status-badge-soon {
    background: #f0ece0 !important;
    color: #666 !important;
    -webkit-text-fill-color: #666 !important;
    border-color: #999 !important;
}

.step-card {
    background: #ffffff;
    border: 1.5px solid var(--rule);
    border-radius: 0px;
    padding: 20px 14px;
    text-align: center;
    height: 190px;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    animation: fadeInUp 0.7s ease;
}
.step-card:hover {
    transform: translate(-3px, -3px);
    box-shadow: 6px 6px 0 rgba(122,20,20,0.3);
}
.step-circle {
    width: 40px; height: 40px;
    background: var(--maroon);
    color: #fff;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Playfair Display', serif;
    font-weight: 700;
    margin: 0 auto 12px auto;
    border: 2px solid var(--rule);
}
.step-card h3 { font-family: 'Playfair Display', serif; font-size: 18px; margin-bottom: 6px; color: #1a1a1a; }
.step-card p { font-family: 'Lora', serif; font-size: 14px; color: #444; font-style: italic; }

.flow-step {
    background: #ffffff;
    border: 1.5px solid var(--rule);
    border-radius: 0px;
    padding: 16px 22px;
    display: flex;
    align-items: center;
    gap: 18px;
    box-shadow: 3px 3px 0 rgba(0,0,0,0.1);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    animation: fadeInUp 0.6s ease;
}
.flow-step:hover { transform: translate(-2px, -2px); box-shadow: 5px 5px 0 rgba(122,20,20,0.3); }
.flow-step h3 { font-family: 'Playfair Display', serif; font-size: 22px !important; font-weight: 800 !important; margin: 0 0 4px 0; color: #1a1a1a !important; }
.flow-step p { font-family: 'Lora', serif; font-size: 16px !important; color: #333 !important; margin: 0; font-style: italic; }
.flow-num {
    min-width: 38px; height: 38px;
    background: var(--maroon);
    color: white;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Playfair Display', serif;
    font-weight: 700;
    font-size: 16px;
    border: 2px solid var(--rule);
}
.highlight-step {
    background: var(--paper-2);
    border: 2px solid var(--maroon);
}
.flow-arrow {
    text-align: center;
    font-size: 22px;
    color: var(--maroon);
    margin: 6px 0;
    animation: fadeIn 0.8s ease;
}
.module-chip {
    background: #ffffff;
    border: 1px solid var(--rule);
    border-radius: 0px;
    padding: 10px 4px;
    text-align: center;
    margin-top: 10px;
    box-shadow: 2px 2px 0 rgba(0,0,0,0.08);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.module-chip:hover {
    transform: translate(-2px, -2px);
    box-shadow: 4px 4px 0 rgba(122,20,20,0.3);
}
.chip-label {
    font-family: 'Lora', serif;
    font-size: 13px;
    color: #333;
    margin-top: 4px;
    line-height: 1.25;
    font-weight: 600;
}

.cta-banner {
    background: var(--ink);
    border: 3px double #fff;
    outline: 1.5px solid var(--ink);
    border-radius: 0px;
    padding: 38px 20px;
    text-align: center;
    color: #f4f1ea;
    margin-top: 40px;
    margin-bottom: 28px;
    animation: fadeIn 1s ease;
    box-shadow: 5px 5px 0 rgba(122,20,20,0.4);
}
.cta-banner h2 { font-family: 'Playfair Display', serif; font-size: 28px; margin-bottom: 8px; color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; text-transform: uppercase; letter-spacing: 1px; }
.cta-banner p { font-family: 'Lora', serif; font-style: italic; opacity: 0.9; margin-bottom: 0; color: #e8e0cf !important; -webkit-text-fill-color: #e8e0cf !important; }

div[data-testid="stButton"] button {
    border-radius: 0px !important;
    border: 1.5px solid var(--ink) !important;
    background: #ffffff !important;
    color: #1a1a1a !important;
    font-family: 'Lora', serif !important;
    font-weight: 700 !important;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    font-size: 13px !important;
    box-shadow: 2px 2px 0 rgba(0,0,0,0.2);
    transition: all 0.15s ease !important;
}
div[data-testid="stButton"] button:hover {
    background: var(--maroon) !important;
    color: #ffffff !important;
    border-color: var(--ink) !important;
    transform: translate(-2px, -2px);
    box-shadow: 4px 4px 0 rgba(122,20,20,0.4);
}
div[data-testid="stButton"] button:active { transform: translate(0,0); }

div[data-testid="stButton"] button[kind="primary"] {
    background: var(--maroon) !important;
    color: white !important;
    font-weight: 700 !important;
    border: 1.5px solid var(--ink) !important;
    box-shadow: 2px 2px 0 rgba(0,0,0,0.3) !important;
}
div[data-testid="stButton"] button[kind="primary"]:hover {
    background: var(--maroon-2) !important;
    box-shadow: 4px 4px 0 rgba(0,0,0,0.35) !important;
    transform: translate(-2px, -2px);
}

/* ---- Login/Signup buttons: spacing is controlled directly via
   st.columns([1,1], gap="small") in render_navbar() — the button-level
   padding below keeps them compact so the pair sits close together. ---- */

/* ---- Welcome page CTA buttons (Login / Sign Up Free) get their small
   size from the shared primary-button padding below; spacing is
   controlled directly via st.columns ratios in render_welcome(). ---- */

/* ---- Login button: masthead-style small maroon button ---- */
.st-key-nav_login button {
    background: var(--maroon) !important;
    color: #ffffff !important;
    text-shadow: none !important;
    border: 1.5px solid var(--ink) !important;
    font-family: 'Playfair Display', serif !important;
    font-weight: 700 !important;
    font-style: italic !important;
    font-size: 11px !important;
    letter-spacing: 0.5px !important;
    padding: 4px 10px !important;
    min-height: 28px !important;
    white-space: nowrap !important;
    box-shadow: 2px 2px 0 rgba(0,0,0,0.25) !important;
    text-transform: uppercase;
}
.st-key-nav_login button:hover {
    background: var(--maroon-2) !important;
    transform: translate(-2px, -2px);
    box-shadow: 4px 4px 0 rgba(0,0,0,0.3) !important;
}

/* ---- Signup button: ink-black outline button ---- */
.st-key-nav_signup button {
    background: var(--ink) !important;
    color: #ffffff !important;
    text-shadow: none !important;
    border: 1.5px solid var(--ink) !important;
    font-family: 'Playfair Display', serif !important;
    font-weight: 700 !important;
    font-style: italic !important;
    font-size: 11px !important;
    letter-spacing: 0.5px !important;
    padding: 4px 10px !important;
    min-height: 28px !important;
    white-space: nowrap !important;
    box-shadow: 2px 2px 0 rgba(0,0,0,0.25) !important;
    text-transform: uppercase;
}
.st-key-nav_signup button:hover {
    background: var(--maroon-2) !important;
    transform: translate(-2px, -2px);
    box-shadow: 4px 4px 0 rgba(0,0,0,0.3) !important;
}

/* ---- History / Logout buttons (logged-in navbar): same compact
   red style + same fixed size as Login/Sign Up, so both buttons match
   instead of auto-sizing to their text length. ---- */
.st-key-nav_history button,
.st-key-nav_logout button {
    background: var(--maroon) !important;
    color: #ffffff !important;
    text-shadow: none !important;
    border: 1.5px solid var(--ink) !important;
    font-family: 'Playfair Display', serif !important;
    font-weight: 700 !important;
    font-style: italic !important;
    font-size: 11px !important;
    letter-spacing: 0.5px !important;
    padding: 4px 10px !important;
    min-height: 28px !important;
    width: 110px !important;
    white-space: nowrap !important;
    box-shadow: 2px 2px 0 rgba(0,0,0,0.25) !important;
    text-transform: uppercase;
}
.st-key-nav_history button:hover,
.st-key-nav_logout button:hover {
    background: var(--maroon-2) !important;
    transform: translate(-2px, -2px);
    box-shadow: 4px 4px 0 rgba(0,0,0,0.3) !important;
}

/* ---- Welcome page Login / Sign Up Free buttons: same fixed size +
   compact red style as the navbar History/Logout buttons, so both
   sit evenly instead of auto-sizing to text length. ---- */
.st-key-welcome_login button,
.st-key-welcome_signup button {
    background: var(--maroon) !important;
    color: #ffffff !important;
    text-shadow: none !important;
    border: 1.5px solid var(--ink) !important;
    font-family: 'Playfair Display', serif !important;
    font-weight: 700 !important;
    font-style: italic !important;
    font-size: 12px !important;
    letter-spacing: 0.5px !important;
    padding: 6px 10px !important;
    min-height: 32px !important;
    width: 100% !important;
    white-space: nowrap !important;
    box-shadow: 2px 2px 0 rgba(0,0,0,0.25) !important;
    text-transform: uppercase;
}
.st-key-welcome_login button:hover,
.st-key-welcome_signup button:hover {
    background: var(--maroon-2) !important;
    transform: translate(-2px, -2px);
    box-shadow: 4px 4px 0 rgba(0,0,0,0.3) !important;
}


/* ---- Native Streamlit inputs/metrics: newspaper form style ---- */
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
    font-size: 17px !important;
    font-family: 'Lora', serif !important;
    border: 1.5px solid var(--ink) !important;
    border-radius: 0px !important;
}
.stApp input::placeholder, .stApp textarea::placeholder { color: #888 !important; font-size: 16px !important; font-style: italic; }
.stApp input::selection, .stApp textarea::selection { background: var(--maroon) !important; color: #ffffff !important; }
.stApp div[data-testid="stMetricValue"] { color: var(--ink) !important; font-family: 'Playfair Display', serif !important; }
.stApp div[data-testid="stMetricLabel"] { color: var(--sepia) !important; text-transform: uppercase; letter-spacing: 0.5px; }
.stApp div[data-testid="stDataFrame"] { border-radius: 0px; overflow: hidden; border: 1.5px solid var(--ink); }
.stApp code { color: var(--maroon) !important; background: rgba(0,0,0,0.06) !important; }
/* ---- File uploader: newspaper form style ---- */
.stApp div[data-testid="stFileUploader"] section {
    background-color: #ffffff !important;
    border-radius: 0px !important;
    border: 1.5px dashed var(--ink) !important;
}
.stApp div[data-testid="stFileUploader"] section span,
.stApp div[data-testid="stFileUploader"] section small,
.stApp div[data-testid="stFileUploader"] section div {
    color: #333 !important;
}

/* Headings solid black bold across all card types */
.stApp div[data-testid="stMarkdownContainer"] .card h3,
.stApp div[data-testid="stMarkdownContainer"] .flat-card h3,
.stApp div[data-testid="stMarkdownContainer"] .step-card h3,
.stApp div[data-testid="stMarkdownContainer"] .flow-step h3,
.stApp .card h3,
.stApp .flat-card h3,
.stApp .step-card h3,
.stApp .flow-step h3 {
    color: #000000 !important;
    -webkit-text-fill-color: #000000 !important;
    font-weight: 800 !important;
    text-shadow: none !important;
    opacity: 1 !important;
}

/* "Learn More →" links under module cards */
div[class*="st-key-btn_"] button {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    color: var(--maroon) !important;
    -webkit-text-fill-color: var(--maroon) !important;
    font-family: 'Lora', serif !important;
    font-weight: 700 !important;
    font-size: 14px !important;
    font-style: italic;
    text-decoration: none !important;
    text-align: left !important;
    justify-content: flex-start !important;
    padding: 6px 4px !important;
    letter-spacing: 0 !important;
    text-transform: none;
}
div[class*="st-key-btn_"] button p,
div[class*="st-key-btn_"] button span,
div[class*="st-key-btn_"] button div {
    color: inherit !important;
    -webkit-text-fill-color: inherit !important;
}
div[class*="st-key-btn_"] button:hover {
    background: transparent !important;
    color: var(--maroon-2) !important;
    -webkit-text-fill-color: var(--maroon-2) !important;
    text-decoration: underline !important;
    transform: none !important;
    box-shadow: none !important;
}
div[class*="st-key-btn_"] button:active { transform: none !important; }

/* ---- Live News section: newspaper clipping cards ----
   Fixed height on every zone (image / title / footer / link) so every
   card in the grid ends up exactly the same total height regardless of
   headline length — this is what keeps the 4-column grid aligned with
   no overlap, instead of relying on Streamlit to equalize row heights
   (which it doesn't do across separate st.columns()). */
.news-card {
    background: #ffffff;
    border: 1.5px solid var(--ink);
    border-radius: 0px;
    padding: 0;
    margin-bottom: 22px;
    box-shadow: 3px 3px 0 rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    height: 340px;
    overflow: hidden;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.news-card:hover {
    transform: translate(-3px, -3px);
    box-shadow: 6px 6px 0 rgba(122,20,20,0.3);
}
.news-card-img {
    width: 100%;
    height: 140px;
    flex-shrink: 0;
    background-size: cover;
    background-position: center;
    background-color: #ece6d8;
    background-repeat: no-repeat;
    border-bottom: 1.5px solid var(--ink);
    filter: grayscale(15%);
}
.news-card-noimg {
    width: 100%;
    height: 140px;
    flex-shrink: 0;
    border-bottom: 1.5px solid var(--ink);
    background: repeating-linear-gradient(45deg, #ece6d8, #ece6d8 8px, #e2dac8 8px, #e2dac8 16px);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #777;
    font-family: 'Lora', serif;
    font-style: italic;
    font-size: 13px;
}
.news-card-body {
    padding: 10px 14px 0 14px;
    flex-grow: 1;
    min-height: 0;
    overflow: hidden;
}
.news-card-title {
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-size: 15px;
    line-height: 1.3;
    color: var(--ink);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.news-card-footer {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-shrink: 0;
    padding: 8px 14px 0 14px;
    border-top: 1px solid #999;
    margin: 8px 14px 0 14px;
    padding-left: 0;
    padding-right: 0;
}
.news-card-source {
    font-family: 'Lora', serif;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.5px;
    color: var(--sepia);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60%;
}
.news-card-date {
    font-family: 'Lora', serif;
    font-style: italic;
    font-size: 10px;
    color: #777;
    white-space: nowrap;
}
.news-card-link {
    font-family: 'Lora', serif;
    font-weight: 700;
    font-size: 13px;
    color: var(--maroon) !important;
    flex-shrink: 0;
    padding: 8px 14px 12px 14px;
    text-decoration: none !important;
}
.news-card-link:hover { text-decoration: underline !important; }
</style>
""", unsafe_allow_html=True)


def render_login():
    back_target = "home" if st.session_state.logged_in else "welcome"
    st.button("← Back", on_click=go_to, args=(back_target,))
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
    back_target = "home" if st.session_state.logged_in else "welcome"
    st.button("← Back", on_click=go_to, args=(back_target,))
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
    st.markdown(
        f'<div style="text-align:center; font-family:\'Lora\',serif; font-style:italic; '
        f'font-size:13px; color:#6b5b3e; letter-spacing:1px; margin-bottom:2px;">'
        f'{datetime.now().strftime("%A, %d %B %Y").upper()}</div>',
        unsafe_allow_html=True,
    )
    nav_l, nav_r = st.columns([4, 2.2] if st.session_state.logged_in else [5.2, 0.8], gap="small")
    with nav_l:
        st.markdown('<div class="navbar-brand">📰 PURE PRESS <span>Daily Intelligence</span></div>', unsafe_allow_html=True)
    with nav_r:
        if st.session_state.logged_in:
            b1, b2, b3 = st.columns([2.2, 1, 1], gap="small")
            with b1:
                st.markdown(f'<div class="nav-user"> 👋 {st.session_state.username}</div>', unsafe_allow_html=True)
            with b2:
                if st.button("📊 History", key="nav_history"):
                    go_to("history")
                    st.rerun()
            with b3:
                if st.button("Logout", key="nav_logout"):
                    st.session_state.logged_in = False
                    st.session_state.username = ""
                    st.rerun()
        else:
            b1, b2 = st.columns([1, 1], gap="small")
            with b1:
                if st.button("Login", key="nav_login"):
                    go_to("login")
                    st.rerun()
            with b2:
                if st.button("Sign Up Free", key="nav_signup"):
                    go_to("signup")
                    st.rerun()
    st.markdown('<div class="navbar-divider"></div>', unsafe_allow_html=True)


# =====================================================================
# NEW: Public gate page — shown instead of the full dashboard whenever
# the visitor isn't logged in. Keeps branding + key stats visible, but
# hides all modules/features behind Login / Sign Up, per requirement:
# "site direct-a ellarkkum kaataadha, login/signup pannadha apram than
#  modules kaanum".
# =====================================================================

def render_welcome():
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
        ("44K+", "Training Articles"),
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

    st.markdown("""
    <div class="cta-banner">
        <h2>Join Pure Press to Get Started</h2>
        <p>Log in or create a free account to unlock Fake News Detection, Bias Detection, Clickbait Detection, Source Credibility and more</p>
    </div>
    """, unsafe_allow_html=True)

    cta_cols = st.columns([7, 1.4, 1.4, 7], gap="small")
    with cta_cols[1]:
        if st.button("🔐 Login", key="welcome_login", use_container_width=True):
            go_to("login")
            st.rerun()
    with cta_cols[2]:
        if st.button("✨ Sign Up Free", key="welcome_signup", use_container_width=True):
            go_to("signup")
            st.rerun()

    render_live_news_section()



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
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&family=Lora:ital@0;1&display=swap');
        html, body {{
            margin: 0; padding: 0 14px;
            background: transparent;
            font-family: 'Lora', serif;
        }}
        .hl-col {{ padding-left: 14px; padding-right: 14px; margin-bottom: 12px; }}
        .hl-card {{
            background: #ffffff !important;
            border-radius: 0px;
            border: 2px solid #1a1a1a !important;
            padding: 30px 18px;
            text-align: center;
            min-height: 250px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-shadow: 5px 5px 0 rgba(0,0,0,0.18);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }}
        .hl-card:hover {{
            transform: translate(-4px, -4px);
            box-shadow: 8px 8px 0 rgba(122,20,20,0.35);
        }}
        .hl-icon {{ font-size: 40px; margin-bottom: 10px; }}
        .hl-card h2 {{
            font-family: 'Playfair Display', serif;
            font-weight: 800;
            font-style: normal;
            font-size: 21px;
            margin: 0 0 8px 0;
            color: #1a1a1a;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .hl-card p {{
            font-size: 14px;
            font-style: italic;
            color: #444;
            margin: 0 0 14px 0;
        }}
        .hl-badge {{
            display: inline-block;
            padding: 4px 14px;
            border-radius: 0px;
            border: 1.5px solid #1a1a1a !important;
            font-size: 12px;
            font-weight: 700;
            font-family: 'Lora', serif;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            background: #f4f1ea;
            color: #7a1414 !important;
        }}
        #highlightCarousel {{ padding-bottom: 14px; }}
        .carousel-control-prev, .carousel-control-next {{ width: 6%; }}
        .carousel-control-prev-icon, .carousel-control-next-icon {{
            background-color: #1a1a1a;
            border-radius: 50%;
            padding: 16px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        }}
        .carousel-indicators {{ margin-bottom: -8px; }}
        .carousel-indicators [data-bs-target] {{
            background-color: #7a1414;
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
            background: #ffffff;
            border-radius: 0px;
            border: 1.5px solid #1a1a1a;
            box-shadow: 4px 4px 0 rgba(0,0,0,0.15);
        }}
        .t-emoji {{ font-size: 28px; margin-bottom: 10px; }}
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
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .t-name span {{
            font-family: 'Lora', serif;
            font-weight: 400;
            font-style: italic;
            color: #7a1414;
            font-size: 14px;
            text-transform: none;
            letter-spacing: 0;
        }}
        .carousel-indicators [data-bs-target] {{
            background-color: #7a1414;
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
        ("40K+", "Training Articles"),
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

       # ---- NEW: Live categorized news feed, right at the top of the home page ----
    render_live_news_section()

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
                <h3 style="color:#000000 !important; font-weight:800 !important; font-size:24px !important;">{mod['title']}</h3>
                <p>{mod['desc']}</p>
            </div>
            """, unsafe_allow_html=True)

    # ---- Section 2: Flat functional cards ----
    st.markdown('<div class="section-title" style="margin-top:50px;">Explore All Modules</div><div class="section-line"></div>', unsafe_allow_html=True)

    cols = st.columns(4)
    for i, mod in enumerate(MODULES):
        with cols[i % 4]:
            badge_class = {"active": "status-badge-active", "basic": "status-badge-basic", "coming_soon": "status-badge-soon"}[mod["status"]]
            badge_text = {"active": "Active", "basic": "Basic", "coming_soon": "Coming Soon"}[mod["status"]]
            border_color = CARD_BORDER[i % len(CARD_BORDER)]
            st.markdown(f"""
            <div class="card shadow-lg border-0 rounded-4 flat-card" style="--flatbg:#ffffff; --flatborder:{border_color};">
                <div class="flat-card-bar" style="background:{border_color};"></div>
                <div class="card-body" style="padding:14px 16px;">
                    <div class="icon" style="font-size:26px;">{mod['icon']}</div>
                    <h3 class="card-title" style="text-align:left; color:#000000 !important; font-weight:800 !important; font-size:24px !important;">{mod['title']}</h3>
                    <p class="card-text" style="text-align:left;">{mod['desc']}</p>
                    <div style="margin-top:6px;"><span class="status-badge {badge_class}">{badge_text}</span></div>
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
            <h3 style="color:#000000 !important; font-weight:800 !important; font-size:24px !important;">Submit Article</h3>
            <p>User pastes text, or uploads a PDF / image (screenshot, photo of print) of a news headline and article</p>
        </div>
    </div>
    <div class="flow-arrow">↓</div>
    """, unsafe_allow_html=True)

    st.markdown("""
    <div class="flow-step">
        <div class="flow-num">2</div>
        <div>
            <h3 style="color:#000000 !important; font-weight:800 !important; font-size:24px !important;">9 AI Modules Analyze in Parallel</h3>
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
            <h3 style="color:#000000 !important; font-weight:800 !important; font-size:24px !important;">Trust Score Engine</h3>
            <p>Combines Fake News + Bias + Clickbait + Source + Verification results into one weighted 0–100 score</p>
        </div>
    </div>
    <div class="flow-arrow">↓</div>
    """, unsafe_allow_html=True)

    st.markdown("""
    <div class="flow-step">
        <div class="flow-num">4</div>
        <div>
            <h3 style="color:#000000 !important; font-weight:800 !important; font-size:24px !important;">Get Your Report</h3>
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
    <h1 style="font-family:'Playfair Display', serif; color:#000000;">{mod['icon']} {mod['title']}</h1>
    <p style="font-family:'Lora', serif; font-style:italic; color:#cbbfe6; font-size:17px;">{mod['detail']}</p>
    <hr style="border-color:rgba(255,255,255,0.25);">
    """, unsafe_allow_html=True)


def render_trust_check(mod):
    render_module_header(mod)

    with st.spinner("Loading AI models..."):
        models = load_models()

    # ---- NEW: let the user choose how they want to submit the article ----
    input_mode = st.radio(
        "How do you want to submit the article?",
        ["📝 Paste Text", "📄 Upload PDF", "🖼️ Upload Image"],
        horizontal=True,
        key=f"input_mode_{mod['id']}",
    )

    headline_input = st.text_input(
        "News Headline",
        placeholder="e.g. Scientists Discover New Planet",
        key=f"headline_{mod['id']}",
    )

    text_input, pdf_file, image_file = "", None, None

    if input_mode == "📝 Paste Text":
        text_input = st.text_area(
            "Article Text", height=200,
            placeholder="Paste the full news article here...",
            key=f"text_{mod['id']}",
        )

    elif input_mode == "📄 Upload PDF":
        pdf_file = st.file_uploader(
            "Upload the article as a PDF",
            type=["pdf"],
            key=f"pdf_{mod['id']}",
        )
        if pdf_file is not None:
            preview = extract_text_from_pdf(pdf_file)
            if preview:
                st.text_area(
                    "Extracted text (auto-filled, editable before checking)",
                    value=preview, height=200,
                    key=f"pdf_preview_{mod['id']}",
                )

    elif input_mode == "🖼️ Upload Image":
        image_file = st.file_uploader(
            "Upload the article as an image (screenshot / photo)",
            type=["png", "jpg", "jpeg", "webp"],
            key=f"image_{mod['id']}",
        )
        if image_file is not None:
            st.image(image_file, caption="Uploaded image", width=350)
            preview = extract_text_from_image(image_file)
            if preview:
                st.text_area(
                    "Extracted text via OCR (auto-filled, editable before checking)",
                    value=preview, height=200,
                    key=f"image_preview_{mod['id']}",
                )

    # ---- New: optional publisher domain, feeds Source Credibility into the score ----
    publisher_input = st.text_input(
        "Publisher URL or domain (optional)",
        placeholder="e.g. reuters.com or https://www.bbc.com/news/...",
        key=f"publisher_{mod['id']}",
        help="If provided, the publisher's reputation is looked up and blended into the Trust Score.",
    )

    result_key = f"result_{mod['id']}"

    if st.button("Check Trust Score", type="primary"):
        # Re-read the (possibly user-edited) extracted text from the preview boxes
        if input_mode == "📄 Upload PDF" and pdf_file is not None:
            article_text = st.session_state.get(f"pdf_preview_{mod['id']}", "")
        elif input_mode == "🖼️ Upload Image" and image_file is not None:
            article_text = st.session_state.get(f"image_preview_{mod['id']}", "")
        else:
            article_text = text_input

        if input_mode == "📄 Upload PDF" and pdf_file is None:
            st.warning("Please upload a PDF file first.")
        elif input_mode == "🖼️ Upload Image" and image_file is None:
            st.warning("Please upload an image file first.")
        elif not headline_input or not article_text:
            st.warning("Please provide both a headline and article text (type it, or upload a PDF/image so it can be extracted).")
        else:
            with st.spinner("Analyzing..."):
                full_text = headline_input + " " + article_text
                result = calculate_trust_score(headline_input, full_text, models, source_domain=publisher_input)

            # Persist across reruns so the download button below doesn't wipe the results
            st.session_state[result_key] = {
                "result": result,
                "headline": headline_input,
                "article_text": article_text,
            }

            # ---- New: Analysis History — save this check for the logged-in user ----
            if st.session_state.logged_in:
                save_history(
                    st.session_state.username, mod["title"],
                    headline_input, result["trust_score"], result["risk_level"],
                )

    # ---- Render the most recent result for this module (persists across reruns) ----
    if result_key in st.session_state:
        saved = st.session_state[result_key]
        result = saved["result"]

        st.markdown("---")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("Trust Score", f"{result['trust_score']}/100")
        with col2:
            st.markdown(f"### :{result['color']}[{result['risk_level']}]")
        st.progress(result["trust_score"] / 100)

        cols = st.columns(4 if result.get("source") else 3)
        with cols[0]:
            st.write("**Fake News**")
            st.write(f"`{result['fake_news']['prediction']}` ({result['fake_news']['confidence']:.1%})")
        with cols[1]:
            st.write("**Bias**")
            st.write(f"`{result['bias']['prediction']}` ({result['bias']['bias_score']:.1%})")
        with cols[2]:
            st.write("**Clickbait**")
            st.write(f"`{result['clickbait']['prediction']}` ({result['clickbait']['clickbait_score']:.1%})")
        if result.get("source"):
            with cols[3]:
                st.write("**Source**")
                st.write(f"`{result['source']['label']}` ({result['source']['score']}/100) — {result['source']['domain']}")

        st.markdown("### 💡 Explainable AI — Why this result?")
        for r in result["reasons"]:
            st.write(f"- {r}")

        # ---- New: Visual charts ----
        st.markdown("### 📊 Score Breakdown")
        render_score_charts(result)

        # ---- New: Downloadable PDF report ----
        pdf_buffer = generate_trust_report_pdf(saved["headline"], saved["article_text"], result)
        st.download_button(
            "⬇️ Download Trust Report (PDF)",
            data=pdf_buffer,
            file_name=f"trust_report_{mod['id']}.pdf",
            mime="application/pdf",
            key=f"download_{mod['id']}",
        )


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


# =====================================================================
# NEW: Standalone Source Credibility check
# =====================================================================

def render_source_credibility(mod):
    render_module_header(mod)
    st.write("Enter a publisher's website or a specific article URL to check its track record.")

    raw = st.text_input("Publisher URL or domain", placeholder="e.g. bbc.com or https://www.bbc.com/news/...")

    if st.button("Check Source Credibility", type="primary"):
        if not raw:
            st.warning("Please enter a URL or domain.")
        else:
            result = lookup_source_credibility(raw)
            color = {"High": "green", "Medium": "orange", "Low": "red", "Satire": "orange", "Unknown": "orange"}.get(result["label"], "orange")

            st.markdown("---")
            st.markdown(f"### Domain: `{result['domain']}`")
            col1, col2 = st.columns(2)
            with col1:
                st.metric("Credibility Score", f"{result['score']}/100")
            with col2:
                st.markdown(f"### :{color}[{result['label']}]")
            st.progress(result["score"] / 100)
            st.write(result["note"])
            if not result["found"]:
                st.info("This database currently covers a curated list of well-known publishers. More sources are being added over time.")


# =====================================================================
# NEW: Analysis History dashboard
# =====================================================================

def render_history_page():
    st.button("← Back to Home", on_click=go_to, args=("home",))
    st.markdown('<div class="section-title">📊 My Analysis History</div><div class="section-line"></div>', unsafe_allow_html=True)

    if not st.session_state.logged_in:
        st.info("Please log in to see your past trust checks.")
        return

    rows = get_history(st.session_state.username)
    if not rows:
        st.info("You haven't run any trust checks yet. Try one of the modules from the home page!")
        return

    df = pd.DataFrame(rows, columns=["Module", "Headline", "Trust Score", "Risk Level", "Checked At"])
    st.dataframe(df, use_container_width=True, hide_index=True)

    avg_score = df["Trust Score"].mean()
    st.metric("Average Trust Score (all your checks)", f"{avg_score:.1f}/100")


def render_multilingual(mod, models):
    render_module_header(mod)

    tokenizer, model = models.get("multilingual", (None, None))

    if tokenizer is None or model is None:
        st.warning(
            "The multilingual model hasn't been trained yet. Run "
            "`step4_train_multilingual.py` first, which saves the trained "
            "model to `models/multilingual_bert_model/` — then reload this page."
        )
        return

    st.write("Paste Tamil or Malayalam text to check it for offensive language / misinformation signals.")

    text_input = st.text_area(
        "Text (Tamil / Malayalam)",
        height=180,
        placeholder="இங்கே தமிழ் அல்லது மலையாள உரையை ஒட்டவும்...",
        key="multilingual_text",
    )

    if st.button("Analyze Text", type="primary", key="multilingual_check_btn"):
        if not text_input.strip():
            st.warning("Please paste some text first.")
        else:
            with st.spinner("Analyzing..."):
                detected_lang = detect_dravidian_language(text_input)
                result = predict_multilingual(text_input, tokenizer, model)

            st.markdown("---")
            st.write(f"**Detected language:** `{detected_lang}`")

            col1, col2 = st.columns(2)
            with col1:
                st.metric("Trust Score", f"{result['trust_score']}/100")
            with col2:
                color = "red" if result["prediction"] == "Offensive / Suspicious" else "green"
                st.markdown(f"### :{color}[{result['prediction']}]")
            st.progress(result["trust_score"] / 100)

            st.markdown("### 💡 Why this result?")
            if result["prediction"] == "Offensive / Suspicious":
                st.write(
                    "- The model detected language patterns commonly associated with "
                    "offensive, inflammatory, or misleading content in Tamil/Malayalam text."
                )
            else:
                st.write("- No strong offensive-language or misinformation signals were detected.")

            if st.session_state.logged_in:
                save_history(
                    st.session_state.username, mod["title"],
                    text_input[:80], result["trust_score"],
                    "High Risk" if result["prediction"] == "Offensive / Suspicious" else "Low Risk",
                )


def render_placeholder(mod):
    render_module_header(mod)
    st.info("This module is coming soon and will be added as the project progresses.")

MODULE_MAP = {m["id"]: m for m in MODULES}

# Pages that require the visitor to be logged in. Anything not in this
# set (currently just "login" and "signup") stays public.
PROTECTED_PAGES = {
    "home", "fake_news", "bias", "clickbait", "explainable",
    "propagation", "source_cred", "history",
    "cross_verify", "multilingual", "realtime",
}

page = st.session_state.page

if not st.session_state.logged_in and page in PROTECTED_PAGES:
    page = "welcome"
    st.session_state.page = "welcome"

render_navbar()

if page == "welcome":
    render_welcome()
elif page == "home":
    render_home()
elif page == "login":
    render_login()
elif page == "signup":
    render_signup()
elif page in ["fake_news", "bias", "clickbait", "explainable"]:
    render_trust_check(MODULE_MAP[page])
elif page == "propagation":
    render_propagation(MODULE_MAP[page])
elif page == "source_cred":
    render_source_credibility(MODULE_MAP[page])
elif page == "history":
    render_history_page()
elif page == "multilingual":
    with st.spinner("Loading AI models..."):
        _models = load_models()
    render_multilingual(MODULE_MAP[page], _models)
elif page in ["cross_verify", "realtime"]:
    render_placeholder(MODULE_MAP[page])