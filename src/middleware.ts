import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // getUser() validates the JWT against Supabase; never trust getSession()
  // alone in middleware.
  const { data: { user } } = await supabase.auth.getUser();

  // Protect all dashboard and settings routes by default
  const isProtected = request.nextUrl.pathname.startsWith("/dashboard") ||
                      request.nextUrl.pathname.startsWith("/settings");

  if (isProtected && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Auth routes (redirect to dashboard if already logged in)
  const isAuthPath = request.nextUrl.pathname.startsWith("/login") ||
                     request.nextUrl.pathname.startsWith("/signup");

  if (isAuthPath && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
