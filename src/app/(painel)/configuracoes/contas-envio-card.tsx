"use client";

import { useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  StarIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@/hooks/use-query";
import {
  atualizarFlagsConta,
  contarMonitoresPorConta,
  listarContas,
  NOME_REMETENTE_PADRAO,
  removerConta,
  salvarConta,
  testarConta,
  URL_SENHAS_APP,
  type ContaEnvioComStatus,
  type ResultadoTesteEmail,
} from "@/lib/contas-envio";
import { formatarDataHoraCurta } from "@/lib/format";
import { cn } from "@/lib/utils";

const emailValido = z.email();

/** Card "Contas de envio (Gmail)": várias contas remetentes, uma padrão, teste por conta. */
export function ContasEnvioCard({ recebemTudo }: { recebemTudo: string[] }) {
  const q = useQuery("contas-envio", listarContas);
  const usoMonitores = useQuery("contas-envio:uso", contarMonitoresPorConta);
  const pendente = q.dados?.pendente === true;
  const contas = q.dados?.contas ?? [];

  const [editando, setEditando] = useState<ContaEnvioComStatus | "nova" | null>(null);
  const [versaoForm, setVersaoForm] = useState(0);
  const [removendo, setRemovendo] = useState<ContaEnvioComStatus | null>(null);
  const [processando, setProcessando] = useState<number | null>(null);
  const [testeAberto, setTesteAberto] = useState<number | null>(null);

  const recarregar = () => {
    q.recarregar();
    usoMonitores.recarregar();
  };

  const abrirForm = (c: ContaEnvioComStatus | "nova") => {
    setEditando(c);
    setVersaoForm((v) => v + 1);
  };

  const alterarFlags = async (c: ContaEnvioComStatus, flags: { padrao?: boolean; ativo?: boolean }, ok: string) => {
    setProcessando(c.id);
    try {
      await atualizarFlagsConta(c, flags);
      toast.success(ok);
      recarregar();
    } catch (err) {
      toast.error("Não foi possível atualizar a conta", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProcessando(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailIcon className="size-4" /> Contas de envio (Gmail)
        </CardTitle>
        <CardDescription>
          Contas que enviam os avisos. Cada monitor envia pela conta escolhida nele (ou pela padrão). As senhas
          ficam criptografadas no servidor e nunca são exibidas de volta.
        </CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => abrirForm("nova")} disabled={pendente || q.carregandoInicial}>
            <PlusIcon /> Adicionar conta
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {pendente && (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>Atualização do servidor pendente</AlertTitle>
            <AlertDescription>
              O suporte a várias contas de envio ainda não foi instalado no banco. Assim que a atualização for
              aplicada, as contas aparecem aqui.
            </AlertDescription>
          </Alert>
        )}
        {q.erro && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Não foi possível carregar as contas</AlertTitle>
            <AlertDescription>{q.erro}</AlertDescription>
          </Alert>
        )}

        {q.carregandoInicial ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !pendente && q.dados && contas.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm">
            <p className="font-medium">Nenhuma conta de envio</p>
            <p className="mt-1 text-muted-foreground">
              Sem uma conta Gmail configurada, os avisos por e-mail não são enviados. A primeira conta adicionada
              vira a padrão.
            </p>
            <Button className="mt-3" size="sm" onClick={() => abrirForm("nova")}>
              <PlusIcon /> Adicionar conta
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {contas.map((c) => (
              <li key={c.id} className={cn("rounded-lg border p-3", !c.ativo && "bg-muted/30")}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("truncate font-medium", !c.ativo && "text-muted-foreground")}>
                        {c.email}
                      </span>
                      {c.padrao && <Badge>Padrão</Badge>}
                      {!c.ativo && <Badge variant="outline">Inativa</Badge>}
                      {!c.senha_configurada && (
                        <Badge variant="outline" className="border-warning/50 text-warning-text">
                          Sem senha
                        </Badge>
                      )}
                      <BadgeTeste conta={c} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Remetente: {c.nome_remetente || NOME_REMETENTE_PADRAO}
                      {usoMonitores.dados?.get(c.id)
                        ? ` · usada por ${usoMonitores.dados.get(c.id)} ${usoMonitores.dados.get(c.id) === 1 ? "monitor" : "monitores"}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={c.ativo}
                      disabled={processando === c.id}
                      onCheckedChange={(v) =>
                        alterarFlags(c, { ativo: v }, v ? `Conta ${c.email} ativada.` : `Conta ${c.email} desativada.`)
                      }
                      aria-label={c.ativo ? `Desativar ${c.email}` : `Ativar ${c.email}`}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-sm" aria-label={`Ações para ${c.email}`} />}
                      >
                        {processando === c.id ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem onClick={() => abrirForm(c)}>
                          <PencilIcon /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={c.padrao || !c.ativo || processando !== null}
                          onClick={() => alterarFlags(c, { padrao: true }, `${c.email} agora é a conta padrão.`)}
                        >
                          <StarIcon /> Tornar padrão
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTesteAberto((v) => (v === c.id ? null : c.id))}>
                          <SendIcon /> Enviar teste
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setRemovendo(c)}>
                          <Trash2Icon /> Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {testeAberto === c.id && (
                  <PainelTeste
                    conta={c}
                    recebemTudo={recebemTudo}
                    aoFechar={() => setTesteAberto(null)}
                    aoTestar={recarregar}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {!pendente && contas.length > 0 && !contas.some((c) => c.ativo && c.senha_configurada) && (
          <p className="text-xs text-warning-text">
            Nenhuma conta ativa com Senha de App — os avisos por e-mail não serão enviados.
          </p>
        )}
      </CardContent>

      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
          {editando !== null && (
            <FormConta
              key={versaoForm}
              conta={editando === "nova" ? null : editando}
              aoCancelar={() => setEditando(null)}
              aoSalvar={() => {
                setEditando(null);
                recarregar();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <DialogRemover
        conta={removendo}
        monitoresUsando={removendo ? (usoMonitores.dados?.get(removendo.id) ?? 0) : 0}
        aoFechar={() => setRemovendo(null)}
        aoRemover={() => {
          setRemovendo(null);
          if (removendo && testeAberto === removendo.id) setTesteAberto(null);
          recarregar();
        }}
      />
    </Card>
  );
}

function BadgeTeste({ conta }: { conta: ContaEnvioComStatus }) {
  if (conta.ultimo_teste_ok === true) {
    return (
      <Badge className="bg-success/10 text-success-text">
        ✓ Testada em {formatarDataHoraCurta(conta.ultimo_teste_em)}
      </Badge>
    );
  }
  if (conta.ultimo_teste_ok === false) {
    const erro = conta.ultimo_teste_erro || "erro desconhecido";
    return (
      <Badge variant="destructive" className="max-w-64" title={erro}>
        <span className="truncate">✗ Falhou: {erro}</span>
      </Badge>
    );
  }
  return <Badge variant="outline">Não testada</Badge>;
}

function InstrucoesSenhaApp() {
  return (
    <ol className="list-decimal space-y-1 rounded-lg border bg-muted/30 py-3 pr-3 pl-8 text-xs leading-relaxed text-muted-foreground">
      <li>
        A conta precisa ter a <strong className="text-foreground">verificação em 2 etapas</strong> ativada.
      </li>
      <li>
        Logado na <strong className="text-foreground">mesma conta</strong> do remetente, abra{" "}
        <a
          href={URL_SENHAS_APP}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
        >
          myaccount.google.com/apppasswords <ExternalLinkIcon className="size-3" />
        </a>{" "}
        e gere uma Senha de App (ex.: “DJEN Monitor”).
      </li>
      <li>Cole abaixo só as 16 letras (com ou sem espaços). Não use a senha normal da conta.</li>
    </ol>
  );
}

function FormConta({
  conta,
  aoCancelar,
  aoSalvar,
}: {
  conta: ContaEnvioComStatus | null;
  aoCancelar: () => void;
  aoSalvar: () => void;
}) {
  const [email, setEmail] = useState(conta?.email ?? "");
  // Só em memória: limpa após salvar, nunca persistida.
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState(conta?.nome_remetente ?? NOME_REMETENTE_PADRAO);
  const [erros, setErros] = useState<{ email?: string; senha?: string; nome?: string }>({});
  const [salvando, setSalvando] = useState(false);
  const senhaSalva = !!conta?.senha_configurada;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const novos: typeof erros = {};
    if (!emailValido.safeParse(email.trim()).success) {
      novos.email = "Informe o endereço completo da conta Gmail (ex.: nome@gmail.com).";
    }
    const senhaLimpa = senha.replace(/\s+/g, "");
    if (senhaLimpa && !/^[a-zA-Z]{16}$/.test(senhaLimpa)) {
      novos.senha = "A Senha de App tem 16 letras (ex.: abcd efgh ijkl mnop). Não use a senha normal da conta.";
    } else if (!senhaLimpa && !senhaSalva) {
      novos.senha = "Informe a Senha de App gerada no Google.";
    }
    if (nome.trim().length > 100) novos.nome = "Use no máximo 100 caracteres.";
    setErros(novos);
    if (Object.keys(novos).length) return;

    setSalvando(true);
    try {
      await salvarConta({ id: conta?.id ?? null, email, senhaApp: senhaLimpa, nomeRemetente: nome });
      setSenha("");
      toast.success(conta ? "Conta de envio atualizada." : "Conta de envio adicionada.", {
        description: "Use “Enviar teste” para conferir.",
      });
      aoSalvar();
    } catch (err) {
      setSenha("");
      toast.error("Não foi possível salvar a conta", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={salvar} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{conta ? "Editar conta de envio" : "Adicionar conta de envio"}</DialogTitle>
        <DialogDescription>
          Use uma conta Gmail com Senha de App. A senha fica criptografada no servidor.
        </DialogDescription>
      </DialogHeader>

      <InstrucoesSenhaApp />

      <div className="space-y-1.5">
        <Label htmlFor="ce-email">Conta Gmail (remetente)</Label>
        <Input
          id="ce-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@gmail.com"
          aria-invalid={erros.email ? true : undefined}
          autoFocus
        />
        {erros.email && <p className="text-xs text-destructive">{erros.email}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ce-senha">Senha de App</Label>
        <Input
          id="ce-senha"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          placeholder={senhaSalva ? "•••• •••• •••• ••••" : "abcd efgh ijkl mnop"}
          aria-invalid={erros.senha ? true : undefined}
          maxLength={40}
        />
        {erros.senha ? (
          <p className="text-xs text-destructive">{erros.senha}</p>
        ) : senhaSalva ? (
          <p className="text-xs text-muted-foreground">Senha configurada — deixe em branco para manter.</p>
        ) : conta ? (
          <p className="text-xs text-warning-text">Esta conta ainda não tem senha salva.</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ce-nome">Nome do remetente</Label>
        <Input
          id="ce-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={NOME_REMETENTE_PADRAO}
          aria-invalid={erros.nome ? true : undefined}
          maxLength={100}
        />
        {erros.nome ? (
          <p className="text-xs text-destructive">{erros.nome}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Nome que aparece como remetente nos e-mails.</p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando}>
          {salvando && <Loader2Icon className="animate-spin" />}
          {conta ? "Salvar alterações" : "Adicionar conta"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function PainelTeste({
  conta,
  recebemTudo,
  aoFechar,
  aoTestar,
}: {
  conta: ContaEnvioComStatus;
  recebemTudo: string[];
  aoFechar: () => void;
  aoTestar: () => void;
}) {
  const [destinatario, setDestinatario] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoTesteEmail | null>(null);
  const alvoPadrao = recebemTudo[0] ?? conta.email;
  const idCampo = `teste-${conta.id}`;

  const enviar = async () => {
    const alvo = destinatario.trim();
    if (alvo && !emailValido.safeParse(alvo).success) {
      setErro("E-mail inválido.");
      return;
    }
    setErro(null);
    setTestando(true);
    setResultado(null);
    const r = await testarConta(conta.id, alvo || alvoPadrao);
    setResultado(r);
    setTestando(false);
    aoTestar(); // o resultado também fica gravado na conta (ultimo_teste_*)
  };

  return (
    <div className="mt-3 space-y-1.5 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={idCampo}>Enviar e-mail de teste por {conta.email} para</Label>
        <Button variant="ghost" size="icon-xs" onClick={aoFechar} aria-label="Fechar teste">
          <XIcon />
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={idCampo}
          type="email"
          value={destinatario}
          onChange={(e) => setDestinatario(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void enviar();
            }
          }}
          placeholder={alvoPadrao}
          aria-invalid={erro ? true : undefined}
        />
        <Button type="button" variant="outline" onClick={enviar} disabled={testando || !conta.senha_configurada}>
          {testando ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          Enviar teste
        </Button>
      </div>
      {erro ? (
        <p className="text-xs text-destructive">{erro}</p>
      ) : !conta.senha_configurada ? (
        <p className="text-xs text-warning-text">Salve a Senha de App da conta antes de testar.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Opcional — vazio envia para {alvoPadrao}.</p>
      )}
      {resultado && <ResultadoTeste resultado={resultado} />}
    </div>
  );
}

function ResultadoTeste({ resultado }: { resultado: ResultadoTesteEmail }) {
  if (resultado.ok) {
    return (
      <Alert role="status" className="mt-2 border-success/40 text-success-text">
        <CheckCircle2Icon />
        <AlertTitle>E-mail de teste enviado{resultado.destinatario ? ` para ${resultado.destinatario}` : ""}</AlertTitle>
        <AlertDescription className="text-success-text">
          Confira a caixa de entrada e o Spam.
          {resultado.remetente ? ` Remetente: ${resultado.remetente}.` : ""}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive" className="mt-2">
      <XCircleIcon />
      <AlertTitle>Falha no envio do e-mail de teste</AlertTitle>
      <AlertDescription>
        <p>{resultado.erro}</p>
        {resultado.dica && <p className="mt-1">Dica: {resultado.dica}</p>}
      </AlertDescription>
    </Alert>
  );
}

function DialogRemover({
  conta,
  monitoresUsando,
  aoFechar,
  aoRemover,
}: {
  conta: ContaEnvioComStatus | null;
  monitoresUsando: number;
  aoFechar: () => void;
  aoRemover: () => void;
}) {
  const [removendo, setRemovendo] = useState(false);

  const remover = async () => {
    if (!conta) return;
    setRemovendo(true);
    try {
      await removerConta(conta.id);
      toast.success(`Conta ${conta.email} removida.`);
      aoRemover();
    } catch (err) {
      toast.error("Não foi possível remover", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRemovendo(false);
    }
  };

  return (
    <Dialog open={conta !== null} onOpenChange={(v) => !v && !removendo && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remover conta de envio?</DialogTitle>
          <DialogDescription>
            A conta <strong className="text-foreground">{conta?.email}</strong> e a Senha de App salva serão
            apagadas do servidor.
          </DialogDescription>
        </DialogHeader>
        {(monitoresUsando > 0 || conta?.padrao) && (
          <Alert>
            <AlertTriangleIcon />
            <AlertDescription>
              {monitoresUsando > 0 && (
                <p>
                  {monitoresUsando === 1 ? "1 monitor usa" : `${monitoresUsando} monitores usam`} esta conta —{" "}
                  {monitoresUsando === 1 ? "ele passa" : "eles passam"} a enviar pela conta padrão.
                </p>
              )}
              {conta?.padrao && <p>Esta é a conta padrão: a conta ativa mais antiga passa a ser a padrão.</p>}
            </AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={removendo}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={remover} disabled={removendo}>
            {removendo && <Loader2Icon className="animate-spin" />}
            Remover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
