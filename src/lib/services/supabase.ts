/**
 * Supabase service wrapper (thin shim).
 *
 * Self-contained wrapper around `@supabase/supabase-js` that exposes the full
 * SupabaseClient API while normalizing auth, rate-limit and not-found failures
 * into the shared SyntaxOS error classes. Credentials are read lazily from
 * environment variables; missing credentials only throw at first method call,
 * never at import time, so this file is safe to import in any code path.
 *
 * Required env vars:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 * Optional env var:
 *   - SUPABASE_SERVICE_ROLE_KEY  (server-side only; enables admin client)
 *
 * SCOPE — public/service data ONLY. The clients here carry NO user
 * session (`persistSession: false`, no cookie storage), so RLS policies
 * keyed on auth.uid() reject their writes and return zero rows on reads.
 * This wrapper has NO auth methods. In authenticated API routes, use the
 * session-bound client instead:
 *   import { requireAuth } from "@/lib/auth/server";
 *   const { user, supabase } = await requireAuth();
 *
 * Usage (public data only):
 *   import { supabase } from "@/lib/services/supabase";
 *   const { data, error } = await supabase.client.from("public_stats").select();
 *   if (error) throw error;
 */

import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
  type PostgrestError,
} from "@supabase/supabase-js";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "supabase";

function readEnv(name: string, required = true): string {
  const value = process.env[name];
  if (!value && required) {
    throw new ServiceAuthError(
      PROVIDER,
      new Error(`missing required env var: ${name}`),
    );
  }
  return value ?? "";
}

function normalizeError(err: unknown): never {
  // PostgrestError shape: { message, code, details, hint }
  // StorageApiError / FunctionsHttpError: have .status (number)
  // AuthError: has .status and .name === "AuthApiError"
  const e = err as {
    status?: number;
    code?: string | number;
    name?: string;
    message?: string;
    headers?: Record<string, string | undefined>;
  } | null;

  if (e && typeof e === "object") {
    const status = typeof e.status === "number" ? e.status : undefined;
    const code = e.code !== undefined ? String(e.code) : undefined;
    const name = e.name ?? "";
    const msg = (e.message ?? "").toLowerCase();

    if (
      status === 401 ||
      status === 403 ||
      name === "AuthApiError" ||
      name === "AuthError" ||
      msg.includes("invalid api key") ||
      msg.includes("jwt") ||
      msg.includes("unauthorized")
    ) {
      throw new ServiceAuthError(PROVIDER, err);
    }
    if (status === 429 || code === "429") {
      const retryHeader = e.headers?.["retry-after"];
      const retryAfterSeconds = retryHeader
        ? parseInt(retryHeader, 10) || undefined
        : undefined;
      throw new ServiceRateLimitError(PROVIDER, retryAfterSeconds, err);
    }
    if (status === 404 || code === "PGRST116" || code === "404") {
      throw new ServiceNotFoundError(PROVIDER, undefined, err);
    }
  }

  throw err;
}

export class SupabaseService {
  private _client: SupabaseClient | null = null;
  private _admin: SupabaseClient | null = null;

  /** Anonymous (public) client. Lazily instantiated on first access. */
  get client(): SupabaseClient {
    if (!this._client) {
      const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
      const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      const opts: SupabaseClientOptions<"public"> = {
        auth: { persistSession: false, autoRefreshToken: false },
      };
      this._client = createClient(url, anonKey, opts);
    }
    return this._client;
  }

  /**
   * Service-role admin client. Server-side only — never call from a client
   * component or route that runs in the browser. Throws ServiceAuthError if
   * SUPABASE_SERVICE_ROLE_KEY is missing.
   */
  get admin(): SupabaseClient {
    if (!this._admin) {
      const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
      const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
      this._admin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this._admin;
  }

  /**
   * Run a callback against the public (anon) client — NO user session, so
   * RLS-protected user data is invisible here; public data only — and
   * normalize any thrown error
   * (or returned `{ error }`) into ServiceAuth/RateLimit/NotFound errors.
   * Use this when you'd rather catch normalized errors than check `{data, error}`.
   */
  async run<T>(
    fn: (client: SupabaseClient) => Promise<{ data: T | null; error: unknown }>,
  ): Promise<T> {
    let result: { data: T | null; error: unknown };
    try {
      result = await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
    if (result!.error) {
      normalizeError(result!.error);
    }
    return result!.data as T;
  }

  /** Same as run() but uses the admin (service-role) client. */
  async runAdmin<T>(
    fn: (client: SupabaseClient) => Promise<{ data: T | null; error: unknown }>,
  ): Promise<T> {
    let result: { data: T | null; error: unknown };
    try {
      result = await fn(this.admin);
    } catch (err) {
      normalizeError(err);
    }
    if (result!.error) {
      normalizeError(result!.error);
    }
    return result!.data as T;
  }

  // NOTE: this wrapper deliberately has NO auth methods (getUser,
  // signInWithPassword, signUp, signOut). Its clients are created with
  // `persistSession: false` and no cookie storage, so auth calls here
  // either always return null (getUser) or "succeed" without ever
  // persisting the session to cookies (signIn/signUp) — the user appears
  // logged in for exactly one response. All authentication goes through
  // the cookie-bound helpers in `@/lib/auth/server`:
  //   const { user, supabase } = await requireAuth();
}

export const supabase = new SupabaseService();
export default supabase;
export type { SupabaseClient, PostgrestError };
