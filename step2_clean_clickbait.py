"""
Module 4 - Clickbait Detection
Step 2: Clean and prepare clickbait dataset for training
"""

import pandas as pd
import re

DATA_PATH = "datasets/04_Clickbait_Detection/clickbait_data.csv"

df = pd.read_csv(DATA_PATH)
print("Original shape:", df.shape)

# ---------- Step 1: Drop missing headlines ----------
df = df.dropna(subset=["headline"])

# ---------- Step 2: Clean text ----------
def clean_text(text):
    text = str(text).lower()
    text = re.sub(r"http\S+|www\.\S+", "", text)
    text = re.sub(r"<.*?>", "", text)
    text = re.sub(r"[^a-z\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

df["content"] = df["headline"].apply(clean_text)

# Remove empty rows after cleaning
df = df[df["content"].str.strip() != ""]

# ---------- Step 3: Rename label column for consistency ----------
df["label"] = df["clickbait"]

print("\nFinal label distribution:")
print(df["label"].value_counts())

print("\nSample cleaned rows:")
print(df[["content", "label"]].head(5))

# ---------- Step 4: Save cleaned dataset ----------
OUTPUT_PATH = "datasets/04_Clickbait_Detection/cleaned_clickbait.csv"
df[["content", "label"]].to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved cleaned dataset to: {OUTPUT_PATH}")
print("Final shape:", df.shape)