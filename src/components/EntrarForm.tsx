"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function EntrarForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;

    setState("sending");
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?proximo=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="notice">
          Link enviado para <strong>{email.trim()}</strong>. Abra o e-mail neste
          mesmo aparelho para entrar.
        </div>
        <button
          type="button"
          className="btn-ghost"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            setState("idle");
            setMessage("");
          }}
        >
          Usar outro e-mail
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

      <button className="btn-primary" type="submit" disabled={state === "sending" || !email.trim()}>
        {state === "sending" ? "Enviando…" : "Receber link de acesso"}
      </button>

      {state === "error" && (
        <div className="notice is-error">
          Não consegui enviar o link: {message}
        </div>
      )}
    </form>
  );
}
