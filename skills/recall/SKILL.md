---
name: recall
description: Recall past decisions from agent sessions (Pi, Codex, omp, ...) and Telegram chats with the tireless_recall and tireless_session tools. Use when the user refers to earlier sessions or chats, past decisions, "what did we decide", or "last time".
---

# Recall

Search past agent sessions and Telegram chats to answer the user's surrounding message. The user's text is the task, not the search query: work out what past context it needs, then search for that.

## Workflow

1. Write 1–3 short queries in the user's own terms: names, errors, decisions. Paraphrases help because search is hybrid (BM25 + embeddings).
2. Call `tireless_recall` for each query. Add `project` when the user names a repo, `source` (e.g. `telegram`, `pi`, `codex`) when they name where it was said, and `container` when you already know the session or chat.
3. A promising hit without enough context → call `tireless_session` with that hit's `container_id` and `after_ts` = its `ts`. Read only the messages around the hit, not the whole session or chat.
4. Answer the user's actual question and cite what you used (source, container, author, date, project). Separate what the session or chat says from your own inference.

## Rules

- Only past decisions and discussion. For repository code use `grep`/`semantic_search`.
- No relevant hits → say so and list the queries you tried. Never fill gaps from memory.
- Past decisions may be out of date: check the current code or config before acting on them.
