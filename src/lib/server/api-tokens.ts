/**
 * Server-only helpers for API token creation + validation.
 *
 * Tokens are 16 random bytes (32 hex chars) prefixed with `mind_`. The DB
 * stores only the SHA-256 hash + the first 12 visible chars (for UI display).
 * The raw token is shown to the user exactly once at creation time.
 */

const TOKEN_PREFIX = 'mind_';

export type NewToken = {
	/** The raw token — show to the user ONCE, then forget. */
	raw: string;
	/** First 12 chars (`mind_abc12345`) — safe to store + display. */
	prefix: string;
	/** SHA-256 hex of the raw token — what the DB stores for lookup. */
	hash: string;
};

export async function generateApiToken(): Promise<NewToken> {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const random = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	const raw = `${TOKEN_PREFIX}${random}`;
	return {
		raw,
		prefix: raw.slice(0, 12),
		hash: await sha256Hex(raw)
	};
}

export async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
