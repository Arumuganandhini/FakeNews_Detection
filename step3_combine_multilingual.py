"""
Module 7 - Multilingual
Step 3: Combine Tamil + Malayalam into one multilingual dataset
"""

import pandas as pd

tamil_df = pd.read_csv("datasets/07_Multilingual/cleaned_tamil.csv")
malayalam_df = pd.read_csv("datasets/07_Multilingual/cleaned_malayalam.csv")

tamil_df["language"] = "tamil"
malayalam_df["language"] = "malayalam"

combined = pd.concat([tamil_df, malayalam_df], ignore_index=True)

# Shuffle
combined = combined.sample(frac=1, random_state=42).reset_index(drop=True)

print("Tamil rows:", tamil_df.shape[0])
print("Malayalam rows:", malayalam_df.shape[0])
print("Combined rows:", combined.shape[0])

print("\nLabel distribution (combined):")
print(combined["label"].value_counts())

print("\nLabel distribution by language:")
print(combined.groupby("language")["label"].value_counts())

OUTPUT_PATH = "datasets/07_Multilingual/cleaned_multilingual.csv"
combined[["content", "label", "language"]].to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved combined dataset to: {OUTPUT_PATH}")