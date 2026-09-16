"""
step4_train_multilingual.py

Trains the binary Offensive / Not_offensive classifier used by
render_multilingual() -> Tab 2 (Toxic / Offensive Content Check) in app.py.

Data source: datasets/07_Multilingual/cleaned_multilingual.csv
    Format (no header row observed in the sample, 3 columns):
        text, label, language
    where label is ALREADY binary: 0 = Not_offensive, 1 = Offensive
    and language is "tamil" or "malayalam".

    If your actual file DOES have a header row, the loader below detects
    and handles that automatically.

Saves the fine-tuned model + tokenizer to:
    models/multilingual_bert_model/

Run from the project root (same folder as app.py):
    python step4_train_multilingual.py
"""

import os
import sys

# ------------------------------------------------------------------
# IMPORTANT: this project has a local folder literally named
# "datasets" (datasets/07_Multilingual/...). When this script runs
# from the project root, Python's default sys.path includes the
# script's own directory FIRST -- so "import datasets" (used
# internally by transformers/Trainer) would otherwise resolve to
# our local folder instead of the installed Hugging Face `datasets`
# pip package, causing AttributeError: module 'datasets' has no
# attribute 'Dataset'. Stripping the script's directory from
# sys.path (only for import resolution -- this does NOT affect
# os.path/CSV_PATH, which uses the current working directory)
# forces Python to use the real installed package instead.
_this_dir = os.path.dirname(os.path.abspath(__file__))
sys.path = [p for p in sys.path if os.path.abspath(p) != _this_dir]
# ------------------------------------------------------------------

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)

# ----------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------
CSV_PATH = os.path.join("datasets", "07_Multilingual", "cleaned_multilingual.csv")
MODEL_NAME = "xlm-roberta-base"
OUTPUT_DIR = "models/multilingual_bert_model"
MAX_LEN = 128
NUM_EPOCHS = 3
BATCH_SIZE = 16
SEED = 42


def load_dataset(path):
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Could not find '{path}'. Update CSV_PATH at the top of this "
            f"script if cleaned_multilingual.csv lives somewhere else."
        )

    # Try reading with no header first (matches the sample rows seen).
    df = pd.read_csv(
        path,
        header=None,
        names=["text", "label", "language"],
        encoding="utf-8",
        quoting=0,  # standard CSV quoting; handles the quoted commas seen in samples
        on_bad_lines="skip",
    )

    # If the first row turned out to actually be a header (e.g. "text,label,language"),
    # drop it.
    if str(df.iloc[0]["label"]).strip().lower() in ("label", "binary_label"):
        df = df.iloc[1:].reset_index(drop=True)

    df["text"] = df["text"].astype(str)
    df["label"] = pd.to_numeric(df["label"], errors="coerce")

    before = len(df)
    df = df.dropna(subset=["label", "text"])
    df = df[df["text"].str.strip() != ""]
    df["label"] = df["label"].astype(int)
    after = len(df)

    print(f"Loaded {before} rows, kept {after} after cleaning.")
    print("Label counts:\n", df["label"].value_counts())
    if "language" in df.columns:
        print("Language counts:\n", df["language"].value_counts())

    return df


class OffensiveDataset(torch.utils.data.Dataset):
    def __init__(self, encodings, labels):
        self.encodings = encodings
        self.labels = labels

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        item = {k: torch.tensor(v[idx]) for k, v in self.encodings.items()}
        item["labels"] = torch.tensor(self.labels[idx])
        return item


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    return {
        "accuracy": accuracy_score(labels, preds),
        "f1": f1_score(labels, preds),
    }


def main():
    df = load_dataset(CSV_PATH)

    train_texts, val_texts, train_labels, val_labels = train_test_split(
        df["text"].tolist(),
        df["label"].tolist(),
        test_size=0.1,
        random_state=SEED,
        stratify=df["label"].tolist(),
    )

    print(f"\nLoading tokenizer/model: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, num_labels=2)

    train_enc = tokenizer(train_texts, truncation=True, padding=True, max_length=MAX_LEN)
    val_enc = tokenizer(val_texts, truncation=True, padding=True, max_length=MAX_LEN)

    train_dataset = OffensiveDataset(train_enc, train_labels)
    val_dataset = OffensiveDataset(val_enc, val_labels)

    training_args = TrainingArguments(
        output_dir="./_multilingual_train_checkpoints",
        num_train_epochs=NUM_EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_steps=50,
        seed=SEED,
        fp16=torch.cuda.is_available(),
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        compute_metrics=compute_metrics,
    )

    print("\nStarting training...")
    trainer.train()

    print("\nFinal evaluation:")
    metrics = trainer.evaluate()
    print(metrics)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    trainer.save_model(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    print(f"\nModel + tokenizer saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()