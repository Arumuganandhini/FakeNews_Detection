"""
Module 3 - Bias Detection
Step 2: Clean and prepare MBIC dataset for training
"""

import pandas as pd
import re

DATA_PATH = "datasets/03_Bias_Detection/final_labels_MBIC.csv"

df = pd.read_csv(DATA_PATH, sep=";")

print("Original shape:", df.shape)

# ---------- Step 1: Keep only Biased / Non-biased (remove "No agreement") ----------
df = df[df["label_bias"].isin(["Biased", "Non-biased"])]
print("After removing 'No agreement':", df.shape)

# ---------- Step 2: Convert label to 0/1 ----------
# Biased = 1, Non-biased = 0
df["label"] = df["label_bias"].map({"Biased": 1, "Non-biased": 0})

# ---------- Step 3: Drop rows with missing text ----------
df = df.dropna(subset=["text"])

# ---------- Step 4: Clean text (same style as Module 1) ----------
def clean_text(text):
    text = str(text).lower()
    text = re.sub(r"http\S+|www\.\S+", "", text)
    text = re.sub(r"<.*?>", "", text)
    text = re.sub(r"[^a-z\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

df["content"] = df["text"].apply(clean_text)

# Remove empty rows after cleaning
df = df[df["content"].str.strip() != ""]

print("\nFinal label distribution:")
print(df["label"].value_counts())

print("\nSample cleaned rows:")
print(df[["content", "label"]].head(5))

# ---------- Step 5: Save cleaned dataset ----------
OUTPUT_PATH = "datasets/03_Bias_Detection/cleaned_bias.csv"
df[["content", "label"]].to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved cleaned dataset to: {OUTPUT_PATH}")
print("Final shape:", df.shape)