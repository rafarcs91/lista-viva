import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Entrada por convite. O middleware já garante que existe sessão aqui —
 * quem chega deslogado passa por /entrar e volta para esta mesma URL.
 */
export default async function EntrarNaLista({ params }: PageProps<"/j/[token]">) {
  const { token } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?proximo=${encodeURIComponent(`/j/${token}`)}`);

  const { data: listId, error } = await supabase.rpc("join_list_with_token", {
    p_token: token,
  });

  if (!error && listId) redirect(`/listas/${listId}`);

  return (
    <div className="shell">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 20,
          padding: "0 24px 60px",
        }}
      >
        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Convite
          </p>
          <h1 className="title">Este link não vale mais</h1>
        </div>
        <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
          O convite pode ter sido apagado junto com a lista, ou o endereço veio
          incompleto. Peça um link novo para quem te chamou.
        </p>
        <Link href="/listas" className="btn-primary" style={{ textDecoration: "none" }}>
          Ver minhas listas
        </Link>
      </div>
    </div>
  );
}
