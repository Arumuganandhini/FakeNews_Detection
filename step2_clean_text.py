"""
Module 1 - Fake News Detection
Step 2: Text Cleaning / Preprocessing
"""

import pandas as pd
import re
import nltk
from nltk.corpus import stopwords

# ---------- Download NLTK stopwords (only needed once) ----------
nltk.download("stopwords", quiet=True)
STOPWORDS = set(stopwords.words("english"))

# ---------- Load the combined dataset from Step 1 ----------
DATA_PATH = "datasets/01_Fake_News_Detection/combined_fake_real.csv"
df = pd.read_csv(DATA_PATH)

print("Loaded dataset:", df.shape)
print("Columns:", list(df.columns))

# ---------- Cleaning function ----------
def clean_text(text):
    if pd.isna(text):
        return ""

    text = str(text)

    # 1. Lowercase
    text = text.lower()

    # 2. Remove URLs
    text = re.sub(r"http\S+|www\.\S+", "", text)

    # 3. Remove HTML tags
    text = re.sub(r"<.*?>", "", text)

    # 4. Remove punctuation and special characters (keep only letters and spaces)
    text = re.sub(r"[^a-z\s]", "", text)

    # 5. Remove extra whitespace
    text = re.sub(r"\s+", " ", text).strip()

    # 6. Remove stopwords
    words = text.split()
    words = [w for w in words if w not in STOPWORDS]
    text = " ".join(words)

    return text


# ---------- Apply cleaning to title and text columns ----------
print("\nCleaning 'title' column...")
df["title_clean"] = df["title"].apply(clean_text)

print("Cleaning 'text' column... (ithu konjam time edukkum, patience pannunga)")
df["text_clean"] = df["text"].apply(clean_text)

# ---------- Combine title + text into one field for the model ----------
df["content"] = df["title_clean"] + " " + df["text_clean"]

# ---------- Remove rows where content is empty after cleaning ----------
before = len(df)
df = df[df["content"].str.strip() != ""]
after = len(df)
print(f"\nRemoved {before - after} empty rows after cleaning.")

# ---------- Preview ----------
print("\nSample cleaned rows:")
print(df[["title", "title_clean"]].head(3))
print("\nSample cleaned content (first 200 chars):")
print(df["content"].iloc[0][:200])

# ---------- Save cleaned dataset ----------
OUTPUT_PATH = "datasets/01_Fake_News_Detection/cleaned_fake_real.csv"
df[["content", "label"]].to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved cleaned dataset to: {OUTPUT_PATH}")
print("Final shape:", df.shape)