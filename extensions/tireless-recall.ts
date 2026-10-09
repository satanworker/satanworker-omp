const SNIPPET = 500;
const QUERY_LIMIT = 5;
const SESSION_LIMIT = 8;
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
	forward_content?: string;
	metadata?: Record<string, unknown>;
};

function formatHits(raw: string): { text: string; hitCount: number } {
	const parsed = JSON.parse(raw) as { results?: Hit[] };
	const hits = parsed.results ?? [];
	if (hits.length === 0) return { text: "No matches found.", hitCount: 0 };
	const blocks = hits.map((h, i) => {
		const m = h.metadata ?? {};
		const head = [
			`${i + 1}. score=${typeof h.score === "number" ? h.score.toFixed(2) : "?"}`,
			`${m.host ?? "?"}/${m.harness ?? "?"}`,
			m.project_name ?? "?",
			`session=${m.session_id ?? "?"}`,
			m.timestamp ?? "",
			m.role ?? "",
		].join(" ");
		return `${head}\nid=${h.id ?? ""}\n${snippet(String(h.forward_content ?? ""))}`;
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
		query: z.string().describe("Search past Pi/Codex session turns"),
		limit: z.number().optional().describe("Hits to return (default 5, max 8)"),
		session: z.string().optional().describe("Restrict to this session_id"),
		project: z.string().optional().describe("Optional project_name filter"),
	});
	const sessionSchema = z.object({
		session_id: z.string().describe("Session id from a recall hit"),
		limit: z.number().optional().describe("Turns to return (default 8, max 20)"),
		after_ts: z.number().optional().describe("Walk from this timestamp (use hit metadata.timestamp)"),
		after_id: z.string().optional().describe("Walk after this record id"),
		host: z.string().optional().describe("Machine tag, e.g. mbp14"),
		harness: z.string().optional().describe("pi or codex"),
	});

	async function runTireless(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
		const result = await pi.exec("tireless", args, { cwd, signal, timeout: 60_000 });
		if (result.code !== 0) {
			throw new Error((result.stderr || result.stdout || "tireless failed").trim());
		}
		return result.stdout.trim() || "{}";
	}

	async function recall(params: {
		query: string;
		limit?: number;
		session?: string;
		project?: string;
	}, cwd: string, signal?: AbortSignal) {
		const limit = clamp(params.limit, QUERY_LIMIT, 8);
		const args = ["query", "-embed", "-limit", String(limit)];
		if (params.session) args.push("-session", params.session);
		if (params.project) args.push("-project", params.project);
		args.push(params.query);
		const formatted = formatHits(await runTireless(args, cwd, signal));
		const out = applyTruncation(formatted.text);
		return { text: out.text, hitCount: formatted.hitCount, truncation: out.truncation };
	}

	pi.registerCommand("recall", {
		description: "Search indexed Pi/Codex sessions (hybrid BM25+ANN)",
		handler: async (args: string, ctx: { cwd: string; ui: { notify: (msg: string, kind: string) => void } }) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("usage: /recall <query>", "error");
				return;
			}
			const out = await recall({ query }, ctx.cwd);
			pi.sendMessage({ customType: "tireless-recall", content: out.text, display: true });
			ctx.ui.notify(`recall: ${out.hitCount} hits`, out.hitCount ? "info" : "warning");
		},
	});

	pi.registerTool({
		name: "tireless_recall",
		label: "tireless_recall",
		description: `Search past Pi and Codex session turns via tireless-ledger (hybrid BM25+ANN). Output truncated to ${MAX_LINES} lines or ${formatSize(MAX_BYTES)}.`,
		promptSnippet: "Past Pi/Codex session recall (decisions, not code search).",
		promptGuidelines: [
			"Use tireless_recall for past Pi/Codex session decisions. Do not use it for repository code; use grep or semantic_search.",
			"Use tireless_session with after_ts from a hit when neighboring turns are needed. Do not dump whole sessions.",
		],
		parameters: recallSchema,
		async execute(_id: string, params: { query: string; limit?: number; session?: string; project?: string }, signal: AbortSignal, _onUpdate: unknown, ctx: { cwd: string }) {
			const out = await recall(params, ctx.cwd, signal);
			return {
				content: [{ type: "text", text: out.text }],
				details: { hitCount: out.hitCount, query: params.query, truncation: out.truncation },
			};
		},
	});

	pi.registerTool({
		name: "tireless_session",
		label: "tireless_session",
		description: "Walk turns in one indexed session. Prefer after_ts from a tireless_recall hit.",
		parameters: sessionSchema,
		async execute(_id: string, params: {
			session_id: string;
			limit?: number;
			after_ts?: number;
			after_id?: string;
			host?: string;
			harness?: string;
		}, signal: AbortSignal, _onUpdate: unknown, ctx: { cwd: string }) {
			const limit = clamp(params.limit, SESSION_LIMIT, 20);
			const args = ["session", "-limit", String(limit)];
			if (params.after_ts) args.push("-after-ts", String(Math.trunc(params.after_ts)));
			if (params.after_id) args.push("-after-id", params.after_id);
			if (params.host) args.push("-session-host", params.host);
			if (params.harness) args.push("-harness", params.harness);
			args.push(params.session_id);
			const formatted = formatHits(await runTireless(args, ctx.cwd, signal));
			const out = applyTruncation(formatted.text);
			return {
				content: [{ type: "text", text: out.text }],
				details: { hitCount: formatted.hitCount, session_id: params.session_id, truncation: out.truncation },
			};
		},
	});
}
