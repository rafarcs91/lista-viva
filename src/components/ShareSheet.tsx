"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "@/lib/types";
import Avatar from "./Avatar";

export default function ShareSheet({
  listId,
  members,
  meId,
  souDona,
  online,
  onClose,
  onRemover,
}: {
  listId: string;
  members: Member[];
  meId: string;
  souDona: boolean;
  online: Set<string>;
  onClose: () => void;
  onRemover: (userId: string) => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [validade, setValidade] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // Remover alguém afeta outra pessoa, então pede um segundo toque. O
  // gatilho se desarma sozinho para não ficar armado sem querer.
  const [armado, setArmado] = useState<string | null>(null);
  const relogio = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(relogio.current), []);

  /**
   * Gerar um link novo apaga os anteriores. É o que dá sentido a remover
   * alguém: sem revogar, a pessoa removida voltaria pelo link que ainda tem.
   */
  async function gerarNovoLink() {
    setGerando(true);
    setError("");

    const supabase = createClient();
    await supabase.from("list_invites").delete().eq("list_id", listId);

    const { data, error: err } = await supabase
      .from("list_invites")
      .insert({ list_id: listId, created_by: meId })
      .select("token, expires_at")
      .single();

    setGerando(false);

    if (err || !data) {
      setError("Não consegui gerar um link novo.");
      return;
    }

    setLink(`${window.location.origin}/j/${data.token}`);
    setValidade(data.expires_at);
    setCopied(false);
  }

  function pedirRemocao(userId: string) {
    if (armado !== userId) {
      window.clearTimeout(relogio.current);
      setArmado(userId);
      relogio.current = window.setTimeout(() => setArmado(null), 4000);
      return;
    }
    window.clearTimeout(relogio.current);
    setArmado(null);
    onRemover(userId);
  }

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
      // Um convite vencido não serve para nada: melhor criar outro do que
      // entregar à pessoa um link que já não funciona.
      const { data: existente } = await supabase
        .from("list_invites")
        .select("token, expires_at")
        .eq("list_id", listId)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (existente?.token) {
        setLink(`${window.location.origin}/j/${existente.token}`);
        setValidade(existente.expires_at);
        return;
      }

      const { data, error: err } = await supabase
        .from("list_invites")
        .insert({ list_id: listId, created_by: meId })
        .select("token, expires_at")
        .single();

      if (cancelled) return;

      if (err || !data) {
        setError(err?.message ?? "Não consegui gerar o link.");
        return;
      }
      setLink(`${window.location.origin}/j/${data.token}`);
      setValidade(data.expires_at);
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

        <div className="link-rodape">
          <span>
            {validade
              ? `Vale até ${new Date(validade).toLocaleDateString("pt-BR", {
                  day: "numeric",
                  month: "long",
                })}`
              : " "}
          </span>
          <button type="button" onClick={gerarNovoLink} disabled={gerando || !link}>
            {gerando ? "gerando…" : "gerar link novo"}
          </button>
        </div>

        <p style={{ margin: "0 0 18px", fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
          Gerar um link novo faz o anterior parar de funcionar. Quem já entrou
          continua na lista.
        </p>

        {error && (
          <div className="notice is-error" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div className="sec" style={{ paddingTop: 14 }}>
          <span>Quem participa</span>
          <i className="rule" />
        </div>

        {souDona && members.length > 1 && (
          <p style={{ margin: "0 0 4px", fontSize: 12.5, color: "var(--ink-3)" }}>
            Ao remover alguém, os itens que a pessoa adicionou continuam na lista.
          </p>
        )}

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
              {souDona && m.role !== "owner" && m.id !== meId ? (
                <button
                  type="button"
                  className={`remover${armado === m.id ? " is-armado" : ""}`}
                  onClick={() => pedirRemocao(m.id)}
                  aria-label={`Remover ${m.display_name} da lista`}
                >
                  {armado === m.id ? "confirmar" : "remover"}
                </button>
              ) : (
                <span className="role">{m.role === "owner" ? "dona" : "pode editar"}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
