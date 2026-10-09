---
name: recall
description: Recall past Pi/Codex session decisions with the tireless_recall and tireless_session tools. Use when the user refers to earlier sessions, past decisions, "what did we decide", or "last time".
---

# Recall

Search past Pi/Codex sessions to answer the user's surrounding message. The user's text is the task, not the search query: work out what past context it needs, then search for that.

## Workflow

1. Write 1–3 short queries in the user's own terms: names, errors, decisions. Paraphrases help because search is hybrid (BM25 + embeddings).
2. Call `tireless_recall` for each query. Add `project` when the user names a repo. Add `session` when you already know the session.
3. A promising hit without enough context → call `tireless_session` with that hit's `session_id` and `after_ts` = `metadata.timestamp`. Read only the turns around the hit, not the whole session.
4. Answer the user's actual question and cite what you used (session id, date, project). Separate what the session says from your own inference.

## Rules

- Only past session decisions and discussion. For repository code use `grep`/`semantic_search`.
- No relevant hits → say so and list the queries you tried. Never fill gaps from memory.
- Past decisions may be out of date: check the current code or config before acting on them.
