"""
diagnose_multilingual_model.py

Quick sanity check: does the trained model actually give DIFFERENT
probabilities for different inputs, or is it stuck outputting a
near-constant score regardless of text (majority-class collapse)?

Run from the project root:
    python diagnose_multilingual_model.py
"""

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

MODEL_PATH = "models/multilingual_bert_model"

print("Loading model...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)
model.eval()

test_cases = [
    ("Not offensive expected", "Kollaam"),
    ("Not offensive expected", "Marana Maaaasssaaa Thala ... I am waiting"),
    ("Offensive expected", "Eth vetavalliyanmara dislike adiche.."),
    ("Offensive expected", "Dislike chydha appa illaathavanmmaar bloody fools"),
    ("Offensive expected", "Enna da over buildup ah iruku"),
    ("Random gibberish", "asdkfj alskdjf laksjdf laksjdflaksjdf"),
]

print(f"\n{'Expected':<28} {'Offensive%':<12} {'Text'}")
print("-" * 80)
for label, text in test_cases:
    inputs = tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=128)
    with torch.no_grad():
        outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)
    offensive_prob = probs[0][1].item()
    print(f"{label:<28} {offensive_prob*100:>6.2f}%      {text[:50]}")

print("\nRaw logits for the last input (sanity check they aren't frozen/identical):")
print(outputs.logits)