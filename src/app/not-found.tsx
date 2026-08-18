import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell">
      <div className="message-screen">
        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Não encontrado
          </p>
          <h1 className="title">Esta lista não está aqui</h1>
        </div>
        <p>
          Ou ela foi apagada, ou você não faz parte dela. Se alguém te chamou,
          peça o link do convite — é ele que dá acesso.
        </p>
        <Link href="/listas" className="btn-primary" style={{ textDecoration: "none" }}>
          Ver minhas listas
        </Link>
      </div>
    </div>
  );
}
