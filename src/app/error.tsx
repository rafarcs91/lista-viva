"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="shell">
      <div className="message-screen">
        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Algo quebrou
          </p>
          <h1 className="title">Não consegui carregar esta tela</h1>
        </div>
        <p>
          Pode ter sido a conexão. Tente de novo — se continuar, feche e abra o
          app.
        </p>
        <button className="btn-primary" type="button" onClick={reset}>
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
