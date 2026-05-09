import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ServiceAuthError } from '../services/errors';

export function createServerSupabase() {
  const cookieStore = cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new ServiceAuthError('supabase', new Error('Missing Supabase environment variables'));
  }

  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch (error) {
          // The `set` method was called from a Server Component.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch (error) {
          // The `remove` method was called from a Server Component.
        }
      },
    },
  });
}

/**
 * Convenience helper to enforce authentication on a server route.
 * Returns the user if authenticated, or throws a ServiceAuthError if not.
 */
export async function requireAuth() {
  const supabase = createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new ServiceAuthError('supabase', new Error('Unauthorized'));
  }
  return { user, supabase };
}
