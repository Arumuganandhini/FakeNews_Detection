"""
Module 8 - News Propagation
Step 1: FakeNewsNet dataset explore pannuradhu
"""

import pandas as pd

FILES = {
    "politifact_fake": "datasets/08_News_Propagation/politifact_fake.csv",
    "politifact_real": "datasets/08_News_Propagation/politifact_real (1).csv",
    "gossipcop_fake": "datasets/08_News_Propagation/gossipcop_fake.csv",
    "gossipcop_real": "datasets/08_News_Propagation/gossipcop_real.csv",
}

for name, path in FILES.items():
    print("=" * 50)
    print(name.upper())
    print("=" * 50)
    try:
        df = pd.read_csv(path)
        print("Shape:", df.shape)
        print("Columns:", list(df.columns))
        print("First 2 rows:")
        print(df.head(2))
    except FileNotFoundError:
        print(f"File not found: {path}")
    print()