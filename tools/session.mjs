/**
 * Signs in against the sandbox build and prints the session cookie, so a scripted request can
 * reach the pages that require a session (/library, /library/billing, /admin).
 *
 * It drives the real login endpoint rather than writing a session row directly, so the token it
 * returns is one the app would have issued. That matters: a hand-made row could pass a check
 * that a real login would fail, and the page would then look broken for the wrong reason.
 *
 *   node tools/session.mjs <email> <password>
 */

const base = process.env.LUMEN_BASE ?? "http://localhost:3100";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("usage: node tools/session.mjs <email> <password>");
  process.exit(1);
}

// The login form posts a Next server action, not a plain form. Reading the action id out of
// the rendered page is the only way to call it without knowing the build's internal encoding.
const page = await (await fetch(`${base}/login`)).text();

const actionId = page.match(/"\$ACTION_ID_[0-9a-f]+"/)?.[0]?.slice(1, -1);
if (!actionId) {
  console.error("could not find a server action id on the login page");
  process.exit(1);
}

const body = new FormData();
body.append("$ACTION_ID_" + actionId.slice("$ACTION_ID_".length), "");
body.append("1_email", email);
body.append("1_password", password);

const res = await fetch(`${base}/login`, { method: "POST", body, redirect: "manual" });

const setCookie = res.headers.getSetCookie?.() ?? [];
const session = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("lumen_session="));

if (!session) {
  console.error(`login did not return a session cookie (status ${res.status})`);
  console.error("check the credentials; the throttle allows 8 attempts per 15 minutes");
  process.exit(1);
}

console.log(session);
console.error(`status ${res.status}, cookie captured`);
