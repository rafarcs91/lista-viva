"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatarEspera, traduzirErroLogin } from "@/lib/erros-auth";

/**
 * O Supabase impõe um intervalo entre pedidos de link para o mesmo
 * endereço. Antes esse limite só aparecia como erro em inglês depois que a
 * pessoa já tinha tentado. Agora a espera é mostrada como contagem, e o
 * botão fica desabilitado enquanto ela corre — o limite deixa de ser uma
 * surpresa e vira parte da tela.
 */
const ESPERA_PADRAO = 60;

export default function EntrarForm({
  next,
  erroInicial,
}: {
  next: string;
  erroInicial?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(erroInicial ?? null);
  const [espera, setEspera] = useState(0);
  const cronometro = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (espera <= 0) return;
    cronometro.current = window.setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => window.clearTimeout(cronometro.current);
  }, [espera]);

  const enviar = useCallback(
    async (endereco: string) => {
      setEnviando(true);
      setErro(null);

      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: endereco,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?proximo=${encodeURIComponent(next)}`,
        },
      });

      setEnviando(false);

      if (error) {
        const traduzido = traduzirErroLogin(error.message);
        setErro(traduzido.texto);
        if (traduzido.esperar) setEspera(traduzido.esperar);
        return false;
      }

      setEnviado(true);
      setEspera(ESPERA_PADRAO);
      return true;
    },
    [next],
  );

  async function aoEnviar(e: React.FormEvent) {
    e.preventDefault();
    const endereco = email.trim();
    if (!endereco || espera > 0) return;
    await enviar(endereco);
  }

  if (enviado) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="notice">
          Link enviado para <strong>{email.trim()}</strong>. Abra o e-mail neste
          mesmo aparelho para entrar.
        </div>

        {erro && <div className="notice is-error">{erro}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ borderStyle: "solid" }}
            disabled={espera > 0 || enviando}
            onClick={() => enviar(email.trim())}
          >
            {espera > 0
              ? `Reenviar em ${formatarEspera(espera)}`
              : enviando
                ? "Reenviando…"
                : "Reenviar link"}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setEnviado(false);
              setErro(null);
              setEspera(0);
            }}
          >
            usar outro e-mail
          </button>
        </div>

        {espera > 0 && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>
            O e-mail pode levar um minuto para chegar. Confira também o spam
            antes de pedir outro.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={aoEnviar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input
        className="field"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="voce@email.com"
        aria-label="Seu e-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <button
        className="btn-primary"
        type="submit"
        disabled={enviando || !email.trim() || espera > 0}
      >
        {espera > 0
          ? `Aguarde ${formatarEspera(espera)}`
          : enviando
            ? "Enviando…"
            : "Receber link de acesso"}
      </button>

      {erro && (
        <div className="notice is-error" role="alert">
          {erro}
        </div>
      )}
    </form>
  );
}
