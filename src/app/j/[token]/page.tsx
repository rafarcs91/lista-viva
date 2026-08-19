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

  // O banco distingue os dois casos, e eles pedem explicações diferentes:
  // um link vencido continua sendo o link certo, só velho.
  const expirado =
    error?.code === "P0003" || /expirado/i.test(error?.message ?? "");

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
          <h1 className="title">
            {expirado ? "Este convite venceu" : "Este link não vale mais"}
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
          {expirado
            ? "Convites valem por sete dias. Peça um link novo para quem te chamou — em Compartilhar, existe um botão para gerar."
            : "O convite pode ter sido apagado junto com a lista, substituído por um link novo, ou o endereço veio incompleto. Peça um link atualizado para quem te chamou."}
        </p>
        <Link href="/listas" className="btn-primary" style={{ textDecoration: "none" }}>
          Ver minhas listas
        </Link>
      </div>
    </div>
  );
}
