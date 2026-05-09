import { createBrowserClient } from '@supabase/ssr';
import { ServiceAuthError } from '../services/errors';

export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new ServiceAuthError('supabase', new Error('Missing Supabase environment variables'));
  }

  return createBrowserClient(url, key);
}
