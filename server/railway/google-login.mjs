// OIDC com biblioteca oficial do Google; sem acesso a Gmail/Drive.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { readCookie, safeNextPath } from "./auth.mjs";

export const GOOGLE_STATE_COOKIE = "exportatrust_google_state";
const sign = (value, secret) => createHmac("sha256", secret).update(value).digest("base64url");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function googleLoginConfig(source = process.env) {
  const clientId = source.GOOGLE_LOGIN_CLIENT_ID ?? "";
  const clientSecret = source.GOOGLE_LOGIN_CLIENT_SECRET ?? "";
  const redirectUri = source.GOOGLE_LOGIN_REDIRECT_URI ?? "";
  let validRedirect = false;
  try {
    const url = new URL(redirectUri);
    validRedirect = url.protocol === "https:" && url.pathname === "/__auth/google/callback" && !url.search && !url.hash && !url.username && !url.password;
  } catch { /* Disabled until a complete configuration exists. */ }
  return { clientId, clientSecret, redirectUri, ready: Boolean(clientId && clientSecret && validRedirect) };
}

export function clearGoogleCookie(secure) {
  return `${GOOGLE_STATE_COOKIE}=; Path=/__auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function readGoogleState(header, secret) {
  const [payload, signature, extra] = readCookie(header, GOOGLE_STATE_COOKIE).split(".");
  if (!payload || !signature || extra !== undefined || !equal(signature, sign(payload, secret))) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof state.exp !== "number" || state.exp <= Date.now() || typeof state.state !== "string" || typeof state.nonce !== "string" || typeof state.verifier !== "string") return null;
    return state;
  } catch { return null; }
}

export class GoogleLogin {
  constructor(config, secret, client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri)) {
    this.config = config;
    this.secret = secret;
    this.client = client;
  }

  async start(next, secure) {
    if (!this.config.ready) throw new Error("Google login not configured");
    const { codeVerifier, codeChallenge } = await this.client.generateCodeVerifierAsync();
    const data = { state: randomBytes(32).toString("base64url"), nonce: randomBytes(32).toString("base64url"), verifier: codeVerifier, next: safeNextPath(next), exp: Date.now() + 10 * 60_000 };
    const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
    const url = this.client.generateAuthUrl({
      scope: ["openid", "email", "profile"], response_type: "code", access_type: "online",
      state: data.state, nonce: data.nonce, prompt: "select_account",
      code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
    });
    return { url, cookie: `${GOOGLE_STATE_COOKIE}=${payload}.${sign(payload, this.secret)}; Path=/__auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}` };
  }

  async finish(params, cookieHeader) {
    const state = readGoogleState(cookieHeader, this.secret);
    if (!state || !equal(state.state, params.get("state")) || params.has("error") || !params.get("code")) throw new Error("Invalid Google authorization state");
    const { tokens } = await this.client.getToken({ code: params.get("code"), codeVerifier: state.verifier, redirect_uri: this.config.redirectUri });
    if (!tokens.id_token) throw new Error("Missing Google identity");
    // A biblioteca verifica assinatura, audience, issuer e expiração.
    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.clientId });
    const identity = ticket.getPayload();
    if (!identity || !equal(identity.nonce, state.nonce) || identity.email_verified !== true || typeof identity.sub !== "string" || !identity.sub || typeof identity.email !== "string" || !identity.email.includes("@")) throw new Error("Invalid Google identity");
    return { identity: { subject: identity.sub, email: identity.email.trim().toLowerCase() }, next: safeNextPath(state.next) };
  }
}
