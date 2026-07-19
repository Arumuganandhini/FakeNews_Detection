"""
Module 4 - Clickbait Detection
Step 1: Clickbait Dataset explore pannuradhu
"""

import pandas as pd

DATA_PATH = "datasets/04_Clickbait_Detection/clickbait_data.csv"

df = pd.read_csv(DATA_PATH)

print("=" * 50)
print("CLICKBAIT DATASET")
print("=" * 50)
print("Shape (rows, columns):", df.shape)
print("\nColumns:", list(df.columns))
print("\nFirst 5 rows:")
print(df.head(5))

print("\nColumn data types:")
print(df.dtypes)

print("\nMissing values per column:")
print(df.isnull().sum())

# Try to find the label column and show its unique values
for col in df.columns:
    if "click" in col.lower() or "label" in col.lower() or "target" in col.lower():
        print(f"\nUnique values in '{col}':")
        print(df[col].value_counts())