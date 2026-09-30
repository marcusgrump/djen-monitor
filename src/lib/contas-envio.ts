// Contas Gmail de envio (supabase/migrations/20260930190000_contas_envio.sql):
// tabela contas_envio (somente leitura pelo painel) + RPCs salvar_conta_envio / remover_conta_envio /
// contas_envio_status, e teste de envio pela Edge Function djen-sync (acao: testar_email, contaId).
// A Senha de App fica no Vault; nunca é lida de volta nem guardada no navegador.

import { FunctionRegion, FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { lerCorpo, textoDe } from "./sync";
import { mensagemErro, supabase } from "./supabase";

export interface ContaEnvio {
  id: number;
  email: string;
  nome_remetente: string;
  padrao: boolean;
  ativo: boolean;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
  ultimo_teste_erro: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContaEnvioComStatus extends ContaEnvio {
  /** false = sem Senha de App guardada no Vault (a conta não consegue enviar). */
  senha_configurada: boolean;
}

export const NOME_REMETENTE_PADRAO = "DJEN Monitor";
export const URL_SENHAS_APP = "https://myaccount.google.com/apppasswords";

export const MSG_ATUALIZACAO_PENDENTE =
  "Atualização do servidor pendente: as contas de envio ainda não foram instaladas no banco (migration 20260930190000_contas_envio.sql).";

type ErroPostgrest = { code?: unknown; message?: unknown };

/** true quando a tabela, a coluna ou a RPC ainda não existe no banco (migration não aplicada). */
export function ehRecursoAusente(erro: unknown) {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as ErroPostgrest;
  if (typeof e.code === "string" && ["PGRST202", "PGRST204", "PGRST205", "42883", "42P01", "42703"].includes(e.code)) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    /could not find the (function|table|.* column)|(function|relation|column) .* does not exist/i.test(e.message)
  );
}

export class ErroContaEnvio extends Error {
  readonly pendente: boolean;
  constructor(mensagem: string, pendente = false) {
    super(mensagem);
    this.name = "ErroContaEnvio";
    this.pendente = pendente;
  }
}

function converterErro(erro: unknown): ErroContaEnvio {
  if (ehRecursoAusente(erro)) return new ErroContaEnvio(MSG_ATUALIZACAO_PENDENTE, true);
  return new ErroContaEnvio(mensagemErro(erro));
}

export type ResultadoContas =
  | { pendente: false; contas: ContaEnvioComStatus[] }
  | { pendente: true; contas: [] };

/** Lista as contas (padrão primeiro) com o indicador de senha. `pendente` = migration não aplicada. */
export async function listarContas(): Promise<ResultadoContas> {
  const sb = supabase();
  const [rContas, rStatus] = await Promise.all([
    sb.from("contas_envio").select("*").order("padrao", { ascending: false }).order("id"),
    sb.rpc("contas_envio_status"),
  ]);
  if (rContas.error) {
    if (ehRecursoAusente(rContas.error)) return { pendente: true, contas: [] };
    throw converterErro(rContas.error);
  }
  if (rStatus.error && !ehRecursoAusente(rStatus.error)) throw converterErro(rStatus.error);
  const status = new Map<number, boolean>(
    ((rStatus.data ?? []) as { id: number; senha_configurada: boolean }[]).map((s) => [
      Number(s.id),
      s.senha_configurada === true,
    ]),
  );
  const contas = ((rContas.data ?? []) as ContaEnvio[]).map((c) => ({
    ...c,
    id: Number(c.id),
    // Sem a RPC de status não dá para saber: assume configurada para não gerar alarme falso.
    senha_configurada: rStatus.error ? true : (status.get(Number(c.id)) ?? false),
  }));
  return { pendente: false, contas };
}

export async function salvarConta(dados: {
  /** null = nova conta. */
  id: number | null;
  email: string;
  /** Vazio = mantém a senha atual (obrigatória ao criar). */
  senhaApp: string;
  nomeRemetente: string;
  padrao?: boolean | null;
  ativo?: boolean | null;
}): Promise<ContaEnvio> {
  const senha = dados.senhaApp.replace(/\s+/g, "");
  const { data, error } = await supabase().rpc("salvar_conta_envio", {
    p_id: dados.id,
    p_email: dados.email.trim(),
    p_senha_app: senha || null,
    p_nome_remetente: dados.nomeRemetente.trim() || null,
    p_padrao: dados.padrao ?? null,
    p_ativo: dados.ativo ?? null,
  });
  if (error) throw converterErro(error);
  return data as ContaEnvio;
}

/** Atualiza só flags (padrão/ativa) mantendo e-mail, nome e senha. */
export function atualizarFlagsConta(conta: ContaEnvio, flags: { padrao?: boolean; ativo?: boolean }) {
  return salvarConta({
    id: conta.id,
    email: conta.email,
    senhaApp: "",
    nomeRemetente: conta.nome_remetente,
    padrao: flags.padrao ?? null,
    ativo: flags.ativo ?? null,
  });
}

export async function removerConta(id: number): Promise<void> {
  const { error } = await supabase().rpc("remover_conta_envio", { p_id: id });
  if (error) throw converterErro(error);
}

/** Quantos monitores usam cada conta explicitamente (conta_envio_id). */
export async function contarMonitoresPorConta(): Promise<Map<number, number>> {
  const { data, error } = await supabase().from("monitores").select("conta_envio_id");
  if (error) {
    if (ehRecursoAusente(error)) return new Map();
    throw converterErro(error);
  }
  const mapa = new Map<number, number>();
  for (const l of (data ?? []) as { conta_envio_id: number | null }[]) {
    if (l.conta_envio_id != null) mapa.set(Number(l.conta_envio_id), (mapa.get(Number(l.conta_envio_id)) ?? 0) + 1);
  }
  return mapa;
}

/** Lê a lista "Recebem tudo" (com fallback para a chave antiga 'emails_padrao'). */
export async function lerRecebemTudo(): Promise<string[]> {
  const { data, error } = await supabase()
    .from("configuracoes")
    .select("chave, valor")
    .in("chave", ["emails_recebem_tudo", "emails_padrao"]);
  if (error) throw error;
  const linhas = (data ?? []) as { chave: string; valor: unknown }[];
  const valor =
    linhas.find((l) => l.chave === "emails_recebem_tudo")?.valor ?? linhas.find((l) => l.chave === "emails_padrao")?.valor;
  return Array.isArray(valor) ? valor.filter((e): e is string => typeof e === "string") : [];
}

export type ResultadoTesteEmail =
  | { ok: true; destinatario: string | null; remetente: string | null; origem: string | null }
  | { ok: false; erro: string; dica: string | null };

function str(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Pede à Edge Function djen-sync o envio de um e-mail de teste pela conta indicada. */
export async function testarConta(contaId: number, destinatario?: string): Promise<ResultadoTesteEmail> {
  const body: Record<string, unknown> = { acao: "testar_email", contaId };
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
      dica: "A função publicada pode estar desatualizada (sem o teste por conta).",
    };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao chamar a função.", dica: null };
  }
}
