import EntrarForm from "@/components/EntrarForm";
import { erroDaUrl } from "@/lib/erros-auth";

export default async function EntrarPage({ searchParams }: PageProps<"/entrar">) {
  const { proximo, erro } = await searchParams;
  const next = typeof proximo === "string" ? proximo : "/listas";
  // O callback do link mágico sinaliza a falha por aqui. Sem ler este
  // parâmetro, quem clica num link vencido volta à tela de login sem
  // nenhuma pista do que aconteceu.
  const aviso = erroDaUrl(typeof erro === "string" ? erro : undefined);

  return (
    <div className="shell">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 24px 60px",
          gap: 28,
        }}
      >
        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Lista Viva
          </p>
          <h1 className="title" style={{ fontSize: 34 }}>
            A lista de compras que todo mundo vê mudar
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 15.5,
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}
          >
            Enviamos um link de acesso para o seu e-mail. Sem senha para criar,
            sem senha para esquecer.
          </p>
        </div>

        <EntrarForm next={next} erroInicial={aviso} />
      </div>
    </div>
  );
}
