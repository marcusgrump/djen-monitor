// Teste local do motor de sincronização contra a API REAL do DJEN.
// Usa o repositório EM MEMÓRIA (nada vai para o banco) e grava o e-mail em arquivo.
//
// Os filtros são os mesmos do formulário oficial (comunica.pje.jus.br): todos opcionais
// e combináveis (vão juntos, em AND, na mesma consulta). Pelo menos um de --texto,
// --tribunal, --parte, --advogado, --oab ou --processo é obrigatório.
//
//   npm run djen:teste -- --oab 123456 --uf SP
//   npm run djen:teste -- --processo 5033683-97.2024.8.13.0701
//   npm run djen:teste -- --tribunal TJSP --texto "fulano de tal" --dias 1
//   npm run djen:teste -- --tribunal TJRJ --oab 146444 --uf RJ --meio D
//   npm run djen:teste -- --tribunal TJRJ --orgao 12345 --orgao-nome "3ª Vara Cível" --parte "EMPRESA X"
//
// Filtros:
//   --texto "..."      teor da comunicação (mín. 5 caracteres)
//   --tribunal SIGLA   instituição (siglaTribunal)
//   --orgao ID         órgão (orgaoId; exige --tribunal); --orgao-nome "..." só para exibição
//   --meio D|E         D = Diário Eletrônico, E = Edital
//   --processo N       nº do processo (com ou sem máscara)
//   --parte "nome"     nome da parte (mín. 4 caracteres)
//   --advogado "nome"  nome do advogado (mín. 4 caracteres)
//   --oab N            nº da OAB
//   --uf UF            UF da OAB (exige --oab)
//
// Opções:
//   --dias N        dias retroativos da primeira busca (0..30, padrão 3; o período é automático)
//   --hoje AAAA-MM-DD  data de referência (padrão: hoje em São Paulo)
//   --prazo S       orçamento de tempo da busca em segundos (padrão 110)
//   --max-email N   comunicações por e-mail (padrão 20)
//   --max-emails N  e-mails por execução (padrão 8; o excedente fica pendente)
//   --limiar N      pausa 60 s quando x-ratelimit-remaining <= N (padrão 2; use 5 p/ ser mais conservador)
//   --repetir       roda a sincronização 2x para conferir deduplicação (2ª deve ter 0 novas e 0 e-mails)
//   --dry-run       só consulta (não grava no repositório em memória, não gera e-mail)
//   --gmail         envia de verdade via Gmail (requer GMAIL_USER/GMAIL_APP_PASSWORD e --para)
//   --para a@b.com  destinatário(s) (separados por vírgula); padrão teste@example.com
//   --saida DIR     pasta de saída (padrão .saida)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dataBrasil } from '../supabase/functions/_shared/datas.ts';
import { ClienteDjen } from '../supabase/functions/_shared/djen-client.ts';
import type { MensagemEmail, RemetenteEmail, TransporteEmail } from '../supabase/functions/_shared/email.ts';
import { transporteGmailDoAmbiente } from '../supabase/functions/_shared/email-gmail.ts';
import { parametrosDoMonitor, resumoFiltros } from '../supabase/functions/_shared/mapeamento.ts';
import { RepositorioMemoria } from '../supabase/functions/_shared/repositorio.ts';
import { executarSincronizacao } from '../supabase/functions/_shared/sync.ts';
import type { FiltrosMonitor, MeioComunicacao, Monitor } from '../supabase/functions/_shared/tipos.ts';

// ------------------------------------------------------------------ argumentos
function lerArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const chave = a.slice(2);
    const prox = argv[i + 1];
    if (prox !== undefined && !prox.startsWith('--')) {
      out[chave] = prox;
      i++;
    } else out[chave] = true;
  }
  return out;
}

const args = lerArgs(process.argv.slice(2));
const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);

const orgaoBruto = str('orgao');
const filtros: FiltrosMonitor = {
  texto: str('texto') ?? null,
  sigla_tribunal: str('tribunal') ?? null,
  orgao_id: orgaoBruto !== undefined ? Number(orgaoBruto) : null,
  orgao_nome: str('orgao-nome') ?? null,
  meio: (str('meio')?.toUpperCase() as MeioComunicacao | undefined) ?? null,
  numero_processo: str('processo') ?? null,
  nome_parte: str('parte') ?? null,
  nome_advogado: str('advogado') ?? null,
  numero_oab: str('oab') ?? null,
  uf_oab: str('uf') ?? null,
};

let parametros: ReturnType<typeof parametrosDoMonitor>;
try {
  parametros = parametrosDoMonitor(filtros);
} catch (e) {
  console.error(`Filtros inválidos: ${(e as Error).message}`);
  console.error(
    'Uso: --oab N [--uf UF] | --processo N | --advogado "nome" | --parte "nome" | --texto "..." | --tribunal SIGLA' +
      ' [--orgao ID] [--meio D|E] [--dias N] (os filtros se combinam)',
  );
  process.exit(2);
}

const saida = resolve(str('saida') ?? '.saida');
mkdirSync(saida, { recursive: true });

const para = (str('para') ?? 'teste@example.com').split(',').map((s) => s.trim()).filter(Boolean);

const monitor: Monitor = {
  id: 1,
  nome: `Teste: ${resumoFiltros(filtros)}`,
  ...filtros,
  emails: null,
  ativo: true,
  dias_retroativos: Number(str('dias') ?? 3),
  ultima_sincronizacao: null,
  ultimo_erro: null,
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  horarios: null,
  ultimo_envio_agendado: null,
  conta_envio_id: null,
};

// --------------------------------------------------------- transporte em arquivo
class TransporteArquivo implements TransporteEmail {
  readonly nome = 'arquivo';
  enviados: Array<{ arquivo: string; assunto: string; para: string[]; bytesHtml: number }> = [];
  constructor(
    private readonly pasta: string,
    private readonly rotulo: string,
  ) {}
  enviar(msg: MensagemEmail): Promise<{ id: string }> {
    const n = this.enviados.length + 1;
    const base = n === 1 ? `email-preview${this.rotulo}` : `email-preview${this.rotulo}-${n}`;
    const arquivo = join(this.pasta, `${base}.html`);
    writeFileSync(arquivo, msg.html, 'utf8');
    writeFileSync(
      join(this.pasta, `${base}.txt`),
      `Para: ${msg.para.join(', ')}\nAssunto: ${msg.assunto}\n\n${msg.texto}`,
      'utf8',
    );
    const bytesHtml = new TextEncoder().encode(msg.html).length;
    this.enviados.push({ arquivo, assunto: msg.assunto, para: msg.para, bytesHtml });
    return Promise.resolve({ id: arquivo });
  }
}

// ------------------------------------------------------ fetch com log (auditoria)
let reqGlobal = 0;
const fetchComLog: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const t = Date.now();
  reqGlobal++;
  const resp = await fetch(input, init);
  const q = new URL(url).searchParams;
  q.delete('itensPorPagina');
  console.log(
    `  [req ${reqGlobal}] HTTP ${resp.status} em ${Date.now() - t} ms | ratelimit ${resp.headers.get('x-ratelimit-remaining')}/${resp.headers.get('x-ratelimit-limit')} | ${q.toString()}`,
  );
  return resp;
};

// ------------------------------------------------------------------------ main
async function main() {
  const hoje = str('hoje') ?? dataBrasil();
  const prazoMs = Number(str('prazo') ?? 110) * 1000;
  const dryRun = args['dry-run'] === true;
  const repo = new RepositorioMemoria({
    monitores: [monitor],
    configuracoes: { emails_recebem_tudo: para, assunto_prefixo: '[DJEN]' },
  });

  console.log(`Monitor: ${monitor.nome} | dias_retroativos=${monitor.dias_retroativos} | hoje=${hoje}`);
  console.log(`Filtros: ${resumoFiltros(monitor)}`);
  console.log(`Parâmetros API: ${JSON.stringify(parametros)}`);

  const rodadas = args['repetir'] === true ? 2 : 1;
  const resumos = [];
  for (let rodada = 1; rodada <= rodadas; rodada++) {
    console.log(`\n=== Rodada ${rodada} ===`);
    const inicio = Date.now();
    const cliente = new ClienteDjen({
      prazo: inicio + prazoMs,
      limiarRestantes: Number(str('limiar') ?? 2),
      fetch: fetchComLog,
      log: (m) => console.log(`  [djen] ${m}`),
    });
    let transporte: TransporteEmail;
    if (args['gmail'] === true) {
      const g = transporteGmailDoAmbiente((n) => process.env[n]);
      if (!g) throw new Error('--gmail requer GMAIL_USER e GMAIL_APP_PASSWORD no ambiente');
      transporte = g;
    } else {
      transporte = new TransporteArquivo(saida, rodada === 1 ? '' : `-rodada${rodada}`);
    }
    const remetente: RemetenteEmail = {
      contaId: null,
      email: transporte.nome,
      padrao: true,
      origem: 'secrets',
      transporte,
    };
    const resumo = await executarSincronizacao({
      repo,
      cliente,
      remetentes: [remetente],
      origem: 'manual',
      dryRun,
      regiao: 'local-node',
      prazoEnvio: inicio + prazoMs + 30_000,
      maxPorEmail: Number(str('max-email') ?? 20),
      maxEmailsPorExecucao: Number(str('max-emails') ?? 8),
      agora: str('hoje') ? () => new Date(`${hoje}T15:00:00-03:00`) : undefined,
      log: (m) => console.log(`  [sync] ${m}`),
    });
    resumos.push(resumo);
    console.log(`  status=${resumo.status} requisicoes=${resumo.requisicoes} encontradas=${resumo.encontradas} novas=${resumo.novas} emails=${resumo.emails_enviados}`);
    console.log(`  mensagem: ${resumo.mensagem}`);
    console.log(`  detalhes monitor: ${JSON.stringify(resumo.detalhes['1'])}`);
    if (transporte instanceof TransporteArquivo) {
      for (const e of transporte.enviados) {
        console.log(`  e-mail -> ${e.arquivo} (${(e.bytesHtml / 1024).toFixed(1)} KB) | Assunto: ${e.assunto}`);
      }
    }
  }

  const pendentes = repo.comunicacoes.filter((c) => c.notificada_em === null).length;
  console.log(
    `\nRepositório em memória: ${repo.comunicacoes.length} comunicações, ${repo.vinculos.length} vínculos, ${pendentes} pendentes de notificação.`,
  );
  console.log(`Monitor após sync: ultima_sincronizacao=${repo.monitores[0].ultima_sincronizacao} ultimo_erro=${repo.monitores[0].ultimo_erro}`);
  console.log(`Requisições HTTP totais ao DJEN: ${reqGlobal}`);

  writeFileSync(
    join(saida, 'resumo.json'),
    JSON.stringify(
      {
        monitor,
        resumos,
        execucoes: repo.execucoes,
        amostra: repo.comunicacoes.slice(0, 3).map((c) => ({ ...c, texto: (c.texto ?? '').slice(0, 300) })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`Resumo salvo em ${join(saida, 'resumo.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
