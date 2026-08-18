import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Mesmo cuidado do callback: atrás de proxy o host publico vem no cabecalho.
  const encaminhado = request.headers.get("x-forwarded-host");
  const protocolo = request.headers.get("x-forwarded-proto") ?? "https";
  const origem = encaminhado
    ? `${protocolo}://${encaminhado}`
    : request.nextUrl.origin;

  return NextResponse.redirect(new URL("/entrar", origem), { status: 303 });
}
