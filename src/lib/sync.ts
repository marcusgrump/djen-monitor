import { FunctionRegion, FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { ResultadoSync } from "./types";

export type RespostaSync =
  | { tipo: "ok"; resultado: ResultadoSync }
  | { tipo: "em_andamento"; mensagem: string }
  | { tipo: "erro"; mensagem: string };

export async function lerCorpo(resp: unknown): Promise<Record<string, unknown> | null> {
  if (!(resp instanceof Response)) return null;
  try {
    const texto = await resp.clone().text();
    if (!texto) return null;
    try {
      const json = JSON.parse(texto);
      return typeof json === "object" && json ? json : { mensagem: String(json) };
    } catch {
      return { mensagem: texto.slice(0, 300) };
    }
  } catch {
    return null;
  }
}

export function textoDe(corpo: Record<string, unknown> | null, padrao: string) {
  const m = corpo?.erro ?? corpo?.mensagem ?? corpo?.error ?? corpo?.message;
  return typeof m === "string" && m.trim() ? m : padrao;
}

/** Invoca a Edge Function `djen-sync` com o JWT do usuário logado. */
export async function sincronizar(opcoes: {
  monitorId?: number;
  dryRun?: boolean;
} = {}): Promise<RespostaSync> {
  const body: Record<string, unknown> = { origem: "manual" };
  if (opcoes.monitorId != null) body.monitorId = opcoes.monitorId;
  if (opcoes.dryRun) body.dryRun = true;

  try {
    // A API do DJEN pode bloquear IPs estrangeiros: força a execução em São Paulo.
    const { data, error } = await supabase().functions.invoke<ResultadoSync>("djen-sync", {
      body,
      region: FunctionRegion.SaEast1,
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const resp = error.context as Response | undefined;
        const corpo = await lerCorpo(resp);
        if (resp?.status === 404) {
          return {
            tipo: "erro",
            mensagem: "Função djen-sync não encontrada no projeto Supabase (ainda não foi publicada?).",
          };
        }
        if (resp?.status === 401) {
          return { tipo: "erro", mensagem: "Sessão não autorizada pela função. Entre novamente." };
        }
        if (resp?.status === 409) {
          return {
            tipo: "em_andamento",
            mensagem: textoDe(corpo, "Já existe uma sincronização em andamento."),
          };
        }
        return {
          tipo: "erro",
          mensagem: textoDe(corpo, `A função respondeu com erro (HTTP ${resp?.status ?? "?"}).`),
        };
      }
      if (error instanceof FunctionsFetchError) {
        return {
          tipo: "erro",
          mensagem:
            "Não foi possível contatar a função djen-sync (rede, CORS ou função não publicada).",
        };
      }
      return { tipo: "erro", mensagem: error.message || "Falha ao chamar a função de sincronização." };
    }
    return { tipo: "ok", resultado: data ?? {} };
  } catch (e) {
    return {
      tipo: "erro",
      mensagem: e instanceof Error ? e.message : "Falha ao chamar a função de sincronização.",
    };
  }
}
