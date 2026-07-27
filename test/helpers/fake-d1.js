// A D1-shaped object that records calls instead of executing them (#5).
//
// It does NOT run SQL, and the tests must not pretend otherwise — real SQL is exercised by
// `wrangler d1 execute --local` and by the curl sweeps against `wrangler pages dev`. What this
// makes directly assertable is the thing a real database would only imply: no user value ever
// reaches the SQL string, the list query never selects `note`, and the events insert touches no
// column outside the allowed four.
//
// Hand-rolled rather than `node:sqlite`, which does not exist on Node v20.20.2 — this machine's
// default — and the suite has to pass there as well as on v24.
//
// `test/*.test.js` does not glob into `test/helpers/`, so this is never collected as a test.

/**
 * @param {Array<object|Array<object>|null>} queued  one result per `prepare()`, in order.
 *   An array queues rows for `.all()`; an object or null answers `.first()`.
 */
export function fakeD1(queued = []) {
  const calls = [];
  let next = 0;

  return {
    calls,
    prepare(sql) {
      const call = { sql, args: [] };
      calls.push(call);
      const result = queued[next++];

      const statement = {
        // bind() returns the statement so calls chain, exactly as D1 does. Model it or every
        // store call throws on `.first of undefined`.
        bind(...args) {
          call.args = args;
          return statement;
        },
        async first(column) {
          const row = Array.isArray(result) ? (result[0] ?? null) : (result ?? null);
          if (column === undefined || row === null) return row;
          return row[column];
        },
        async all() {
          return { results: Array.isArray(result) ? result : [], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}
