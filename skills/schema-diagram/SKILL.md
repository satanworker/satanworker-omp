---
name: schema-diagram
description: Draw database tables, columns and the links between them as an inline SVG diagram in the omp chat. Use for schemas, ER/table maps, data lineage between tables, and "which tables feed which" questions.
---

# Schema diagram

`schema-diagram` turns a JSON table spec into an SVG laid out by ELK (orthogonal lines, tables grouped by database). The SVG uses omp theme variables, so a ```svg block in your reply renders in the user's terminal colours.

## Workflow

1. Get the real columns first: DDL, migrations, `system.columns`, `information_schema`, ORM models. Never invent columns or types. A link not backed by a foreign key, catalog or code is inferred: say so in the reply.
2. Write the spec to a temp file (format below).
3. Render and preview:
   ```sh
   schema-diagram /tmp/spec.json --preview /tmp/spec.preview.svg > /tmp/spec.svg
   ```
   Then `read /tmp/spec.preview.svg:img` to check for overlaps or a wrong layout. Fix the spec, not the SVG.
4. `read /tmp/spec.svg:raw` and put its content in a ```svg block **exactly as printed**. Do not edit, reformat, dedupe or retype any part of it; a single changed number breaks the drawing. Need a change? Change the spec and re-run.

The command exits 1 with a message naming the bad path (unknown table, missing field, bad key) when the spec is wrong.

## Spec

```json
{
  "groups": [
    { "id": "pg", "kind": "database", "name": "Postgres · public", "children": ["users", "orders"] }
  ],
  "tables": [
    { "id": "users", "name": "users", "fields": [
      { "name": "id", "type": "bigint", "key": "PK" },
      { "name": "email", "type": "text" } ], "more": 6 },
    { "id": "orders", "name": "orders", "focus": true, "fields": [
      { "name": "id", "type": "bigint", "key": "PK" },
      { "name": "user_id", "type": "bigint", "key": "FK" } ] },
    { "id": "api", "kind": "component", "name": "orders-api", "fields": [] }
  ],
  "edges": [
    { "from": "orders.user_id", "to": "users.id", "focus": true },
    { "from": "api", "to": "orders.id", "label": "writes" }
  ]
}
```

- `tables[].id`: unique handle used by `groups` and `edges`; `name` is what is drawn.
- `kind`: header tag, default `table`. Use `component`, `view`, `topic`, etc. for non-table boxes; a box with no fields is fine.
- `fields[].key`: `"PK"` (striped row, amber badge) or `"FK"` (blue badge). For ClickHouse, mark the leading `ORDER BY` columns as PK and say that in the reply.
- `more`: count of columns left out; drawn as `+ N more columns`.
- `focus`: accent outline on a table or accent colour on an edge. Keep it to the 1–3 things the reader should look at first.
- `edges[].from` / `to`: `table` or `table.field`. Field ends attach to that row: `from` leaves the row's right side, `to` enters the target row's left side. Point edges from the referencing column to the referenced key.
- `label`: short text (≤ 24 chars) placed next to the edge.
- `groups[].kind`: tag such as `database` or `schema`. A table belongs to at most one group.

## Keep it readable

- 3–6 columns per table: keys, link columns, then the columns the question is about. Put the rest in `more`.
- At most about 12 tables. A bigger schema: split by subsystem into several diagrams.
- Shorten noisy types: `Nullable(Int32)` → `Int32?`, `DateTime64(6, 'UTC')` → `DateTime64`. Say in the reply that `?` means nullable.
