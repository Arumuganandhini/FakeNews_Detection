"""
Module 8 - News Propagation
Step 2: Analyze spread patterns (tweet counts) for fake vs real news
"""

import pandas as pd

FILES = {
    "politifact_fake": ("datasets/08_News_Propagation/politifact_fake.csv", "fake", "politifact"),
    "politifact_real": ("datasets/08_News_Propagation/politifact_real (1).csv", "real", "politifact"),
    "gossipcop_fake": ("datasets/08_News_Propagation/gossipcop_fake.csv", "fake", "gossipcop"),
    "gossipcop_real": ("datasets/08_News_Propagation/gossipcop_real.csv", "real", "gossipcop"),
}

all_rows = []

for name, (path, label, source) in FILES.items():
    df = pd.read_csv(path)

    # Count number of tweets per article (spread count)
    def count_tweets(tweet_ids):
        if pd.isna(tweet_ids) or str(tweet_ids).strip() == "":
            return 0
        return len(str(tweet_ids).split("\t"))

    df["tweet_count"] = df["tweet_ids"].apply(count_tweets)
    df["label"] = label
    df["source"] = source

    all_rows.append(df[["id", "title", "tweet_count", "label", "source"]])

combined = pd.concat(all_rows, ignore_index=True)

print("=" * 50)
print("PROPAGATION ANALYSIS")
print("=" * 50)
print("Total articles:", combined.shape[0])

print("\nAverage tweet count (spread) by label:")
print(combined.groupby("label")["tweet_count"].mean())

print("\nMedian tweet count (spread) by label:")
print(combined.groupby("label")["tweet_count"].median())

print("\nMax tweet count by label:")
print(combined.groupby("label")["tweet_count"].max())

print("\nBreakdown by source and label:")
print(combined.groupby(["source", "label"])["tweet_count"].agg(["mean", "median", "count"]))

# ---------- Save the combined analysis dataset ----------
OUTPUT_PATH = "datasets/08_News_Propagation/propagation_analysis.csv"
combined.to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved to: {OUTPUT_PATH}")