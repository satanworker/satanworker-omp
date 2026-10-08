// schema-diagram: table spec JSON -> ELK layered layout -> compact SVG coloured with omp theme variables.
// Usage: schema-diagram [spec.json|-] [--preview out.svg]
import type { ElkNode } from "elkjs/lib/elk.bundled.js";
// Bun defines `self`, so elk-worker thinks it runs inside a Web Worker and never exports its in-process fallback.
// Dynamic import: `self` must be gone before elkjs evaluates, and static imports are hoisted above this line.
Reflect.deleteProperty(globalThis, "self");
const { default: ELK } = await import("elkjs/lib/elk.bundled.js");

type Field = { name: string; type: string; key?: "PK" | "FK" };
type Table = { id: string; kind?: string; name: string; fields: Field[]; more?: number; focus?: boolean };
type Group = { id: string; kind: string; name: string; children: string[] };
type Edge = { from: string; to: string; label?: string; focus?: boolean };
type Spec = { tables: Table[]; groups?: Group[]; edges: Edge[] };

const HEAD = 30, ROW = 24;

function fail(msg: string): never {
  console.error(`schema-diagram: ${msg}`);
  process.exit(1);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function str(o: Record<string, unknown>, k: string, at: string): string {
  if (typeof o[k] !== "string" || o[k] === "") fail(`${at}.${k} must be a non-empty string`);
  return o[k];
}
function optStr(o: Record<string, unknown>, k: string, at: string): string | undefined {
  return o[k] === undefined ? undefined : str(o, k, at);
}
function optBool(o: Record<string, unknown>, k: string, at: string): boolean | undefined {
  const v = o[k];
  if (v !== undefined && typeof v !== "boolean") fail(`${at}.${k} must be true or false`);
  return v;
}
function arr(o: Record<string, unknown>, k: string, at: string): unknown[] {
  if (!Array.isArray(o[k])) fail(`${at}.${k} must be an array`);
  return o[k];
}

// The spec is written by an agent, so check shape and every cross-reference before layout.
function parseSpec(raw: unknown): Spec {
  if (!isObj(raw)) fail("spec must be a JSON object");
  const tables = arr(raw, "tables", "spec").map((t, i): Table => {
    const at = `tables[${i}]`;
    if (!isObj(t)) fail(`${at} must be an object`);
    const fields = arr(t, "fields", at).map((f, j): Field => {
      const fat = `${at}.fields[${j}]`;
      if (!isObj(f)) fail(`${fat} must be an object`);
      const key = f.key;
      if (key !== undefined && key !== "PK" && key !== "FK") fail(`${fat}.key must be "PK" or "FK"`);
      return { name: str(f, "name", fat), type: str(f, "type", fat), key };
    });
    const more = t.more;
    if (more !== undefined && (typeof more !== "number" || !Number.isInteger(more) || more < 0)) fail(`${at}.more must be a non-negative integer`);
    return { id: str(t, "id", at), kind: optStr(t, "kind", at), name: str(t, "name", at), fields, more, focus: optBool(t, "focus", at) };
  });
  const groups = raw.groups === undefined ? [] : arr(raw, "groups", "spec").map((g, i): Group => {
    const at = `groups[${i}]`;
    if (!isObj(g)) fail(`${at} must be an object`);
    return { id: str(g, "id", at), kind: str(g, "kind", at), name: str(g, "name", at), children: arr(g, "children", at).map((c) => typeof c === "string" ? c : fail(`${at}.children must hold table ids`)) };
  });
  const edges = arr(raw, "edges", "spec").map((e, i): Edge => {
    const at = `edges[${i}]`;
    if (!isObj(e)) fail(`${at} must be an object`);
    return { from: str(e, "from", at), to: str(e, "to", at), label: optStr(e, "label", at), focus: optBool(e, "focus", at) };
  });

  const byId = new Map<string, Table>();
  for (const t of tables) {
    if (byId.has(t.id)) fail(`duplicate table id "${t.id}"`);
    byId.set(t.id, t);
  }
  const placed = new Set<string>();
  for (const g of groups) {
    if (byId.has(g.id)) fail(`group id "${g.id}" collides with a table id`);
    for (const c of g.children) {
      if (!byId.has(c)) fail(`group "${g.id}" lists unknown table "${c}"`);
      if (placed.has(c)) fail(`table "${c}" is in more than one group`);
      placed.add(c);
    }
  }
  for (const e of edges) {
    for (const ref of [e.from, e.to]) {
      const [tid, field] = ref.split(".", 2);
      const t = byId.get(tid);
      if (!t) fail(`edge "${e.from} -> ${e.to}": unknown table "${tid}"`);
      if (field !== undefined && !t.fields.some((f) => f.name === field)) fail(`edge "${e.from} -> ${e.to}": table "${tid}" has no field "${field}"`);
    }
  }
  return { tables, groups, edges };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const r = Math.round;

// omp maps var(--surface) to the theme's selection colour, so boxes use a faint fg tint that works on light and dark.
const STYLE = `.g{fill:var(--fg);fill-opacity:.025;stroke:var(--border)}
.b{fill:var(--fg);fill-opacity:.035;stroke:var(--border)}.f{fill:var(--accent);fill-opacity:.07;stroke:var(--accent);stroke-width:1.6}
.r{fill:none;stroke:var(--border)}.s{fill:url(#s)}
.k{font-size:9px;letter-spacing:1.5px;fill:var(--muted)}.h{font-size:13px;font-weight:bold;fill:var(--fg)}
.c{font-size:12px;fill:var(--fg)}.t{font-size:10.5px;fill:var(--muted);text-anchor:end}.m{font-size:10.5px;fill:var(--muted)}
.e{fill:none;stroke:var(--muted);stroke-width:1.1;stroke-opacity:.8}.ea{fill:none;stroke:var(--accent);stroke-width:1.6}
.d{fill:var(--muted)}
.lb{fill:var(--surface);stroke:var(--border)}.la{fill:var(--surface);stroke:var(--accent)}.lt{font-size:10.5px;fill:var(--muted);text-anchor:middle}`;
const DEFS = `<pattern id="s" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="10" fill="var(--accent)" fill-opacity=".16"/></pattern>
<marker id="m" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--muted)"/></marker>
<marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--accent)"/></marker>
<g id="PK"><rect width="22" height="16" rx="3" fill="var(--warning)" fill-opacity=".18"/><text x="11" y="12" font-size="9" font-weight="bold" text-anchor="middle" fill="var(--warning)">PK</text></g>
<g id="FK"><rect width="22" height="16" rx="3" fill="var(--accent)" fill-opacity=".18"/><text x="11" y="12" font-size="9" font-weight="bold" text-anchor="middle" fill="var(--accent)">FK</text></g>`;

export async function render(spec: Spec): Promise<string> {
  const byId = new Map(spec.tables.map((t) => [t.id, t]));
  const size = new Map<string, { w: number; h: number }>();
  for (const t of spec.tables) {
    // Monospace estimate, generous so a wider fallback font still leaves a gap between name and type.
    const w = r(Math.max(
      (t.kind ?? "table").length * 7 + t.name.length * 8.4 + 40,
      ...t.fields.map((f) => (f.key ? 30 : 0) + f.name.length * 7.6 + f.type.length * 6.8 + 52),
    ));
    size.set(t.id, { w, h: HEAD + (t.fields.length + (t.more ? 1 : 0)) * ROW + (t.fields.length || t.more ? 0 : 14) });
  }
  const node = (t: Table): ElkNode => {
    const { w, h } = size.get(t.id)!;
    // Each field gets a port at its row centre on both sides, so edges start and end on the row.
    const ports = t.fields.flatMap((f, i) => [
      { id: `${t.id}.${f.name}:W`, x: 0, y: HEAD + i * ROW + ROW / 2, width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } },
      { id: `${t.id}.${f.name}:E`, x: w, y: HEAD + i * ROW + ROW / 2, width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" } },
    ]);
    return { id: t.id, width: w, height: h, ports, layoutOptions: { "elk.portConstraints": "FIXED_POS" } };
  };
  const grouped = new Set(spec.groups?.flatMap((g) => g.children));
  // Layout options follow Whiteboard Desktop's canvas: layered, orthogonal, children inside their group.
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64", "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.spacing.edgeNodeBetweenLayers": "16", "elk.spacing.edgeEdge": "10",
      "elk.json.edgeCoords": "ROOT", "elk.json.shapeCoords": "ROOT", "elk.padding": "[top=16,left=16,bottom=16,right=16]",
    },
    children: [
      ...(spec.groups ?? []).map((g) => ({
        // Spacing options are per parent, so groups repeat the root's layer spacing.
        id: g.id, layoutOptions: { "elk.padding": "[top=46,left=20,bottom=20,right=20]", "elk.layered.spacing.nodeNodeBetweenLayers": "64", "elk.layered.spacing.edgeNodeBetweenLayers": "16" },
        children: g.children.map((c) => node(byId.get(c)!)),
      })),
      ...spec.tables.filter((t) => !grouped.has(t.id)).map(node),
    ],
    edges: spec.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.from.includes(".") ? `${e.from}:E` : e.from],
      targets: [e.to.includes(".") ? `${e.to}:W` : e.to],
      labels: e.label ? [{ text: e.label, width: e.label.length * 6.4 + 16, height: 20 }] : [],
    })),
  };
  const out = await new ELK().layout(graph);

  // shapeCoords=ROOT: every node box is already absolute.
  const box = new Map<string, { x: number; y: number; width: number; height: number }>();
  const collect = (n: ElkNode): void => {
    box.set(n.id, { x: r(n.x ?? 0), y: r(n.y ?? 0), width: r(n.width ?? 0), height: r(n.height ?? 0) });
    n.children?.forEach(collect);
  };
  collect(out);

  const svg: string[] = [];
  for (const g of spec.groups ?? []) {
    const { x, y, width, height } = box.get(g.id)!;
    svg.push(`<rect class="g" x="${x}" y="${y}" width="${width}" height="${height}" rx="8"/><text class="k" x="${x + 16}" y="${y + 24}">${esc(g.kind.toUpperCase())}</text><text class="h" x="${r(x + 28 + g.kind.length * 7)}" y="${y + 24}">${esc(g.name)}</text>`);
  }
  const dots = new Set<string>(), labels: string[] = [];
  for (const [i, e] of spec.edges.entries()) {
    const oe = out.edges!.find((x) => x.id === `e${i}`)!;
    for (const s of oe.sections ?? []) {
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      svg.push(`<path class="${e.focus ? "ea" : "e"}" marker-end="url(#${e.focus ? "a" : "m"})" d="M${pts.map((p) => `${r(p.x)} ${r(p.y)}`).join("L")}"/>`);
      dots.add(`<circle class="d" cx="${r(s.startPoint.x)}" cy="${r(s.startPoint.y)}" r="3"/>`);
      if (!e.label) continue;
      // ELK reserves room for the label; draw it centred on the longest horizontal run so it sits on its own line.
      let best = { x: (pts[0].x + pts[1].x) / 2, y: pts[0].y, len: -1 };
      for (let k = 1; k < pts.length; k++) {
        const len = Math.abs(pts[k].x - pts[k - 1].x);
        if (pts[k].y === pts[k - 1].y && len > best.len) best = { x: (pts[k].x + pts[k - 1].x) / 2, y: pts[k].y, len };
      }
      const w = r(e.label.length * 6.8 + 16);
      labels.push(`<rect class="${e.focus ? "la" : "lb"}" x="${r(best.x - w / 2)}" y="${r(best.y - 10)}" width="${w}" height="20" rx="10"/><text class="lt" x="${r(best.x)}" y="${r(best.y + 4)}">${esc(e.label)}</text>`);
    }
  }
  for (const t of spec.tables) {
    const { x, y, width: w, height: h } = box.get(t.id)!;
    const kind = t.kind ?? "table";
    const rows = [`<g transform="translate(${x} ${y})"><rect class="${t.focus ? "f" : "b"}" width="${w}" height="${h}" rx="6"/><text class="k" x="12" y="20">${esc(kind.toUpperCase())}</text><text class="h" x="${r(22 + kind.length * 7)}" y="20">${esc(t.name)}</text>`];
    const lines = t.fields.map((_, i) => `M0 ${HEAD + i * ROW}h${w}`);
    if (t.more) lines.push(`M0 ${HEAD + t.fields.length * ROW}h${w}`);
    t.fields.forEach((f, i) => {
      const top = HEAD + i * ROW, base = top + 16;
      if (f.key === "PK") rows.push(`<rect class="s" x="1" y="${top}" width="${w - 2}" height="${ROW}"/>`);
      if (f.key) rows.push(`<use href="#${f.key}" x="12" y="${top + 4}"/>`);
      rows.push(`<text class="c" x="${f.key ? 42 : 12}" y="${base}">${esc(f.name)}</text><text class="t" x="${w - 12}" y="${base}">${esc(f.type)}</text>`);
    });
    if (t.more) rows.push(`<text class="m" x="12" y="${HEAD + t.fields.length * ROW + 16}">+ ${t.more} more columns</text>`);
    if (lines.length) rows.push(`<path class="r" d="${lines.join("")}"/>`);
    svg.push(rows.join("") + "</g>");
  }
  return `<svg viewBox="0 0 ${r(out.width!)} ${r(out.height!)}" xmlns="http://www.w3.org/2000/svg" font-family="Berkeley Mono,Menlo,monospace">
<style>${STYLE}</style>
<defs>${DEFS}</defs>
${[...svg, ...dots, ...labels].join("\n")}
</svg>
`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--preview");
  const preview = pi >= 0 ? args.splice(pi, 2)[1] ?? fail("--preview needs an output path") : undefined;
  if (args.length > 1 || args[0]?.startsWith("-") && args[0] !== "-") fail("usage: schema-diagram [spec.json|-] [--preview out.svg]");
  const text = !args[0] || args[0] === "-" ? await Bun.stdin.text() : await Bun.file(args[0]).text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    fail(`spec is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const svg = await render(parseSpec(raw));
  process.stdout.write(svg);
  if (preview) {
    // Same SVG with a dark palette baked in, for rasterizers that do not know omp's theme variables.
    const palette: Record<string, string> = { surface: "#12161e", fg: "#e8eaef", muted: "#9199a8", border: "#39404d", accent: "#5b7cff", warning: "#f2c14e" };
    await Bun.write(preview, svg.replace(/var\(--(\w+)\)/g, (_, k: string) => palette[k] ?? k).replace("<defs>", `<rect width="100%" height="100%" fill="#0c0f15"/><defs>`));
  }
}
