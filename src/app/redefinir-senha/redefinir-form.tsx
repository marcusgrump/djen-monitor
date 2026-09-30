"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { CarregandoTelaCheia, Logo, SupabaseNaoConfigurado } from "@/components/comum";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase, mensagemErro } from "@/lib/supabase";
import { validarNovaSenha } from "@/lib/senha";

function erroNaUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(
    window.location.hash.replace(/^#/, "") || window.location.search.replace(/^\?/, ""),
  );
  const desc = params.get("error_description");
  return desc ? desc.replace(/\+/g, " ") : null;
}

export function RedefinirSenhaForm() {
  const { configurado, carregando, sessao } = useAuth();
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroLink, setErroLink] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setErroLink(erroNaUrl()), 0);
    return () => clearTimeout(id);
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    const problema = validarNovaSenha(senha, confirmacao);
    if (problema) return setErro(problema);
    setErro(null);
    setEnviando(true);
    const { error } = await sb.auth.updateUser({ password: senha });
    setEnviando(false);
    if (error) return setErro(mensagemErro(error));
    toast.success("Senha atualizada.");
    router.replace("/");
  };

  if (!configurado) {
    return (
      <div className="flex min-h-svh items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <Logo className="justify-center" />
          <SupabaseNaoConfigurado />
        </div>
      </div>
    );
  }

  if (carregando) return <CarregandoTelaCheia />;

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Logo className="justify-center" />
        {!sessao ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Link inválido ou expirado</AlertTitle>
            <AlertDescription>
              <p>{erroLink ?? "Solicite um novo link de redefinição na tela de login."}</p>
              <Link href="/login/" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })}>
                Ir para o login
              </Link>
            </AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Definir nova senha</CardTitle>
              <CardDescription>{sessao.user.email}</CardDescription>
            </CardHeader>
            <form onSubmit={salvar} noValidate>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nova-senha">Nova senha</Label>
                  <Input
                    id="nova-senha"
                    type="password"
                    autoComplete="new-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmacao">Confirme a nova senha</Label>
                  <Input
                    id="confirmacao"
                    type="password"
                    autoComplete="new-password"
                    value={confirmacao}
                    onChange={(e) => setConfirmacao(e.target.value)}
                  />
                </div>
                {erro && (
                  <p className="text-sm text-destructive" role="alert">
                    {erro}
                  </p>
                )}
                <Button type="submit" className="w-full" size="lg" disabled={enviando}>
                  {enviando && <Loader2Icon className="animate-spin" aria-hidden />}
                  Salvar nova senha
                </Button>
              </CardContent>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
