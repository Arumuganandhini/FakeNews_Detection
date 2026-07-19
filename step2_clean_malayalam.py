"""
Module 7 - Multilingual (Malayalam)
Step 2: Clean and prepare Malayalam dataset for training
"""

import pandas as pd
import re

DATA_PATH = "datasets/07_Multilingual/DravidianCodeMix-2020/DravidianCodeMix/mal_full_offensive.csv"

df = pd.read_csv(DATA_PATH, sep="\t", header=None, names=["label", "text"], on_bad_lines="skip", engine="python")

print("Original shape:", df.shape)
print("\nLabel distribution (before cleaning):")
print(df["label"].value_counts())

# ---------- Step 1: Remove "not-malayalam" rows (if present) ----------
df = df[~df["label"].str.contains("not-malayalam|not-Malayalam", case=False, na=False)]
print("\nAfter removing non-Malayalam:", df.shape)

# ---------- Step 2: Convert to binary label ----------
df["binary_label"] = df["label"].apply(lambda x: 0 if x == "Not_offensive" else 1)

# ---------- Step 3: Drop missing text ----------
df = df.dropna(subset=["text"])

# ---------- Step 4: Light cleaning ----------
def clean_text(text):
    text = str(text)
    text = re.sub(r"http\S+|www\.\S+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

df["content"] = df["text"].apply(clean_text)
df = df[df["content"].str.strip() != ""]

print("\nBinary label distribution:")
print(df["binary_label"].value_counts())

print("\nSample rows:")
print(df[["content", "binary_label"]].head(5))

# ---------- Step 5: Save cleaned dataset ----------
OUTPUT_PATH = "datasets/07_Multilingual/cleaned_malayalam.csv"
df[["content", "binary_label"]].rename(columns={"binary_label": "label"}).to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved cleaned dataset to: {OUTPUT_PATH}")
print("Final shape:", df.shape)