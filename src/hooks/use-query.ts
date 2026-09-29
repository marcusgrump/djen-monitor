"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ehErroDeSessao, getSupabase, mensagemErro } from "@/lib/supabase";

let encerrando = false;
function encerrarSessaoInvalida() {
  const sb = getSupabase();
  if (!sb || encerrando) return;
  encerrando = true;
  toast.error("Sessão inválida ou expirada", { description: "Entre novamente para continuar." });
  sb.auth.signOut({ scope: "local" }).finally(() => {
    encerrando = false;
  });
}

interface Estado<T> {
  chave: string;
  dados?: T;
  erro?: string;
}

/**
 * Busca assíncrona simples no cliente.
 * - `chave`: quando muda, refaz a busca (null = não buscar).
 * - Mantém os dados anteriores enquanto recarrega (evita "piscar").
 */
export function useQuery<T>(chave: string | null, buscar: () => Promise<T>) {
  const [estado, setEstado] = useState<Estado<T> | null>(null);
  const [versao, setVersao] = useState(0);
  const buscarRef = useRef(buscar);

  useEffect(() => {
    buscarRef.current = buscar;
  });

  const chaveCompleta = chave === null ? null : `${chave}#${versao}`;

  useEffect(() => {
    if (chaveCompleta === null) return;
    let ativo = true;
    Promise.resolve()
      .then(() => buscarRef.current())
      .then(
        (dados) => {
          if (ativo) setEstado({ chave: chaveCompleta, dados });
        },
        (erro: unknown) => {
          if (!ativo) return;
          setEstado((ant) => ({ chave: chaveCompleta, dados: ant?.dados, erro: mensagemErro(erro) }));
          // Token inválido/expirado que o supabase-js não conseguiu renovar: encerra a sessão local
          // para o guarda de rota levar ao login.
          if (ehErroDeSessao(erro)) encerrarSessaoInvalida();
        },
      );
    return () => {
      ativo = false;
    };
  }, [chaveCompleta]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const carregando = chaveCompleta !== null && estado?.chave !== chaveCompleta;

  return {
    dados: estado?.dados,
    erro: estado?.chave === chaveCompleta ? estado?.erro : undefined,
    carregando,
    /** true apenas no primeiro carregamento (sem dados ainda) */
    carregandoInicial: carregando && estado?.dados === undefined,
    recarregar,
  };
}

/** Relógio que atualiza a cada `intervaloMs` (para textos "há X min"). */
export function useAgora(intervaloMs = 30_000) {
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setAgora(Date.now());
    const primeiro = setTimeout(tick, 0);
    const id = setInterval(tick, intervaloMs);
    return () => {
      clearTimeout(primeiro);
      clearInterval(id);
    };
  }, [intervaloMs]);
  return agora;
}

/** Executa `fn` periodicamente enquanto `ativo` for true. */
export function useIntervalo(fn: () => void, ms: number, ativo: boolean) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!ativo) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, ativo]);
}

/** Valor com atraso (debounce). */
export function useDebounce<T>(valor: T, ms = 400) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(id);
  }, [valor, ms]);
  return v;
}
