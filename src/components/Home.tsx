"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ListSummary, Profile } from "@/lib/types";
import Avatar from "./Avatar";

export default function Home({ lists, me }: { lists: ListSummary[]; me: Profile }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;

    setCreating(true);
    setError("");

    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("lists")
      .insert({ title: clean, owner_id: me.id })
      .select("id")
      .single();

    setCreating(false);

    if (err || !data) {
      setError(err?.message ?? "Não consegui criar a lista.");
      return;
    }

    setTitle("");
    router.push(`/listas/${data.id}`);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-row">
          <div>
            <p className="eyebrow" style={{ marginBottom: 5 }}>
              Lista Viva
            </p>
            <h1 className="title">Suas listas</h1>
          </div>
          <form action="/auth/sair" method="post">
            <button className="btn-ghost" type="submit" style={{ borderStyle: "solid" }}>
              sair
            </button>
          </form>
        </div>
        <div className="live-line">
          <span className="dot" />
          <span>
            Você é <b>{me.display_name}</b> aqui
          </span>
        </div>
      </header>

      <div className="scroll">
        {lists.length === 0 ? (
          <div className="empty" style={{ marginTop: 8 }}>
            Nenhuma lista ainda. Crie a primeira abaixo e compartilhe o link com
            quem faz compras com você.
          </div>
        ) : (
          <div className="cards">
            {lists.map((list) => {
              const pct = list.total ? (list.done / list.total) * 100 : 0;
              return (
                <Link key={list.id} href={`/listas/${list.id}`} className="list-card">
                  <div className="card-top">
                    <h2>{list.title}</h2>
                    <span className="count">
                      {list.done}/{list.total}
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="card-foot">
                    <div className="avatars">
                      {list.members.map((m) => (
                        <Avatar key={m.id} name={m.display_name} color={m.color} />
                      ))}
                    </div>
                    <span className="note">
                      {list.members.length === 1
                        ? "só sua"
                        : `${list.members.length} pessoas`}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {error && (
          <div className="notice is-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
      </div>

      <form className="compose" onSubmit={createList}>
        <div className="compose-field">
          <input
            type="text"
            placeholder="Nova lista…"
            aria-label="Nome da nova lista"
            autoComplete="off"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <button
          className="send"
          type="submit"
          disabled={!title.trim() || creating || isPending}
          aria-label="Criar lista"
          onClick={() => startTransition(() => {})}
        >
          <svg viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </form>
    </div>
  );
}
