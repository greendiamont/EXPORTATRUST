import assert from "node:assert/strict";
import test from "node:test";
import { GoogleLogin, googleLoginConfig, readGoogleState } from "../server/railway/google-login.mjs";
import { createSessionCookie, loginPage, sessionEmail } from "../server/railway/auth.mjs";

const config = { ready: true, clientId: "test.apps.googleusercontent.com", clientSecret: "test-only-secret", redirectUri: "https://app.test/__auth/google/callback" };
const secret = "test-only-state-signing-key-32-characters";

test("Google login fails closed until credentials and exact HTTPS callback exist", () => {
  assert.equal(googleLoginConfig({}).ready, false);
  const source = { GOOGLE_LOGIN_CLIENT_ID: config.clientId, GOOGLE_LOGIN_CLIENT_SECRET: config.clientSecret, GOOGLE_LOGIN_REDIRECT_URI: config.redirectUri };
  assert.equal(googleLoginConfig(source).ready, true);
  for (const redirect of ["http://app.test/__auth/google/callback", "https://attacker.test/wrong", config.redirectUri + "?next=x", "https://user:password@app.test/__auth/google/callback"]) {
    assert.equal(googleLoginConfig({ ...source, GOOGLE_LOGIN_REDIRECT_URI: redirect }).ready, false);
  }
});

test("Google start uses PKCE, nonce, state and identity-only scopes", async () => {
  const login = new GoogleLogin(config, secret);
  const started = await login.start("//attacker.test", true);
  const url = new URL(started.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.ok(!url.href.includes(config.clientSecret));
  const state = readGoogleState(started.cookie, secret);
  assert.equal(state.next, "/");
  assert.equal(state.state, url.searchParams.get("state"));
  assert.equal(state.nonce, url.searchParams.get("nonce"));
  assert.ok(started.cookie.includes("HttpOnly; SameSite=Lax; Max-Age=600; Secure"));
  assert.equal(readGoogleState(started.cookie, "wrong-key"), null);
});

test("Google callback validates state before exchange and verifies ID token with correct audience", async () => {
  const started = await new GoogleLogin(config, secret).start("/pedidos", true);
  const state = readGoogleState(started.cookie, secret);
  let exchanges = 0;
  const client = {
    async getToken(options) { exchanges++; assert.equal(options.codeVerifier, state.verifier); return { tokens: { id_token: "test-token" } }; },
    async verifyIdToken(options) { assert.deepEqual(options, { idToken: "test-token", audience: config.clientId }); return { getPayload: () => ({ sub: "google-subject", email: " Member@Example.test ", email_verified: true, nonce: state.nonce }) }; },
  };
  const login = new GoogleLogin(config, secret, client);
  const params = new URLSearchParams({ code: "test-code", state: state.state });
  await assert.rejects(login.finish(new URLSearchParams({ code: "code", state: "wrong" }), started.cookie));
  await assert.rejects(login.finish(params, ""));
  assert.equal(exchanges, 0);
  const result = await login.finish(params, started.cookie);
  assert.deepEqual(result, { identity: { subject: "google-subject", email: "member@example.test" }, next: "/pedidos" });
});

test("unverified email, wrong nonce, cancelled consent and invalid signature are denied", async () => {
  const started = await new GoogleLogin(config, secret).start("/", true);
  const state = readGoogleState(started.cookie, secret);
  const params = new URLSearchParams({ code: "test-code", state: state.state });
  for (const payload of [
    { sub: "sub", email: "member@example.test", email_verified: false, nonce: state.nonce },
    { sub: "sub", email: "member@example.test", email_verified: true, nonce: "wrong" },
    { email: "member@example.test", email_verified: true, nonce: state.nonce },
  ]) {
    const client = { getToken: async () => ({ tokens: { id_token: "token" } }), verifyIdToken: async () => ({ getPayload: () => payload }) };
    await assert.rejects(new GoogleLogin(config, secret, client).finish(params, started.cookie));
  }
  const denied = new URLSearchParams({ error: "access_denied", state: state.state });
  await assert.rejects(new GoogleLogin(config, secret).finish(denied, started.cookie));
  const client = { getToken: async () => ({ tokens: { id_token: "forged" } }), verifyIdToken: async () => { throw new Error("Invalid signature"); } };
  await assert.rejects(new GoogleLogin(config, secret, client).finish(params, started.cookie));
});

test("Google button clearly indicates readiness; Google session never falls back to allowlist", () => {
  assert.match(loginPage({ googleReady: true }), /href="\/__auth\/google\/start/);
  assert.match(loginPage({ googleReady: false }), /disabled>Entrar com Google/);
  const auth = { ready: true, secret, allowedEmails: ["owner@example.test"] };
  const cookie = createSessionCookie("owner@example.test", auth, true, undefined, "subject");
  assert.equal(sessionEmail(cookie, auth), null);
});
