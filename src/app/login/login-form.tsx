"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, Loader2Icon, MailCheckIcon } from "lucide-react";
import { z } from "zod";
import { useAuth } from "@/components/auth-provider";
import { AvisoIndependente, Logo, SupabaseNaoConfigurado } from "@/components/comum";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase, mensagemErro, urlAbsoluta } from "@/lib/supabase";

const emailSchema = z.email("Informe um e-mail válido.");

export function LoginForm() {
  const { configurado, carregando, sessao } = useAuth();
  const router = useRouter();
  const [modo, setModo] = useState<"entrar" | "recuperar">("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [linkEnviado, setLinkEnviado] = useState(false);

  useEffect(() => {
    if (sessao) router.replace("/");
  }, [sessao, router]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setErro(null);
    const valido = emailSchema.safeParse(email.trim());
    if (!valido.success) return setErro(valido.error.issues[0]?.message ?? "E-mail inválido.");
    if (!senha) return setErro("Informe a senha.");
    setEnviando(true);
    const { error } = await sb.auth.signInWithPassword({ email: valido.data, password: senha });
    setEnviando(false);
    if (error) return setErro(mensagemErro(error));
    router.replace("/");
  };

  const recuperar = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setErro(null);
    const valido = emailSchema.safeParse(email.trim());
    if (!valido.success) return setErro(valido.error.issues[0]?.message ?? "E-mail inválido.");
    setEnviando(true);
    const { error } = await sb.auth.resetPasswordForEmail(valido.data, {
      redirectTo: urlAbsoluta("/redefinir-senha/"),
    });
    setEnviando(false);
    if (error) return setErro(mensagemErro(error));
    setLinkEnviado(true);
  };

  const trocarModo = (m: "entrar" | "recuperar") => {
    setModo(m);
    setErro(null);
    setLinkEnviado(false);
  };

  const desabilitado = !configurado || enviando || carregando;

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        {!configurado && <SupabaseNaoConfigurado />}

        <Card className="gap-4 overflow-hidden py-0 pb-4">
          <div className="bg-brand px-6 py-5">
            <Logo escuro />
          </div>
          <CardHeader>
            <CardTitle>{modo === "entrar" ? "Entrar no painel" : "Recuperar senha"}</CardTitle>
            <CardDescription>
              {modo === "entrar"
                ? "Use o e-mail e a senha cadastrados pelo administrador."
                : "Enviaremos um link para você definir uma nova senha."}
            </CardDescription>
          </CardHeader>

          {modo === "recuperar" && linkEnviado ? (
            <CardContent>
              <Alert>
                <MailCheckIcon />
                <AlertTitle>Verifique sua caixa de entrada</AlertTitle>
                <AlertDescription>
                  Se houver uma conta para <strong>{email.trim()}</strong>, você receberá um e-mail
                  com o link para redefinir a senha.
                </AlertDescription>
              </Alert>
            </CardContent>
          ) : (
            <form onSubmit={modo === "entrar" ? entrar : recuperar} noValidate>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="voce@exemplo.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={desabilitado}
                    aria-invalid={erro ? true : undefined}
                  />
                </div>
                {modo === "entrar" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="senha">Senha</Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                        onClick={() => trocarModo("recuperar")}
                        disabled={!configurado}
                      >
                        Esqueci a senha
                      </button>
                    </div>
                    <Input
                      id="senha"
                      type="password"
                      autoComplete="current-password"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      disabled={desabilitado}
                      aria-invalid={erro ? true : undefined}
                    />
                  </div>
                )}
                {erro && (
                  <p className="text-sm text-destructive" role="alert">
                    {erro}
                  </p>
                )}
                <Button type="submit" className="w-full" size="lg" disabled={desabilitado}>
                  {enviando && <Loader2Icon className="animate-spin" aria-hidden />}
                  {modo === "entrar" ? "Entrar" : "Enviar link de redefinição"}
                </Button>
              </CardContent>
            </form>
          )}

          {modo === "recuperar" && (
            <CardFooter>
              <Button variant="ghost" size="sm" onClick={() => trocarModo("entrar")}>
                <ArrowLeftIcon /> Voltar para o login
              </Button>
            </CardFooter>
          )}
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Acesso restrito. Não há cadastro público — contas são criadas pelo administrador no
          Supabase.
        </p>
        <AvisoIndependente className="text-center" />
      </div>
    </div>
  );
}
