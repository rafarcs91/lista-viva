"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CONFIRM_WINDOW_MS = 4000;

export default function ListSettingsSheet({
  listId,
  title,
  isOwner,
  onClose,
}: {
  listId: string;
  title: string;
  isOwner: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);
  const armedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => window.clearTimeout(armedTimer.current), []);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean || clean === title) return;

    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase
      .from("lists")
      .update({ title: clean })
      .eq("id", listId);
    setBusy(false);

    if (err) {
      setError("Não consegui renomear a lista.");
      return;
    }
    onClose();
  }

  /**
   * Apagar afeta todo mundo da lista e não tem volta — é o único lugar do
   * app com confirmação. O botão se arma por alguns segundos e desarma
   * sozinho, para não virar um diálogo que se aceita no automático.
   */
  async function remove() {
    if (!armed) {
      setArmed(true);
      armedTimer.current = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
      return;
    }

    window.clearTimeout(armedTimer.current);
    setBusy(true);
    setError("");

    const supabase = createClient();
    const { error: err } = await supabase.from("lists").delete().eq("id", listId);

    if (err) {
      setBusy(false);
      setArmed(false);
      setError("Não consegui apagar a lista.");
      return;
    }

    router.push("/listas");
    router.refresh();
  }

  async function leave() {
    if (!armed) {
      setArmed(true);
      armedTimer.current = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
      return;
    }

    window.clearTimeout(armedTimer.current);
    setBusy(true);
    setError("");

    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const { error: err } = await supabase
      .from("list_members")
      .delete()
      .eq("list_id", listId)
      .eq("user_id", auth.user.id);

    if (err) {
      setBusy(false);
      setArmed(false);
      setError("Não consegui sair da lista.");
      return;
    }

    router.push("/listas");
    router.refresh();
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Ajustes da lista">
        <div className="grabber" />
        <h3>Ajustes da lista</h3>

        {isOwner ? (
          <>
            <p className="lede">
              O nome novo aparece na hora para quem estiver com a lista aberta.
            </p>

            <form onSubmit={rename} style={{ display: "flex", gap: 8, marginBottom: 26 }}>
              <input
                className="field"
                type="text"
                aria-label="Nome da lista"
                maxLength={80}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                className="send"
                type="submit"
                disabled={busy || !draft.trim() || draft.trim() === title}
                aria-label="Salvar nome"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5 10 17.5 19 7.5" />
                </svg>
              </button>
            </form>

            <div className="sec" style={{ paddingTop: 0 }}>
              <span>Zona de risco</span>
              <i className="rule" />
            </div>

            <p className="lede" style={{ marginBottom: 12 }}>
              Apagar remove a lista e todos os itens para <strong>todas</strong> as
              pessoas. Não tem como desfazer.
            </p>

            <button
              className={`btn-danger${armed ? " is-armed" : ""}`}
              type="button"
              onClick={remove}
              disabled={busy}
            >
              {armed ? "Tocar de novo para apagar" : "Apagar lista"}
            </button>
          </>
        ) : (
          <>
            <p className="lede">
              Ao sair, a lista some das suas listas. Os itens que você adicionou
              continuam lá para as outras pessoas.
            </p>

            <button
              className={`btn-danger${armed ? " is-armed" : ""}`}
              type="button"
              onClick={leave}
              disabled={busy}
            >
              {armed ? "Tocar de novo para sair" : "Sair da lista"}
            </button>
          </>
        )}

        {error && (
          <div className="notice is-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
      </div>
    </>
  );
}
