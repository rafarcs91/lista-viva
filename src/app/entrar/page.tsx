import EntrarForm from "@/components/EntrarForm";

export default async function EntrarPage({ searchParams }: PageProps<"/entrar">) {
  const { proximo } = await searchParams;
  const next = typeof proximo === "string" ? proximo : "/listas";

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

        <EntrarForm next={next} />
      </div>
    </div>
  );
}
