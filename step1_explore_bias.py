"""
Module 3 - Bias Detection
Step 1: MBIC Dataset explore pannuradhu
"""

import pandas as pd

DATA_PATH = "datasets/03_Bias_Detection/final_labels_MBIC.csv"

# MBIC dataset semicolon-separated irukalam, adhunala sep=";" try pannuvom
try:
    df = pd.read_csv(DATA_PATH, sep=";")
    if df.shape[1] == 1:
        # semicolon la work aagalana, comma try pannuvom
        df = pd.read_csv(DATA_PATH, sep=",")
except Exception as e:
    print("Error with ';' separator, trying ',' ...")
    df = pd.read_csv(DATA_PATH, sep=",")

print("=" * 50)
print("MBIC BIAS DATASET")
print("=" * 50)
print("Shape (rows, columns):", df.shape)
print("\nColumns:", list(df.columns))
print("\nFirst 5 rows:")
print(df.head(5))

print("\nColumn data types:")
print(df.dtypes)

print("\nMissing values per column:")
print(df.isnull().sum())

# Try to find the bias label column and show its unique values
for col in df.columns:
    if "bias" in col.lower() or "label" in col.lower():
        print(f"\nUnique values in '{col}':")
        print(df[col].value_counts())