import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// As variáveis NEXT_PUBLIC_* são embutidas no bundle no momento do build
// (precisam ser referenciadas literalmente para o Next substituí-las).
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

function urlValida(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const supabaseConfigurado = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && urlValida(SUPABASE_URL),
);

let cliente: SupabaseClient | null = null;

/** Cliente único do navegador. Retorna null quando as variáveis não foram definidas. */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigurado) return null;
  if (!cliente) {
    cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "djen-monitor-auth",
      },
    });
  }
  return cliente;
}

/** Versão que lança erro — use apenas em telas já protegidas pelo guarda de rota. */
export function supabase(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new Error("Supabase não configurado.");
  return c;
}

/** basePath normalizado (ex.: "/djen-monitor" ou ""). */
export const BASE_PATH = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "";

/** URL absoluta de uma rota do painel, respeitando o basePath. */
export function urlAbsoluta(rota: string) {
  const caminho = rota.startsWith("/") ? rota : `/${rota}`;
  return `${window.location.origin}${BASE_PATH}${caminho}`;
}

type ErroComStatus = { message?: unknown; code?: unknown; status?: unknown };

/**
 * Anexa o status HTTP ao erro de uma resposta do PostgREST e o devolve (para `throw`).
 * Necessário porque consultas `head: true` (contagens) vêm sem corpo — o erro chega com mensagem vazia.
 */
export function erroDaResposta(r: { error: unknown; status?: number }) {
  const e = (r.error ?? {}) as ErroComStatus;
  if (typeof e === "object" && e.status === undefined && r.status) {
    try {
      (e as { status?: number }).status = r.status;
    } catch {
      /* objeto congelado: ignora */
    }
  }
  return e;
}

/** true quando o erro indica JWT inválido/expirado (sessão que precisa ser refeita). */
export function ehErroDeSessao(erro: unknown) {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as ErroComStatus;
  if (e.status === 401) return true;
  if (typeof e.code === "string" && /^PGRST30[123]$/.test(e.code)) return true;
  return typeof e.message === "string" && /\bjwt\b/i.test(e.message);
}

/** Extrai uma mensagem legível de erros do supabase-js / PostgREST / fetch. */
export function mensagemErro(erro: unknown): string {
  if (!erro) return "Erro desconhecido.";
  if (typeof erro === "string") return erro || "Erro desconhecido.";
  if (typeof erro !== "object") return "Erro desconhecido.";
  const e = erro as ErroComStatus;
  if (ehErroDeSessao(e)) return "Sessão inválida ou expirada. Entre novamente.";
  const msg = typeof e.message === "string" ? e.message.trim() : "";
  if (msg) return traduzir(msg);
  if (e.status === 403) return "Sem permissão para acessar estes dados.";
  if (typeof e.status === "number") return `O servidor respondeu com erro (HTTP ${e.status}).`;
  if (typeof e.code === "string" && e.code) return `Erro ${e.code}.`;
  return "Erro desconhecido.";
}

function traduzir(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
  if (m.includes("email not confirmed")) return "E-mail ainda não confirmado.";
  if (m.includes("failed to fetch") || m.includes("networkerror"))
    return "Falha de conexão com o Supabase. Verifique sua internet e a URL do projeto.";
  if (m.includes("jwt expired")) return "Sessão expirada. Entre novamente.";
  if (m.includes("row-level security")) return "Sem permissão para esta operação (RLS).";
  if (m.includes("password should be at least"))
    return "A senha é curta demais para a política do projeto.";
  if (m.includes("new password should be different"))
    return "A nova senha precisa ser diferente da atual.";
  if (m.includes("rate limit")) return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  return msg;
}
