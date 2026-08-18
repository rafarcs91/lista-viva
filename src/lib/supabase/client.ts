"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Cliente do navegador. Um por aba — o Supabase já faz o cache interno. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
