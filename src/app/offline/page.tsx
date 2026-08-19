import Link from "next/link";

/**
 * Servida pelo service worker quando uma navegação falha por falta de rede.
 *
 * Precisa ser estática e igual para todo mundo: é a única página que fica
 * guardada no aparelho, então não pode conter nada de ninguém.
 */
export const dynamic = "force-static";

export const metadata = {
  title: "Sem conexão",
};

export default function Offline() {
  return (
    <div className="shell">
      <div className="message-screen">
        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Sem conexão
          </p>
          <h1 className="title">Você está sem internet</h1>
        </div>

        <p>
          Para abrir uma lista pela primeira vez é preciso conexão. Se o app já
          estava aberto, o que você marcou continua guardado e sobe sozinho
          quando o sinal voltar.
        </p>

        <Link href="/listas" className="btn-primary" style={{ textDecoration: "none" }}>
          Tentar de novo
        </Link>
      </div>
    </div>
  );
}
