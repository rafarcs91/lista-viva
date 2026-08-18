import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Atrás de um proxy (Vercel), `nextUrl.origin` pode trazer o host interno
 * em vez do domínio público — o login terminaria redirecionando para um
 * endereço que o navegador não alcança. O host real vem no cabeçalho
 * `x-forwarded-host`, que só existe quando há proxy na frente.
 */
function origemPublica(request: NextRequest) {
  const encaminhado = request.headers.get("x-forwarded-host");
  if (!encaminhado) return request.nextUrl.origin;

  const protocolo = request.headers.get("x-forwarded-proto") ?? "https";
  return `${protocolo}://${encaminhado}`;
}

/** Destino do link mágico: troca o code pela sessão e segue para o app. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = origemPublica(request);
  const code = searchParams.get("code");
  const proximo = searchParams.get("proximo") ?? "/listas";

  // Só aceitamos caminhos internos — nunca redirecionar para fora do app.
  const destino =
    proximo.startsWith("/") && !proximo.startsWith("//") ? proximo : "/listas";

  if (!code) {
    return NextResponse.redirect(`${origin}/entrar?erro=link_invalido`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/entrar?erro=link_expirado`);
  }

  return NextResponse.redirect(`${origin}${destino}`);
}
