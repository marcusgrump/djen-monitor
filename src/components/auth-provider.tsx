"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabase, supabaseConfigurado } from "@/lib/supabase";

interface AuthContexto {
  configurado: boolean;
  /** true até a sessão inicial ser lida (localStorage / hash da URL). */
  carregando: boolean;
  sessao: Session | null;
  ultimoEvento: AuthChangeEvent | null;
  sair: () => Promise<void>;
}

const Ctx = createContext<AuthContexto | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<{
    carregando: boolean;
    sessao: Session | null;
    ultimoEvento: AuthChangeEvent | null;
  }>({ carregando: supabaseConfigurado, sessao: null, ultimoEvento: null });

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let ativo = true;

    sb.auth.getSession().then(({ data }) => {
      if (ativo) setEstado((e) => ({ ...e, carregando: false, sessao: data.session }));
    });

    const { data } = sb.auth.onAuthStateChange((evento, sessao) => {
      if (!ativo) return;
      setEstado((e) => ({
        carregando: evento === "INITIAL_SESSION" ? false : e.carregando,
        sessao,
        ultimoEvento: evento,
      }));
    });

    return () => {
      ativo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const sair = async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ configurado: supabaseConfigurado, ...estado, sair }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  return c;
}
