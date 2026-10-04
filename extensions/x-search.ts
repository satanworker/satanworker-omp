const XAI_URL = "https://api.x.ai/v1/responses";
const MODEL = "grok-4.6";
const DB = `${process.env.HOME}/.omp/agent/agent.db`;

function oauthAccess(): string | undefined {
	try {
		const { Database } = require("bun:sqlite") as {
			Database: new (path: string, opts?: { readonly?: boolean }) => {
				prepare: (sql: string) => { get: () => { data: string } | undefined };
				close: () => void;
			};
		};
		const db = new Database(DB, { readonly: true });
		const row = db
			.prepare(
				"SELECT data FROM auth_credentials WHERE provider = 'xai-oauth' AND credential_type = 'oauth' LIMIT 1",
			)
			.get();
		db.close();
		if (!row?.data) return;
		const parsed = JSON.parse(row.data) as { access?: string };
		return typeof parsed.access === "string" && parsed.access.length > 0 ? parsed.access : undefined;
	} catch {
		return;
	}
}

function token(): string {
	const value = process.env.XAI_API_KEY || oauthAccess();
	if (!value) {
		throw new Error("No xAI credentials. Run `omp login` for xai-oauth, or set XAI_API_KEY.");
	}
	return value;
}

function collectText(payload: Record<string, unknown>): string {
	const top = typeof payload.output_text === "string" ? payload.output_text.trim() : "";
	if (top) return top;
	const parts: string[] = [];
	for (const item of (payload.output as Array<{ content?: Array<{ type?: string; text?: string; output_text?: string }> }> | undefined) ?? []) {
		for (const part of item.content ?? []) {
			const text = part.output_text ?? part.text;
			if ((part.type === "output_text" || part.type === "text") && text?.trim()) parts.push(text.trim());
		}
	}
	return parts.join("\n").trim();
}

function collectUrls(payload: Record<string, unknown>): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const add = (url?: string) => {
		const trimmed = url?.trim();
		if (!trimmed || seen.has(trimmed)) return;
		seen.add(trimmed);
		urls.push(trimmed);
	};
	const walk = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}
		const rec = node as Record<string, unknown>;
		if (rec.type === "url_citation" && typeof rec.url === "string") add(rec.url);
		if (Array.isArray(rec.citations)) {
			for (const c of rec.citations) {
				if (typeof c === "string") add(c);
			}
		}
		for (const value of Object.values(rec)) walk(value);
	};
	walk(payload);
	return urls;
}

export default function xSearchExtension(pi: any) {
	const z = pi.zod;
	pi.registerTool({
		name: "x_search",
		label: "x_search",
		description: "Live X/Twitter search via xAI x_search. Use this instead of web_search for posts, handles, and public reaction.",
		promptSnippet: "Live X/Twitter search (xAI). Not web_search; site:x.com via Exa is a login wall.",
		promptGuidelines: [
			"For X/Twitter posts, accounts, or public reaction, call x_search. Do not use web_search with site:x.com.",
			"Pass from_date/to_date as YYYY-MM-DD when recency matters.",
		],
		parameters: z.object({
			query: z.string().describe("X search query"),
			from_date: z.string().optional().describe("YYYY-MM-DD"),
			to_date: z.string().optional().describe("YYYY-MM-DD"),
			allowed_x_handles: z.array(z.string()).optional().describe("Only these handles (max 20)"),
			excluded_x_handles: z.array(z.string()).optional().describe("Exclude these handles (max 20)"),
		}),
		async execute(
			_id: string,
			params: {
				query: string;
				from_date?: string;
				to_date?: string;
				allowed_x_handles?: string[];
				excluded_x_handles?: string[];
			},
			signal: AbortSignal,
		) {
			const tool: Record<string, unknown> = { type: "x_search" };
			if (params.from_date) tool.from_date = params.from_date;
			if (params.to_date) tool.to_date = params.to_date;
			if (params.allowed_x_handles?.length) tool.allowed_x_handles = params.allowed_x_handles.slice(0, 20);
			if (params.excluded_x_handles?.length) tool.excluded_x_handles = params.excluded_x_handles.slice(0, 20);

			const response = await fetch(XAI_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token()}`,
				},
				body: JSON.stringify({
					model: MODEL,
					input: [{ role: "user", content: params.query }],
					tools: [tool],
				}),
				signal,
			});
			const raw = await response.text();
			if (!response.ok) {
				throw new Error(`xAI x_search failed (${response.status}): ${raw.slice(0, 500)}`);
			}
			const payload = JSON.parse(raw) as Record<string, unknown>;
			const text = collectText(payload);
			const urls = collectUrls(payload);
			if (!text && urls.length === 0) {
				throw new Error("xAI x_search returned no text and no citations (not live search).");
			}
			const body = urls.length ? `${text}\n\nCitations:\n${urls.map((u) => `- ${u}`).join("\n")}` : text;
			return {
				content: [{ type: "text", text: body }],
				details: { citationCount: urls.length, model: MODEL },
			};
		},
	});
}
