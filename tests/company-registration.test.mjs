import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { normalizeCnpj, validCnpj } from "../server/railway/company-registration.mjs";
import { UserCredentials } from "../server/railway/user-credentials.mjs";
import { createSessionCookie, passwordVisibilityScript } from "../server/railway/auth.mjs";

test("company CNPJ normalizes formatting and validates check digits", () => {
  assert.equal(normalizeCnpj("04.252.011/0001-10"), "04252011000110");
  assert.ok(validCnpj("04.252.011/0001-10"));
  for (const invalid of ["", "00000000000000", "04252011000111", "a04252011000110", "12345678901"]) assert.equal(validCnpj(invalid), false);
});

test("password eye toggles visibility and accessible state without submitting", () => {
  let click;
  const input = { id: "password", type: "password" };
  const attributes = {};
  const button = { dataset: { passwordTarget: "password" }, setAttribute: (name, value) => { attributes[name] = value; } };
  runInNewContext(passwordVisibilityScript, { document: {
    addEventListener: (_name, listener) => { click = listener; },
    getElementById: (id) => id === "password" ? input : null,
  } });
  const event = { target: { closest: () => button } };
  click(event);
  assert.equal(input.type, "text");
  assert.equal(attributes["aria-pressed"], "true");
  assert.equal(attributes["aria-label"], "Ocultar senha");
  click(event);
  assert.equal(input.type, "password");
  assert.equal(attributes["aria-pressed"], "false");
});

test("PostgreSQL: initial company signup creates isolated admin; duplicates cannot seize existing company/account", {
  skip: !process.env.AUTH_TEST_PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(process.env.AUTH_TEST_PGLITE_MODULE);
  const db = new PGlite();
  let queue = Promise.resolve();
  const pool = {
    async connect() {
      const previous = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      return { query: db.query.bind(db), release };
    },
    async query(...args) { const client = await this.connect(); try { return await client.query(...args); } finally { client.release(); } },
  };
  const config = { ready: true, allowedEmails: [], password: "not-a-real-bootstrap", secret: "test-secret-with-at-least-32-characters" };
  try {
    await db.exec(`CREATE TABLE organizations (id serial PRIMARY KEY, slug text UNIQUE, name text, tax_id text DEFAULT '', status text, data_region text);
      CREATE TABLE app_users (id serial PRIMARY KEY, email text UNIQUE, full_name text, status text, identity_provider text);
      CREATE TABLE organization_memberships (id serial PRIMARY KEY, organization_id integer, user_id integer, role text, status text, invited_by text, UNIQUE(organization_id,user_id));
      INSERT INTO organizations (id,slug,name,tax_id,status) VALUES (1,'legacy','Existing company','11.222.333/0001-81','Ativa');
      INSERT INTO app_users (email,status) VALUES ('existing@example.test','Ativo');`);
    const store = new UserCredentials(pool);
    await store.initialize();
    const form = { cnpj: "04.252.011/0001-10", companyName: "Test Company", name: "First Admin", email: "admin-new@example.test", password: "test-password-only" };
    await assert.rejects(store.registerCompany({ ...form, cnpj: "invalid" }), { status: 400 });
    await assert.rejects(store.registerCompany({ ...form, password: "short" }), { status: 400 });
    await assert.rejects(store.registerCompany({ ...form, email: "existing@example.test" }), { status: 409 });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM railway_company_registrations")).rows[0].n, 0);
    const attempts = await Promise.allSettled([store.registerCompany(form), store.registerCompany({ ...form, email: "other-new@example.test" })]);
    assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
    const identity = attempts.find(r => r.status === "fulfilled").value;
    const membership = (await store.memberships(identity.email))[0];
    assert.equal(membership.role, "administrador");
    assert.notEqual(membership.organization_id, 1);
    assert.equal(membership.organization_id, identity.organizationId);
    assert.equal((await store.authenticate(identity.email, form.password, config)).version, identity.version);
    const cookie = createSessionCookie(identity.email, config, true, identity.version);
    assert.equal(await store.sessionIdentity(cookie, config), identity.email);
    await assert.rejects(store.registerCompany({ ...form, cnpj: "04252011000110", email: "intruder@example.test" }), { status: 409 });
    await assert.rejects(store.registerCompany({ ...form, cnpj: "11222333000181" }), { status: 409 });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM organizations")).rows[0].n, 2);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM organization_memberships")).rows[0].n, 1);
    await store.requestAccess({ email: "teammate@example.test", name: "Team Mate", company: form.cnpj });
    const requests = await store.accessRequests(cookie, config);
    assert.equal(requests.companyCode, "04252011000110");
    assert.equal(requests.requests[0].email, "teammate@example.test");
    assert.equal(await store.authenticate("teammate@example.test", form.password, config), null);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM railway_user_credentials")).rows[0].n, 1);
    await pool.query("UPDATE organization_memberships SET status = 'Inativo' WHERE user_id = $1", [membership.user_id]);
    assert.equal(await store.sessionIdentity(cookie, config), null);
  } finally { await db.close(); }
});
