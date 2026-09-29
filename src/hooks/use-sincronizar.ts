"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { sincronizar } from "@/lib/sync";
import { formatarNumero } from "@/lib/format";

/** Dispara a sincronização manual e mostra o resultado em toast. */
export function useSincronizar(aoTerminar?: () => void) {
  const [executando, setExecutando] = useState<number | "todos" | null>(null);

  const executar = useCallback(
    async (opcoes: { monitorId?: number; nome?: string } = {}) => {
      if (executando !== null) return;
      setExecutando(opcoes.monitorId ?? "todos");
      const alvo = opcoes.nome ? `“${opcoes.nome}”` : "todos os monitores ativos";
      const id = toast.loading(`Sincronizando ${alvo}…`, {
        description: "Isso pode levar alguns minutos (a API do DJEN limita requisições).",
      });
      try {
        const r = await sincronizar({ monitorId: opcoes.monitorId });
        if (r.tipo === "ok") {
          const res = r.resultado;
          const partes = [
            `${formatarNumero(res.requisicoes ?? 0)} requisições`,
            `${formatarNumero(res.encontradas ?? 0)} encontradas`,
            `${formatarNumero(res.novas ?? 0)} novas`,
            `${formatarNumero(res.emails_enviados ?? 0)} e-mails`,
          ].join(" · ");
          const descricao = res.mensagem ? `${partes}\n${res.mensagem}` : partes;
          if (res.status === "erro") {
            toast.error("Sincronização terminou com erro", { id, description: descricao });
          } else if (res.status === "parcial") {
            toast.warning("Sincronização parcial", { id, description: descricao });
          } else {
            toast.success(
              (res.novas ?? 0) > 0
                ? `Sincronização concluída: ${formatarNumero(res.novas ?? 0)} nova(s)`
                : "Sincronização concluída — nada novo",
              { id, description: descricao },
            );
          }
        } else if (r.tipo === "em_andamento") {
          toast.warning("Sincronização já em andamento", {
            id,
            description: r.mensagem,
          });
        } else {
          toast.error("Não foi possível sincronizar", { id, description: r.mensagem });
        }
      } finally {
        setExecutando(null);
        aoTerminar?.();
      }
    },
    [executando, aoTerminar],
  );

  return { executando, executar };
}
