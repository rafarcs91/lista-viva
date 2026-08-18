"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "@/lib/types";
import Avatar from "./Avatar";

export default function ShareSheet({
  listId,
  members,
  meId,
  online,
  onClose,
}: {
  listId: string;
  members: Member[];
  meId: string;
  online: Set<string>;
  onClose: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = createClient();

      // Reaproveita um convite existente — um link por lista basta,
      // e trocar o link a cada abertura invalidaria o que já foi enviado.
      const { data: existing } = await supabase
        .from("list_invites")
        .select("token")
        .eq("list_id", listId)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (existing?.token) {
        setLink(`${window.location.origin}/j/${existing.token}`);
        return;
      }

      const { data, error: err } = await supabase
        .from("list_invites")
        .insert({ list_id: listId, created_by: meId })
        .select("token")
        .single();

      if (cancelled) return;

      if (err || !data) {
        setError(err?.message ?? "Não consegui gerar o link.");
        return;
      }
      setLink(`${window.location.origin}/j/${data.token}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [listId, meId]);

  async function share() {
    if (!link) return;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Lista Viva", url: link });
        return;
      } catch {
        // Pessoa cancelou o compartilhamento nativo — cai para copiar.
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copie o link manualmente.");
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Compartilhar lista">
        <div className="grabber" />
        <h3>Compartilhar lista</h3>
        <p className="lede">
          Quem abrir este link entra na lista e passa a ver tudo em tempo real.
          Pedimos só o e-mail para enviar o acesso — sem senha.
        </p>

        <div className="link-row">
          <code>{link ?? "gerando link…"}</code>
          <button type="button" onClick={share} disabled={!link}>
            {copied ? "Copiado" : "Enviar"}
          </button>
        </div>

        {error && (
          <div className="notice is-error" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div className="sec" style={{ paddingTop: 14 }}>
          <span>Quem participa</span>
          <i className="rule" />
        </div>

        <div>
          {members.map((m) => (
            <div className="member" key={m.id}>
              <Avatar
                name={m.display_name}
                color={m.color}
                live={online.has(m.id) && m.id !== meId}
              />
              <div className="member-body">
                <strong>{m.id === meId ? "Você" : m.display_name}</strong>
                <span>
                  {online.has(m.id) && m.id !== meId
                    ? "com a lista aberta agora"
                    : m.role === "owner"
                      ? "criou a lista"
                      : "entrou pelo link"}
                </span>
              </div>
              <span className="role">{m.role === "owner" ? "dona" : "pode editar"}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
