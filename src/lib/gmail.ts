// Configuração do Gmail de envio pelo painel (RPCs em supabase/migrations/20260929190000_gmail_config.sql)
// e teste de envio pela Edge Function djen-sync. A senha de app nunca é lida de volta nem guardada no navegador.

import { FunctionRegion, FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { lerCorpo, textoDe } from "./sync";
import { supabase } from "./supabase";

export interface StatusGmail {
  usuario: string | null;
  nome_remetente: string | null;
  senha_configurada: boolean;
  atualizado_em: string | null;
}

export const NOME_REMETENTE_PADRAO = "DJEN Monitor";
export const URL_SENHAS_APP = "https://myaccount.google.com/apppasswords";

export const MSG_ATUALIZACAO_PENDENTE =
  "Atualização do servidor pendente: as funções de configuração do Gmail ainda não foram instaladas no banco (migration 20260929190000_gmail_config.sql).";

type ErroPostgrest = { code?: unknown; message?: unknown; status?: unknown };

/** true quando a RPC ainda não existe no banco (migration não aplicada). */
export function ehFuncaoAusente(erro: unknown) {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as ErroPostgrest;
  if (e.code === "PGRST202" || e.code === "42883") return true;
  return typeof e.message === "string" && /could not find the function|function .* does not exist/i.test(e.message);
}

export class ErroGmail extends Error {
  readonly pendente: boolean;
  constructor(mensagem: string, pendente = false) {
    super(mensagem);
    this.name = "ErroGmail";
    this.pendente = pendente;
  }
}

function converterErro(erro: unknown): ErroGmail {
  if (ehFuncaoAusente(erro)) return new ErroGmail(MSG_ATUALIZACAO_PENDENTE, true);
  const msg =
    erro && typeof erro === "object" && typeof (erro as ErroPostgrest).message === "string"
      ? ((erro as ErroPostgrest).message as string)
      : "Erro desconhecido.";
  return new ErroGmail(msg);
}

function normalizarStatus(d: unknown): StatusGmail {
  const o = (d && typeof d === "object" ? d : {}) as Partial<StatusGmail>;
  return {
    usuario: typeof o.usuario === "string" && o.usuario ? o.usuario : null,
    nome_remetente: typeof o.nome_remetente === "string" && o.nome_remetente ? o.nome_remetente : null,
    senha_configurada: o.senha_configurada === true,
    atualizado_em: typeof o.atualizado_em === "string" ? o.atualizado_em : null,
  };
}

export async function statusGmail(): Promise<StatusGmail> {
  const { data, error } = await supabase().rpc("status_config_gmail");
  if (error) throw converterErro(error);
  return normalizarStatus(data);
}

export async function salvarGmail(dados: {
  usuario: string;
  /** Vazio = mantém a senha atual. */
  senhaApp: string;
  nomeRemetente: string;
}): Promise<StatusGmail> {
  const senha = dados.senhaApp.replace(/\s+/g, "");
  const { data, error } = await supabase().rpc("salvar_config_gmail", {
    p_usuario: dados.usuario.trim(),
    p_senha_app: senha || null,
    p_nome_remetente: dados.nomeRemetente.trim(),
  });
  if (error) throw converterErro(error);
  return normalizarStatus(data);
}

export async function removerGmail(): Promise<void> {
  const { error } = await supabase().rpc("remover_config_gmail");
  if (error) throw converterErro(error);
}

export type ResultadoTesteEmail =
  | { ok: true; destinatario: string | null; remetente: string | null; origem: string | null }
  | { ok: false; erro: string; dica: string | null };

function str(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Pede à Edge Function djen-sync o envio de um e-mail de teste. */
export async function testarEmail(destinatario?: string): Promise<ResultadoTesteEmail> {
  const body: Record<string, unknown> = { acao: "testar_email" };
  if (destinatario?.trim()) body.destinatario = destinatario.trim();
  try {
    const { data, error } = await supabase().functions.invoke<Record<string, unknown>>("djen-sync", {
      body,
      region: FunctionRegion.SaEast1,
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const resp = error.context as Response | undefined;
        const corpo = await lerCorpo(resp);
        if (corpo && corpo.ok === false) {
          return { ok: false, erro: textoDe(corpo, "Falha no envio."), dica: str(corpo.dica) };
        }
        if (resp?.status === 404) {
          return {
            ok: false,
            erro: "Função djen-sync não encontrada no projeto Supabase.",
            dica: "Publique a Edge Function e tente de novo.",
          };
        }
        if (resp?.status === 401) {
          return { ok: false, erro: "Sessão não autorizada pela função.", dica: "Entre novamente no painel." };
        }
        return {
          ok: false,
          erro: textoDe(corpo, `A função respondeu com erro (HTTP ${resp?.status ?? "?"}).`),
          dica: str(corpo?.dica),
        };
      }
      if (error instanceof FunctionsFetchError) {
        return {
          ok: false,
          erro: "Não foi possível contatar a função djen-sync.",
          dica: "Verifique a conexão ou se a função foi publicada.",
        };
      }
      return { ok: false, erro: error.message || "Falha ao chamar a função.", dica: null };
    }
    const d = data ?? {};
    if (d.ok === true) {
      return {
        ok: true,
        destinatario: str(d.destinatario),
        remetente: str(d.remetente),
        origem: str(d.origem_credenciais),
      };
    }
    if (d.ok === false) return { ok: false, erro: textoDe(d, "Falha no envio."), dica: str(d.dica) };
    return {
      ok: false,
      erro: "Resposta inesperada da função djen-sync.",
      dica: "A função publicada pode estar desatualizada (sem a ação testar_email).",
    };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao chamar a função.", dica: null };
  }
}
