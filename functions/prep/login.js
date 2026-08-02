// GET /prep/login -> 302 /prep/. SHOWCASE ONLY, and it exists because the page it replaces does
// not.
//
// The showcase branch removes the candidate sign-in entirely: public/prep/login.html and
// login.js are deleted, and the /prep/ junction hands a visitor with no session to /prep/demo,
// which mints the seeded demo session. Nothing in the deployment links here any more — but
// src/prep/session.js still lists /prep/login as a public path, an old invite email may carry
// it, and a 404 in the middle of a demo is worse than a redirect. So this catches the path and
// sends it back to the junction, which signs the visitor in and moves them on.
//
// Delete with the rest of the showcase changes. The auth Functions beside this one are NOT
// deleted: /prep/auth/session is what the junction asks on every load, and /prep/auth/enter is
// still the magic link. Only the sign-in UI is gone.

export async function onRequest() {
  return new Response(null, {
    status: 302,
    headers: { Location: "/prep/", "Cache-Control": "no-store" },
  });
}
