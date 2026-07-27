// The client knowledge store (#5). Architecture §4: "That note is the product. The generation
// is the cheap part." This module is where that note lives.
//
// Store logic sits here rather than inside the Functions for three reasons, in order of
// weight. The test runner is `node --test` with zero dependencies, and a Function cannot be
// imported into it while a pure module can. #6 will call the store directly from Claude Code
// rather than over HTTP, because generation runs on a machine with a login and not on Pages.
// And the SQL assertions that make AC3 and AC4 testable — the list query never selects the
// note, the events insert touches no column outside the allowed four — are only expressible
// if the SQL lives somewhere importable.
//
// Every function takes a D1-shaped `db` as its first argument. No HTTP, no Response, no env.
// Every user value is a bound parameter; nothing is ever interpolated into a SQL string.

/**
 * A store failure with the HTTP shape already decided, so the Function layer maps rather than
 * guesses. `code` is the lowercase snake_case vocabulary the saulera Functions established.
 */
export class StoreError extends Error {
  constructor(code, status, message) {
    super(message ?? code);
    this.name = "StoreError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The client list: navigation and empty-state surface, not content.
 *
 * It deliberately returns LENGTH(note) rather than the note. The list is the screen's
 * navigation, and shipping every note in it would grow the payload without limit and put
 * personal data (§5.3: the notes name hiring managers) on a screen that does not need it.
 *
 * `packs` is the per-client event count, which is what makes PRD §7's primary metric visible
 * rather than latent. COALESCE, because a client with no events must read 0 and not null.
 */
export async function listClients(db) {
  const { results } = await db
    .prepare(
      `SELECT c.id,
              c.name,
              c.updated_at,
              LENGTH(c.note) AS note_chars,
              COALESCE(COUNT(e.id), 0) AS packs
         FROM clients c
         LEFT JOIN events e ON e.client_id = c.id
        GROUP BY c.id
        ORDER BY c.name`,
    )
    .all();
  return results ?? [];
}
