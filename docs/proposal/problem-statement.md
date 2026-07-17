# Problem Statement

## Project Title

AI-Powered News Trust and Credibility Analysis Platform

## Domain

Artificial Intelligence · Natural Language Processing · Explainable AI (XAI)

## The Problem

The rapid growth of digital media has made it difficult for users to determine
whether a news article is trustworthy. Existing fake-news detection systems
mainly classify news as either "Fake" or "Real". They do not explain their
decision, do not evaluate the news source, do not detect biased language, and
do not verify claims against other outlets. Their confidence values are also
usually uncalibrated — a system may claim 90% certainty while being right far
less often.

As a result, users may see a label but still cannot judge **why** an article
should or should not be trusted.

## Objectives

1. Analyze every news article from four independent angles — source
   reputation, headline quality, biased language, and cross-source claim
   verification — instead of one black-box prediction.
2. Show users the exact evidence behind each factor: matched source ratings,
   named clickbait signals, highlighted biased sentences, and links to
   coverage from other outlets.
3. Combine the factors into a transparent weighted trust score that anyone
   can audit.
4. Calibrate the score so that its confidence is honest (a 70% trust score is
   correct about 70% of the time).
5. Deliver everything in a working web application with a measurable,
   reproducible evaluation.

## Scope

**In scope:** English-language news articles fetched daily via NewsAPI;
LLM-based analysis (Llama 3.1 via NVIDIA NIM); evaluation on the public ISOT
dataset; a React + Node.js/Express + MongoDB web platform.

**Out of scope (deliberate):** multilingual analysis, AI-generated image
detection, social-media propagation tracking, and real-time streaming
monitoring. These were excluded to keep the system focused, practical, and
fully implementable within the project timeline.

## Expected Outcome

A deployed platform where a user opens any article, clicks "Analyze
Trustworthiness", and receives an explainable trust report — plus a
quantitative evaluation showing the multi-factor design outperforms a
single-prompt LLM baseline on a standard benchmark.
