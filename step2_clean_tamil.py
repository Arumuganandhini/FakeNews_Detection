"""
Module 7 - Multilingual (Tamil)
Step 2: Clean and prepare Tamil dataset for training
"""

import pandas as pd
import re

DATA_PATH = "datasets/07_Multilingual/DravidianCodeMix-2020/DravidianCodeMix/tamil_offensive_full.csv"

df = pd.read_csv(DATA_PATH, sep="\t", header=None, names=["label", "text"], on_bad_lines="skip", engine="python")

print("Original shape:", df.shape)

# ---------- Step 1: Remove "not-Tamil" rows ----------
df = df[df["label"] != "not-Tamil"]
print("After removing not-Tamil:", df.shape)

# ---------- Step 2: Convert to binary label ----------
# Not_offensive = 0, everything else (Offensive_*) = 1
df["binary_label"] = df["label"].apply(lambda x: 0 if x == "Not_offensive" else 1)

# ---------- Step 3: Drop missing text ----------
df = df.dropna(subset=["text"])

# ---------- Step 4: Light cleaning (Tamil text - don't lowercase/strip non-ascii) ----------
def clean_text(text):
    text = str(text)
    text = re.sub(r"http\S+|www\.\S+", "", text)   # remove URLs
    text = re.sub(r"\s+", " ", text).strip()          # remove extra whitespace
    return text

df["content"] = df["text"].apply(clean_text)
df = df[df["content"].str.strip() != ""]

print("\nBinary label distribution:")
print(df["binary_label"].value_counts())

print("\nSample rows:")
print(df[["content", "binary_label"]].head(5))

# ---------- Step 5: Save cleaned dataset ----------
OUTPUT_PATH = "datasets/07_Multilingual/cleaned_tamil.csv"
df[["content", "binary_label"]].rename(columns={"binary_label": "label"}).to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved cleaned dataset to: {OUTPUT_PATH}")
print("Final shape:", df.shape)