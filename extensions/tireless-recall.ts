const SNIPPET = 500;
const QUERY_LIMIT = 5;
const CONTAINER_LIMIT = 8;
const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

function formatSize(n: number): string {
	return `${(n / 1024).toFixed(1)}KB`;
}

function truncateHead(text: string) {
	const lines = text.split("\n");
	const totalLines = lines.length;
	const totalBytes = new TextEncoder().encode(text).length;
	let content = lines.slice(0, MAX_LINES).join("\n");
	const raw = new TextEncoder().encode(content);
	if (raw.length > MAX_BYTES) content = new TextDecoder().decode(raw.slice(0, MAX_BYTES));
	const outputBytes = new TextEncoder().encode(content).length;
	const outputLines = content ? content.split("\n").length : 0;
	return {
		content,
		truncated: outputLines < totalLines || outputBytes < totalBytes,
		outputLines,
		totalLines,
		outputBytes,
		totalBytes,
	};
}

function clamp(n: number | undefined, fallback: number, max: number): number {
	const v = Number.isFinite(n) ? Number(n) : fallback;
	return Math.min(max, Math.max(1, Math.trunc(v)));
}

function snippet(text: string): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length <= SNIPPET ? t : `${t.slice(0, SNIPPET)}…`;
}

type Hit = {
	id?: string;
	score?: number;
	text?: string;
	metadata?: Record<string, unknown>;
};

function formatDate(ts: unknown): string {
	const n = Number(ts);
	return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 16).replace("T", " ") : "";
}

function formatHits(raw: string): { text: string; hitCount: number } {
	const parsed = JSON.parse(raw) as { results?: Hit[] };
	const hits = parsed.results ?? [];
	if (hits.length === 0) return { text: "No matches found.", hitCount: 0 };
	const blocks = hits.map((h, i) => {
		const m = h.metadata ?? {};
		const head = [
			`${i + 1}. score=${typeof h.score === "number" ? h.score.toFixed(2) : "?"}`,
			`${m.host ?? "?"}/${m.source ?? "?"}`,
			`container=${m.container_title || m.container_id || "?"}`,
			`author=${m.author_name || m.author_id || "?"}`,
			m.project ? `project=${m.project}` : "",
			formatDate(m.timestamp),
			m.kind && m.kind !== "message" ? `kind=${m.kind}` : "",
		]
			.filter(Boolean)
			.join(" ");
		const ids = [`id=${h.id ?? ""}`, `container_id=${m.container_id ?? ""}`, `ts=${m.timestamp ?? ""}`].join(" ");
		return `${head}\n${ids}\n${snippet(String(h.text ?? ""))}`;
	});
	return { text: blocks.join("\n\n"), hitCount: hits.length };
}

function applyTruncation(text: string) {
	const truncation = truncateHead(text);
	if (!truncation.truncated) return { text, truncation };
	return {
		text: `${truncation.content}\n\n[Output truncated: ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)})]`,
		truncation,
	};
}

export default function tirelessRecallExtension(pi: any) {
	const z = pi.zod;
	const recallSchema = z.object({
		query: z.string().describe("Search past agent sessions and Telegram chats"),
		limit: z.number().optional().describe("Hits to return (default 5, max 8)"),
		container: z.string().optional().describe("Restrict to this container_id (agent session id or Telegram chat id)"),
		project: z.string().optional().describe("Optional project (repo) filter"),
		source: z.string().optional().describe("Optional source filter: pi, codex, omp, claude, grok, grokbot, telegram"),
		kind: z.string().optional().describe("Optional kind filter: message, title, todo, task"),
	});
	const containerSchema = z.object({
		container_id: z.string().describe("container_id from a recall hit (session id or chat id)"),
		limit: z.number().optional().describe("Records to return (default 8, max 20)"),
		after_ts: z.number().optional().describe("Walk from this timestamp (use hit ts)"),
		after_id: z.string().optional().describe("Walk after this record id"),
		host: z.string().optional().describe("Ingesting host, e.g. mbp14"),
		source: z.string().optional().describe("pi, codex, omp, claude, grok, grokbot, telegram"),
	});

	async function runTireless(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
		const result = await pi.exec("tireless", args, { cwd, signal, timeout: 60_000 });
		if (result.code !== 0) {
			throw new Error((result.stderr || result.stdout || "tireless failed").trim());
		}
		return result.stdout.trim() || "{}";
	}

	async function search(args: string[], cwd: string, signal?: AbortSignal) {
		const start = performance.now();
		const raw = await runTireless(args, cwd, signal);
		const ms = Math.round(performance.now() - start);
		const formatted = formatHits(raw);
		const out = applyTruncation(`${formatted.hitCount} hits in ${ms}ms\n\n${formatted.text}`);
		return { text: out.text, hitCount: formatted.hitCount, ms, truncation: out.truncation };
	}

	type RecallParams = { query: string; limit?: number; container?: string; project?: string; source?: string; kind?: string };

	async function recall(params: RecallParams, cwd: string, signal?: AbortSignal) {
		const limit = clamp(params.limit, QUERY_LIMIT, 8);
		const args = ["query", "-embed", "-limit", String(limit)];
		if (params.container) args.push("-container", params.container);
		if (params.project) args.push("-project", params.project);
		if (params.source) args.push("-source", params.source);
		if (params.kind) args.push("-kind", params.kind);
		args.push(params.query);
		return search(args, cwd, signal);
	}

	pi.registerCommand("recall", {
		description: "Search indexed agent sessions and Telegram chats (hybrid BM25+ANN)",
		handler: async (args: string, ctx: { cwd: string; ui: { notify: (msg: string, kind: string) => void } }) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("usage: /recall <query>", "error");
				return;
			}
			const out = await recall({ query }, ctx.cwd);
			pi.sendMessage({ customType: "tireless-recall", content: out.text, display: true });
			ctx.ui.notify(`recall: ${out.hitCount} hits in ${out.ms}ms`, out.hitCount ? "info" : "warning");
		},
	});

	pi.registerTool({
		name: "tireless_recall",
		label: "tireless_recall",
		description: `Search past agent sessions (Pi, Codex, omp, ...) and Telegram chats via tireless-ledger (hybrid BM25+ANN). Output truncated to ${MAX_LINES} lines or ${formatSize(MAX_BYTES)}.`,
		promptSnippet: "Past agent session and Telegram chat recall (decisions, not code search).",
		promptGuidelines: [
			"Use tireless_recall for past decisions in agent sessions and Telegram chats. Do not use it for repository code; use grep or semantic_search.",
			"Use tireless_session with container_id and after_ts from a hit when neighboring messages are needed. Do not dump whole sessions or chats.",
		],
		parameters: recallSchema,
		async execute(_id: string, params: RecallParams, signal: AbortSignal, _onUpdate: unknown, ctx: { cwd: string }) {
			const out = await recall(params, ctx.cwd, signal);
			return {
				content: [{ type: "text", text: out.text }],
				details: { hitCount: out.hitCount, ms: out.ms, query: params.query, truncation: out.truncation },
			};
		},
	});

	pi.registerTool({
		name: "tireless_session",
		label: "tireless_session",
		description: "Walk messages in one indexed agent session or Telegram chat. Prefer container_id and after_ts from a tireless_recall hit.",
		parameters: containerSchema,
		async execute(_id: string, params: {
			container_id: string;
			limit?: number;
			after_ts?: number;
			after_id?: string;
			host?: string;
			source?: string;
		}, signal: AbortSignal, _onUpdate: unknown, ctx: { cwd: string }) {
			const limit = clamp(params.limit, CONTAINER_LIMIT, 20);
			const args = ["container", "-limit", String(limit)];
			if (params.after_ts) args.push("-after-ts", String(Math.trunc(params.after_ts)));
			if (params.after_id) args.push("-after-id", params.after_id);
			if (params.host) args.push("-host", params.host);
			if (params.source) args.push("-source", params.source);
			args.push(params.container_id);
			const out = await search(args, ctx.cwd, signal);
			return {
				content: [{ type: "text", text: out.text }],
				details: { hitCount: out.hitCount, ms: out.ms, container_id: params.container_id, truncation: out.truncation },
			};
		},
	});
}
