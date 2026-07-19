"""
Module 1 - Fake News Detection
Step 1: Dataset load panni, basic exploration pannuradhu
"""

import pandas as pd

# ---------- Dataset paths ----------
FAKE_PATH = "datasets/01_Fake_News_Detection/Fake.csv"
TRUE_PATH = "datasets/01_Fake_News_Detection/True.csv"

# ---------- Step 1: Load the datasets ----------
fake_df = pd.read_csv(FAKE_PATH)
true_df = pd.read_csv(TRUE_PATH)

print("=" * 50)
print("FAKE NEWS DATASET")
print("=" * 50)
print("Shape (rows, columns):", fake_df.shape)
print("\nColumns:", list(fake_df.columns))
print("\nFirst 3 rows:")
print(fake_df.head(3))

print("\n" + "=" * 50)
print("TRUE NEWS DATASET")
print("=" * 50)
print("Shape (rows, columns):", true_df.shape)
print("\nColumns:", list(true_df.columns))
print("\nFirst 3 rows:")
print(true_df.head(3))

# ---------- Step 2: Add labels ----------
# Fake news = 0, Real news = 1
fake_df["label"] = 0
true_df["label"] = 1

# ---------- Step 3: Combine into a single dataset ----------
combined_df = pd.concat([fake_df, true_df], ignore_index=True)

# Shuffle the rows so fake/real are mixed, not in blocks
combined_df = combined_df.sample(frac=1, random_state=42).reset_index(drop=True)

print("\n" + "=" * 50)
print("COMBINED DATASET (ready for training)")
print("=" * 50)
print("Total rows:", combined_df.shape[0])
print("\nLabel counts:")
print(combined_df["label"].value_counts())
print("\nSample rows:")
print(combined_df.head(5))

# ---------- Step 4: Save the combined dataset ----------
combined_df.to_csv("datasets/01_Fake_News_Detection/combined_fake_real.csv", index=False)
print("\nSaved combined dataset to: datasets/01_Fake_News_Detection/combined_fake_real.csv")