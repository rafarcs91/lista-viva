"use client";

import { useEffect, useRef, useState } from "react";
import type { Item, PersonColor, Profile } from "@/lib/types";

const GLOW: Record<PersonColor, string> = {
  mint: "rgba(14, 169, 122, 0.26)",
  violet: "rgba(122, 107, 208, 0.28)",
  amber: "rgba(201, 138, 46, 0.28)",
  coral: "rgba(217, 100, 78, 0.28)",
  sky: "rgba(58, 134, 184, 0.28)",
};

const SWIPE_THRESHOLD = 96;

export default function ItemRow({
  item,
  actor,
  isMe,
  remoteColor,
  isPending,
  onToggle,
  onDelete,
  onQty,
  onRename,
}: {
  item: Item;
  actor?: Profile;
  isMe: boolean;
  remoteColor?: PersonColor;
  isPending: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onQty: (next: number) => void;
  onRename: (nome: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const qtyRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startX: 0, dx: 0, active: false });
  const [dragging, setDragging] = useState(false);
  const [editingQty, setEditingQty] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [rascunho, setRascunho] = useState(item.name);

  // Fecha o seletor ao tocar em qualquer outro lugar — sem botão de "pronto".
  useEffect(() => {
    if (!editingQty) return;
    const close = (e: PointerEvent) => {
      if (!qtyRef.current?.contains(e.target as Node)) setEditingQty(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [editingQty]);

  function onPointerDown(e: React.PointerEvent) {
    // O check e o seletor de quantidade não podem virar arrasto.
    if ((e.target as HTMLElement).closest(".check, .qty, .item-name")) return;
    drag.current = { startX: e.clientX, dx: 0, active: true };
    setDragging(true);
    cardRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.active || !cardRef.current) return;
    drag.current.dx = Math.min(0, e.clientX - drag.current.startX);
    cardRef.current.style.transform = `translateX(${drag.current.dx}px)`;
  }

  function endDrag() {
    if (!drag.current.active || !cardRef.current) return;
    drag.current.active = false;
    setDragging(false);

    if (drag.current.dx < -SWIPE_THRESHOLD) {
      cardRef.current.style.transform = "translateX(-100%)";
      window.setTimeout(onDelete, 130);
    } else {
      cardRef.current.style.transform = "";
    }
  }

  /**
   * Nome vazio significa desistência, não apagar o item — quem quer remover
   * arrasta o cartão. Nome igual não gera escrita nenhuma.
   */
  function confirmarNome() {
    const limpo = rascunho.trim();
    setEditandoNome(false);

    if (!limpo || limpo === item.name) {
      setRascunho(item.name);
      return;
    }
    onRename(limpo);
  }

  const actorName = isMe ? "você" : (actor?.display_name ?? "alguém");
  const actorColor = actor?.color ?? "mint";

  return (
    <li
      className={[
        "item",
        item.done ? "is-done" : "",
        remoteColor ? "is-remote" : "",
        isPending ? "is-pending" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        remoteColor
          ? ({
              "--remote-color": `var(--${remoteColor})`,
              "--remote-glow": GLOW[remoteColor],
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="item-swipe" aria-hidden="true">
        Excluir
      </div>

      <div
        ref={cardRef}
        className={`item-card${dragging ? " is-dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          className="check"
          type="button"
          aria-pressed={item.done}
          aria-label={`${item.done ? "Desmarcar" : "Marcar"} ${item.name}`}
          onClick={onToggle}
          disabled={isPending}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5 10 17.5 19 7.5" />
          </svg>
        </button>

        <div className="item-body">
          {editandoNome ? (
            <input
              className="item-name item-name-input"
              value={rascunho}
              autoFocus
              maxLength={120}
              aria-label={`Nome do item, atualmente ${item.name}`}
              onChange={(e) => setRascunho(e.target.value)}
              onBlur={confirmarNome}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmarNome();
                }
                if (e.key === "Escape") {
                  setRascunho(item.name);
                  setEditandoNome(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="item-name"
              disabled={item.done}
              aria-label={`${item.name}. Tocar para renomear`}
              onClick={() => {
                setRascunho(item.name);
                setEditandoNome(true);
              }}
            >
              {item.name}
            </button>
          )}
          <span className="item-meta">
            {item.done ? "no carrinho · " : "adicionado por "}
            <span className="who" data-color={actorColor}>
              {actorName}
            </span>
          </span>
        </div>

        {editingQty ? (
          <div className="qty qty-editing" ref={qtyRef}>
            <button
              type="button"
              aria-label={`Diminuir quantidade de ${item.name}`}
              disabled={item.qty <= 1}
              onClick={() => onQty(item.qty - 1)}
            >
              −
            </button>
            <output aria-live="polite">{item.qty}</output>
            <button
              type="button"
              aria-label={`Aumentar quantidade de ${item.name}`}
              disabled={item.qty >= 999}
              onClick={() => onQty(item.qty + 1)}
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`qty qty-chip${item.qty === 1 ? " is-single" : ""}`}
            aria-label={`Quantidade de ${item.name}: ${item.qty}. Tocar para alterar`}
            onClick={() => setEditingQty(true)}
          >
            {item.qty} <span className="qty-unit">un</span>
          </button>
        )}
      </div>
    </li>
  );
}
