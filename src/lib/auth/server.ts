import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { ServiceAuthError } from '../services/errors';

/**
 * Server-side Supabase client bound to the current request's auth cookies.
 *
 * The factory itself is synchronous so it works at every call site
 * (`createServerSupabase()` and `await createServerSupabase()` are both
 * valid). Cookie access is deferred into async `getAll`/`setAll` adapters,
 * which `await cookies()` lazily — required on Next.js 15+ where
 * `cookies()` returns a Promise, and still compatible with Next.js 14
 * where awaiting the store is a no-op.
 */
export function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new ServiceAuthError('supabase', new Error('Missing Supabase environment variables'));
  }

  return createServerClient(url, key, {
    cookies: {
      async getAll() {
        const cookieStore = await cookies();
        return cookieStore.getAll();
      },
      async setAll(cookiesToSet) {
        try {
          const cookieStore = await cookies();
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component, where the cookie store is
          // read-only. Safe to ignore when middleware refreshes sessions.
        }
      },
    },
  });
}

/**
 * Convenience helper to enforce authentication on a server route.
 * Returns the user and a session-bound client if authenticated, or throws
 * a ServiceAuthError if not. Use the returned `supabase` client for all
 * database access in the route so RLS policies see the user.
 */
export async function requireAuth() {
  const supabase = createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new ServiceAuthError('supabase', new Error('Unauthorized'));
  }
  return { user, supabase };
}

/**
 * Returns the current user, or null when the request is unauthenticated.
 * Prefer this over requireAuth() in routes that return a 401 response
 * themselves instead of catching a thrown error.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return null;
  }
  return user;
}
