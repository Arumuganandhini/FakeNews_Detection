"""
Module 7 - Multilingual (Tamil)
Step 1: Tamil dataset explore pannuradhu
"""

import pandas as pd

DATA_PATH = "datasets/07_Multilingual/DravidianCodeMix-2020/DravidianCodeMix/tamil_offensive_full.csv"

# Tab-separated file
df = pd.read_csv(DATA_PATH, sep="\t", header=None, names=["label", "text"], on_bad_lines="skip", engine="python")

print("=" * 50)
print("TAMIL OFFENSIVE DATASET")
print("=" * 50)
print("Shape (rows, columns):", df.shape)
print("\nFirst 5 rows:")
print(df.head(5))

print("\nLabel distribution:")
print(df["label"].value_counts())