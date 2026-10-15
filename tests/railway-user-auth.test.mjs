import assert from "node:assert/strict";
import test from "node:test";
import { createSessionCookie, isSameOrigin, loginPage, registrationPage, passwordPage, readSession, sessionEmail, stripIdentityHeaders } from "../server/railway/auth.mjs";
import { hashPassword, passwordTokenHash, UserCredentials, validPassword, verifyPassword } from "../server/railway/user-credentials.mjs";

const config = { ready: true, allowedEmails: ["admin@example.test"], password: "bootstrap-long-password", secret: "test-only-secret-32-characters-minimum" };
const cookie = (email, version) => createSessionCookie(email, config, true, version).split(";")[0];

test("individual passwords use random salts and reject wrong or malformed hashes", async () => {
  const first = await hashPassword("individual-password");
  const second = await hashPassword("individual-password");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("individual-password", first), true);
  assert.equal(await verifyPassword("wrong", first), false);
  assert.equal(await verifyPassword("individual-password", "scrypt-v1$invalid$hash"), false);
  assert.equal(validPassword("short"), false);
  assert.equal(validPassword("x".repeat(1025)), false);
});

test("signed individual sessions are not mistaken for bootstrap and reject tampering", () => {
  const personal = cookie("member@example.test", "version-1");
  assert.equal(readSession(personal, config).v, "version-1");
  assert.equal(sessionEmail(personal, config), null);
  assert.equal(readSession(`${personal}x`, config), null);
  assert.equal(readSession(`${personal}.extra`, config), null);
  assert.equal(sessionEmail(cookie("admin@example.test"), config), "admin@example.test");
  assert.equal(sessionEmail(cookie("other@example.test"), config), null);
});

test("auth forms escape links and errors; cross-origin requests and forged identity are refused", () => {
  assert.match(loginPage(), /href="\/__auth\/cadastrar"/);
  assert.match(registrationPage(), /name="email"/);
  assert.match(registrationPage(), /name="company"/);
  assert.ok(!registrationPage({ error: '<script>alert(1)</script>' }).includes('<script>'));
  assert.match(registrationPage({ success: true }), /Nenhum e-mail foi enviado/);
  const page = passwordPage({ token: '"><script>alert(1)</script>', error: "<img src=x>" });
  assert.ok(!page.includes("<script>"));
  assert.ok(!page.includes("<img src=x>"));
  assert.equal(isSameOrigin("https://app.example.test", "https://app.example.test"), true);
  for (const bad of [undefined, "null", "https://attacker.test", "http://app.example.test"]) {
    assert.equal(isSameOrigin(bad, "https://app.example.test"), false);
  }
  const headers = { "x-exportatrust-authenticated-user-email": "admin@example.test", "x-exportatrust-http-metadata": "data" };
  stripIdentityHeaders(headers);
  assert.equal(headers["x-exportatrust-authenticated-user-email"], undefined);
  assert.equal(headers["x-exportatrust-http-metadata"], "data");
});

// Optional local PostgreSQL engine; no runtime dependency is added to the app.
// AUTH_TEST_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js
test("PostgreSQL: authorization, reset, replay, expiry, tenant isolation and immediate revocation", {
  skip: !process.env.AUTH_TEST_PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(process.env.AUTH_TEST_PGLITE_MODULE);
  const database = new PGlite();
  let queue = Promise.resolve();
  const pool = {
    async connect() {
      const before = queue;
      let release;
      queue = new Promise((resolve) => { release = resolve; });
      await before;
      return { query: database.query.bind(database), release };
    },
    async query(...args) {
      const client = await this.connect();
      try { return await client.query(...args); } finally { client.release(); }
    },
  };
  try {
    await database.exec(`
      CREATE TABLE organizations (id integer PRIMARY KEY, status text, slug text);
      CREATE TABLE app_users (id serial PRIMARY KEY, email text UNIQUE, status text, full_name text DEFAULT '', identity_provider text DEFAULT 'test');
      CREATE TABLE organization_memberships (id serial PRIMARY KEY, organization_id integer, user_id integer, role text, status text, invited_by text DEFAULT '', UNIQUE(organization_id, user_id));
      INSERT INTO organizations VALUES (1, 'Ativa', 'company-one'), (2, 'Ativa', 'company-two');
      INSERT INTO app_users (id,email,status) VALUES (1, 'admin@example.test', 'Ativo'), (2, 'member@example.test', 'Ativo'), (3, 'other@example.test', 'Ativo');
      INSERT INTO organization_memberships (id,organization_id,user_id,role,status) VALUES (1, 1, 1, 'administrador', 'Ativo'), (2, 1, 2, 'analista', 'Ativo'), (3, 2, 3, 'analista', 'Ativo');
      SELECT setval('app_users_id_seq', 3); SELECT setval('organization_memberships_id_seq', 3);
    `);
    const store = new UserCredentials(pool);
    await store.initialize();
    await store.initialize(); // startup idempotence
    const admin = cookie("admin@example.test");
    await assert.rejects(store.requestAccess({ email: "invalid", name: "Test", company: "company-one" }), { status: 400 });
    await store.requestAccess({ email: " NEW@example.test ", name: "New Person", company: "company-one" });
    await store.requestAccess({ email: "new@example.test", name: "Overwrite", company: "company-one" });
    await store.requestAccess({ email: "other-request@example.test", name: "Other Person", company: "company-two" });
    await store.requestAccess({ email: "member@example.test", name: "Existing", company: "company-one" });
    await store.requestAccess({ email: "unknown@example.test", name: "Unknown", company: "missing-company" });
    await assert.rejects(store.accessRequests("", config), { status: 401 });
    const pendingRequests = await store.accessRequests(admin, config);
    assert.equal(pendingRequests.companyCode, "company-one");
    assert.equal(pendingRequests.requests.length, 1);
    assert.equal(pendingRequests.requests[0].email, "new@example.test");
    assert.equal(pendingRequests.requests[0].fullName, "New Person");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM app_users")).rows[0].count, 3);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM railway_user_credentials")).rows[0].count, 0);
    assert.equal(await store.authenticate("new@example.test", "new-password", config), null);
    assert.equal((await store.authenticate(" ADMIN@example.test ", config.password, config)).email, "admin@example.test");
    assert.equal(await store.authenticate("unknown@example.test", "wrong-password", config), null);
    await assert.rejects(store.issueLink("member@example.test", "", config, "https://test.local"), { status: 401 });
    await assert.rejects(store.issueLink("other@example.test", admin, config, "https://test.local"), { status: 403 });
    const first = await store.issueLink("member@example.test", admin, config, "https://test.local");
    const oldToken = new URL(first.url).searchParams.get("token");
    const second = await store.issueLink("member@example.test", admin, config, "https://test.local");
    const token = new URL(second.url).searchParams.get("token");
    const { rows: [stored] } = await pool.query("SELECT token_hash FROM railway_password_tokens WHERE used_at IS NULL");
    assert.equal(stored.token_hash, passwordTokenHash(token));
    assert.notEqual(stored.token_hash, token);
    await assert.rejects(store.setPassword(oldToken, "first-password"), { status: 400 });
    await assert.rejects(store.setPassword(token, "short"), { status: 400 });
    const consumes = await Promise.allSettled([store.setPassword(token, "member-password"), store.setPassword(token, "member-password")]);
    assert.equal(consumes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(consumes.filter((result) => result.status === "rejected").length, 1);
    const identity = await store.authenticate("member@example.test", "member-password", config);
    assert.ok(identity?.version);
    assert.equal(await store.authenticate("member@example.test", "wrong-password", config), null);
    const session = cookie(identity.email, identity.version);
    await assert.rejects(store.accessRequests(session, config), { status: 403 });
    assert.equal(await store.sessionIdentity(session, config), identity.email);
    await assert.rejects(store.issueLink("admin@example.test", session, config, "https://test.local"), { status: 403 });
    const reset = await store.issueLink(identity.email, admin, config, "https://test.local");
    await store.setPassword(new URL(reset.url).searchParams.get("token"), "replacement-password");
    assert.equal(await store.sessionIdentity(session, config), null);
    assert.equal(await store.authenticate(identity.email, "member-password", config), null);
    const replacement = await store.authenticate(identity.email, "replacement-password", config);
    await pool.query("UPDATE organization_memberships SET status = 'Inativo' WHERE user_id = 2");
    assert.equal(await store.sessionIdentity(cookie(replacement.email, replacement.version), config), null);
    assert.equal(await store.authenticate(identity.email, "replacement-password", config), null);
    await assert.rejects(store.issueLink(identity.email, admin, config, "https://test.local"), { status: 403 });
    await pool.query("UPDATE organization_memberships SET status = 'Ativo' WHERE user_id = 2");
    const expired = await store.issueLink(identity.email, admin, config, "https://test.local");
    await pool.query("UPDATE railway_password_tokens SET expires_at = CURRENT_TIMESTAMP - interval '1 minute' WHERE used_at IS NULL");
    await assert.rejects(store.setPassword(new URL(expired.url).searchParams.get("token"), "another-password"), { status: 400 });
    // Simula a aprovação explícita pela API de equipe; o cadastro público não a faz.
    const { rows: [newUser] } = await pool.query("INSERT INTO app_users (email,status) VALUES ('new@example.test','Ativo') RETURNING id");
    await pool.query("INSERT INTO organization_memberships (organization_id,user_id,role,status) VALUES (1,$1,'analista','Ativo')", [newUser.id]);
    assert.equal((await store.accessRequests(admin, config)).requests.length, 0);
    const onboarding = await store.issueLink("new@example.test", admin, config, "https://test.local");
    await store.setPassword(new URL(onboarding.url).searchParams.get("token"), "new-member-password");
    assert.ok((await store.authenticate("new@example.test", "new-member-password", config))?.version);
    await pool.query("UPDATE app_users SET status = 'Inativo' WHERE id = 1");
    assert.equal(await store.sessionIdentity(admin, config), null);
    assert.equal(await store.authenticate("admin@example.test", config.password, config), null);
    assert.equal(await store.authorizeGoogle({ subject: "unknown", email: "unknown@example.test" }), null);
    const google = await store.authorizeGoogle({ subject: "member-google", email: "member@example.test" });
    assert.equal(google.email, "member@example.test");
    const googleCookie = createSessionCookie(google.email, config, true, undefined, google.subject);
    assert.equal(await store.sessionIdentity(googleCookie, config), google.email);
    assert.equal(await store.authorizeGoogle({ subject: "different-google", email: google.email }), null);
    assert.equal(await store.authorizeGoogle({ subject: google.subject, email: "other@example.test" }), null);
    await pool.query("UPDATE organization_memberships SET status = 'Inativo' WHERE user_id = 2");
    assert.equal(await store.sessionIdentity(googleCookie, config), null);
    assert.equal(await store.authorizeGoogle(google), null);
    const bootstrapEmail = "owner@example.test";
    const owner = await store.authorizeGoogle({ subject: "owner-google", email: bootstrapEmail }, bootstrapEmail);
    const { rows: [ownerMembership] } = await pool.query("SELECT role FROM organization_memberships m JOIN app_users u ON u.id=m.user_id WHERE u.email=$1", [bootstrapEmail]);
    assert.equal(ownerMembership.role, "administrador");
    assert.ok(owner);
    await pool.query("UPDATE organization_memberships SET status='Inativo' WHERE user_id IN (SELECT id FROM app_users WHERE email=$1)", [bootstrapEmail]);
    assert.equal(await store.authorizeGoogle({ subject: "owner-google", email: bootstrapEmail }, bootstrapEmail), null);
  } finally {
    await database.close();
  }
});
