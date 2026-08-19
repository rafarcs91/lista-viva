"use client";

import { useEffect } from "react";

/**
 * Registra o service worker depois que a página carrega.
 *
 * Fica atrás de `load` de propósito: registrar durante o carregamento
 * disputa banda com os arquivos que a pessoa está esperando ver.
 *
 * Em desenvolvimento o registro é pulado, e um SW porventura instalado é
 * removido — cache de estáticos com hash atrapalha o recarregamento
 * automático do Next e gera bugs que só existem na máquina de quem programa.
 */
export default function RegistrarServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((rs) => Promise.all(rs.map((r) => r.unregister())))
        .catch(() => undefined);
      return;
    }

    const registrar = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Navegador sem suporte, aba anônima ou permissão negada: o app
        // funciona igual, só perde o cache. Não vale incomodar por isso.
      });
    };

    if (document.readyState === "complete") {
      registrar();
      return;
    }

    window.addEventListener("load", registrar);
    return () => window.removeEventListener("load", registrar);
  }, []);

  return null;
}
