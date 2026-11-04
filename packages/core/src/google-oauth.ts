import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** A "Desktop app" OAuth client from Google Cloud Console (see README). */
export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// Full IMAP/SMTP access requires this scope; "openid email" gives us the address.
const SCOPES = "https://mail.google.com/ openid email";
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Opens Google sign-in in the user's browser and waits for the redirect on a
 * loopback port (PKCE flow for installed apps). Returns the Gmail address and a
 * refresh token for IMAP/SMTP access.
 */
export async function signInWithGoogle(
  client: GoogleClient,
  openUrl: (url: string) => Promise<void> | void,
): Promise<{ email: string; refreshToken: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Google sign-in timed out")), SIGN_IN_TIMEOUT_MS);
      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const error = url.searchParams.get("error");
        const ok = !error && url.searchParams.get("state") === state && url.searchParams.get("code");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(ok ? "Signed in. You can close this tab and return to Mail." : "Sign-in failed. You can close this tab.");
        clearTimeout(timer);
        if (ok) resolve(url.searchParams.get("code")!);
        else reject(new Error(error ? `Google sign-in failed: ${error}` : "Google sign-in failed (state mismatch)"));
      });

      const authUrl = new URL(AUTH_URL);
      authUrl.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "consent", // always return a refresh token
      }).toString();
      void openUrl(authUrl.toString());
    });

    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    if (!tokens.refresh_token || !tokens.id_token) {
      throw new Error("Google did not return a refresh token");
    }
    // The ID token came straight from Google's token endpoint over TLS, so its
    // claims can be read without verifying the signature.
    const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString()) as {
      email?: string;
    };
    if (!claims.email) throw new Error("Google did not return an email address");
    return { email: claims.email, refreshToken: tokens.refresh_token };
  } finally {
    server.close();
  }
}

/** Exchange a refresh token for a short-lived access token used for XOAUTH2. */
export async function refreshGoogleAccessToken(
  client: GoogleClient,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const tokens = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  return { accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || body.error) {
    const reason = body.error === "invalid_grant" ? "sign-in expired; remove and re-add the account" : body.error_description ?? body.error;
    throw new Error(`Google token request failed: ${reason ?? res.status}`);
  }
  return body;
}
