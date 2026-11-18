import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { MODOS_DO_PEDIDO, TIPOS_DE_ETAPA } from "../../rotinas/EtapaDaRotina";
import {
  DadosDaExecucao,
  ExecucaoDaRotina,
  ORIGENS_DA_EXECUCAO,
  SITUACOES_DA_ETAPA_EXECUTADA,
  SITUACOES_DA_EXECUCAO,
} from "../../rotinas/ExecucaoDaRotina";
import { RepositorioDeExecucoes } from "../../rotinas/RepositorioDeExecucoes";
import { RepositorioDeRotinas } from "../../rotinas/RepositorioDeRotinas";
import { AO_PERDER, DadosDaRotina, Rotina } from "../../rotinas/Rotina";
import { gravarAtomicamente } from "./RepositorioDeNotasEmArquivo";

export const PASTA_DAS_ROTINAS = "rotinas";
const PASTA_DAS_EXECUCOES = "execucoes";
const EXTENSAO = ".json";

/** Quantas execuções cada Rotina guarda (as mais recentes); as que rodam ou esperam aprovação nunca saem. */
export const LIMITE_DE_EXECUCOES_GUARDADAS = 50;

/** Só identidades geradas por nós: nada de "..\" escapando da pasta das rotinas. */
const IDENTIDADE_VALIDA = /^[A-Za-z0-9_-]{1,100}$/;

const instante = z.iso.datetime({ offset: true });

/** Aqui só se confere a forma do arquivo; as regras (horas, limites, textos) são do domínio, ao reconstituir. */
const esquemaDoGatilho = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("diario"), hora: z.string() }),
  z.object({ tipo: z.literal("semanal"), dias: z.array(z.number()), hora: z.string() }),
  z.object({ tipo: z.literal("intervalo"), minutos: z.number() }),
  z.object({ tipo: z.literal("uma_vez"), em: z.string() }),
]);

const esquemaDaEtapa = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("pedido"),
    orquestradorId: z.string(),
    texto: z.string(),
    modo: z.enum(MODOS_DO_PEDIDO),
  }),
  z.object({ tipo: z.literal("aprovacao"), mensagem: z.string() }),
  z.object({ tipo: z.literal("espera"), minutos: z.number() }),
]);

const esquemaDaRotina = z.object({
  id: z.string().regex(IDENTIDADE_VALIDA),
  nome: z.string(),
  ativa: z.boolean(),
  gatilho: esquemaDoGatilho,
  etapas: z.array(esquemaDaEtapa),
  aoPerder: z.enum(AO_PERDER),
  criadaEm: instante,
  ultimaExecucaoEm: instante.nullable(),
  proximaExecucaoEm: instante.nullable(),
});

const esquemaDoResultadoDaEtapa = z.object({
  tipo: z.enum(TIPOS_DE_ETAPA),
  situacao: z.enum(SITUACOES_DA_ETAPA_EXECUTADA),
  iniciadaEm: instante,
  encerradaEm: instante.nullable(),
  resposta: z.string().nullable(),
  plano: z.string().nullable(),
  erro: z.string().nullable(),
});

const esquemaDaExecucao = z.object({
  id: z.string().regex(IDENTIDADE_VALIDA),
  rotinaId: z.string().regex(IDENTIDADE_VALIDA),
  rotinaNome: z.string(),
  origem: z.enum(ORIGENS_DA_EXECUCAO),
  situacao: z.enum(SITUACOES_DA_EXECUCAO),
  etapaAtual: z.number().int().nonnegative().nullable(),
  etapas: z.array(esquemaDaEtapa),
  resultados: z.array(esquemaDoResultadoDaEtapa),
  iniciadaEm: instante,
  encerradaEm: instante.nullable(),
  motivo: z.string().nullable(),
  pendencia: z
    .discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("aprovacao"), mensagem: z.string() }),
      z.object({ tipo: z.literal("plano"), plano: z.string() }),
    ])
    .nullable(),
});

function ativa(dados: DadosDaExecucao): boolean {
  return dados.situacao === "em_andamento" || dados.situacao === "aguardando_aprovacao";
}

function compararPorCriacao(a: DadosDaRotina, b: DadosDaRotina): number {
  return Date.parse(a.criadaEm) - Date.parse(b.criadaEm) || a.id.localeCompare(b.id);
}

function detalheDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Repositório em arquivos, um por Rotina e um por execução:
 *
 * dados/rotinas/<id>.json                          a Rotina
 * dados/rotinas/<id>/execucoes/<execucaoId>.json   cada execução dela (as 50 mais recentes)
 *
 * Tudo é carregado na abertura e mantido em memória (como cópias dos dados,
 * nunca a instância de quem salvou): a memória muda na hora, e é por isso que
 * duas gravações pedidas em seguida já se enxergam. O disco recebe as
 * gravações numa fila por Rotina, na ordem pedida; Rotinas diferentes gravam
 * em paralelo. Implementa as duas portas: a das Rotinas e a das execuções.
 */
export class RepositorioDeRotinasEmArquivo implements RepositorioDeRotinas, RepositorioDeExecucoes {
  private readonly rotinas = new Map<string, DadosDaRotina>();
  /** Por Rotina, na ordem em que as execuções foram vistas pela primeira vez. */
  private readonly execucoes = new Map<string, Map<string, DadosDaExecucao>>();
  private readonly filasDeGravacao = new Map<string, Promise<void>>();

  private constructor(private readonly pasta: string) {}

  static async abrir(pastaDeDados: string): Promise<RepositorioDeRotinasEmArquivo> {
    const repositorio = new RepositorioDeRotinasEmArquivo(path.join(pastaDeDados, PASTA_DAS_ROTINAS));
    await mkdir(repositorio.pasta, { recursive: true });

    const entradas = await readdir(repositorio.pasta, { withFileTypes: true });
    for (const entrada of entradas) {
      if (entrada.isFile() && entrada.name.endsWith(EXTENSAO)) {
        await repositorio.carregarRotina(entrada.name);
      }
    }
    for (const id of repositorio.rotinas.keys()) {
      await repositorio.carregarExecucoes(id);
    }
    return repositorio;
  }

  todas(): readonly Rotina[] {
    return [...this.rotinas.values()].sort(compararPorCriacao).map((dados) => Rotina.reconstituir(dados));
  }

  buscar(id: string): Rotina | null {
    const dados = this.rotinas.get(id);
    return dados === undefined ? null : Rotina.reconstituir(dados);
  }

  salvar(rotina: Rotina): Promise<void> {
    const dados = rotina.paraDados();
    const caminho = this.caminhoDaRotina(dados.id);
    this.rotinas.set(dados.id, dados);
    const conteudo = JSON.stringify(dados, null, 2);
    return this.enfileirar(dados.id, async () => {
      await mkdir(this.pasta, { recursive: true });
      await gravarAtomicamente(caminho, conteudo);
    });
  }

  remover(id: string): Promise<void> {
    const caminho = this.caminhoDaRotina(id);
    const pastaDasExecucoes = this.pastaDaRotina(id);
    this.rotinas.delete(id);
    this.execucoes.delete(id);
    return this.enfileirar(id, async () => {
      await rm(caminho, { force: true });
      await rm(pastaDasExecucoes, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
  }

  daRotina(rotinaId: string): readonly ExecucaoDaRotina[] {
    return this.maisRecentesPrimeiro(rotinaId).map((dados) => ExecucaoDaRotina.reconstituir(dados));
  }

  buscarExecucao(id: string): ExecucaoDaRotina | null {
    for (const doRotina of this.execucoes.values()) {
      const dados = doRotina.get(id);
      if (dados !== undefined) {
        return ExecucaoDaRotina.reconstituir(dados);
      }
    }
    return null;
  }

  ativaDaRotina(rotinaId: string): ExecucaoDaRotina | null {
    const dados = this.maisRecentesPrimeiro(rotinaId).find(ativa);
    return dados === undefined ? null : ExecucaoDaRotina.reconstituir(dados);
  }

  ativas(): readonly ExecucaoDaRotina[] {
    return [...this.execucoes.keys()]
      .flatMap((rotinaId) => this.maisRecentesPrimeiro(rotinaId).filter(ativa))
      .sort((a, b) => Date.parse(a.iniciadaEm) - Date.parse(b.iniciadaEm))
      .map((dados) => ExecucaoDaRotina.reconstituir(dados));
  }

  salvarExecucao(execucao: ExecucaoDaRotina): Promise<void> {
    const dados = execucao.paraDados();
    if (!this.rotinas.has(dados.rotinaId)) {
      // A Rotina foi removida enquanto a execução ainda andava: não há onde guardá-la.
      return Promise.resolve();
    }
    const caminho = this.caminhoDaExecucao(dados.rotinaId, dados.id);
    const doRotina = this.execucoes.get(dados.rotinaId) ?? new Map<string, DadosDaExecucao>();
    doRotina.set(dados.id, dados);
    this.execucoes.set(dados.rotinaId, doRotina);
    const conteudo = JSON.stringify(dados, null, 2);
    const gravacao = this.enfileirar(dados.rotinaId, async () => {
      await mkdir(path.dirname(caminho), { recursive: true });
      await gravarAtomicamente(caminho, conteudo);
    });
    this.podar(dados.rotinaId);
    return gravacao;
  }

  /** Resolve quando tudo o que foi pedido até agora estiver no disco. */
  async aguardarGravacoes(): Promise<void> {
    await Promise.all(this.filasDeGravacao.values());
  }

  /** Da mais recente para a mais antiga; empate de horário: a vista por último vem primeiro. */
  private maisRecentesPrimeiro(rotinaId: string): DadosDaExecucao[] {
    const doRotina = this.execucoes.get(rotinaId);
    if (doRotina === undefined) {
      return [];
    }
    return [...doRotina.values()].reverse().sort((a, b) => Date.parse(b.iniciadaEm) - Date.parse(a.iniciadaEm));
  }

  /** Passou de 50, sai a mais antiga que já terminou, da memória e do disco. */
  private podar(rotinaId: string): void {
    const doRotina = this.execucoes.get(rotinaId);
    if (doRotina === undefined) {
      return;
    }
    let mantidas = 0;
    for (const dados of this.maisRecentesPrimeiro(rotinaId)) {
      if (mantidas >= LIMITE_DE_EXECUCOES_GUARDADAS && !ativa(dados)) {
        doRotina.delete(dados.id);
        const caminho = this.caminhoDaExecucao(rotinaId, dados.id);
        void this.enfileirar(rotinaId, () => rm(caminho, { force: true })).catch(() => undefined);
      } else {
        mantidas++;
      }
    }
  }

  private enfileirar(id: string, tarefa: () => Promise<void>): Promise<void> {
    const anterior = this.filasDeGravacao.get(id) ?? Promise.resolve();
    const gravacao = anterior.then(tarefa);
    const cauda = gravacao.catch((erro: unknown) => {
      console.error(`[rotinas] Falha ao gravar a rotina "${id}" no disco:`, erro);
    });
    this.filasDeGravacao.set(id, cauda);
    // Fila vazia some do mapa, para não acumular uma entrada por Rotina já gravada.
    void cauda.then(() => {
      if (this.filasDeGravacao.get(id) === cauda) {
        this.filasDeGravacao.delete(id);
      }
    });
    return gravacao;
  }

  private caminhoDaRotina(id: string): string {
    if (!IDENTIDADE_VALIDA.test(id)) {
      throw new Error(`Identidade de rotina inválida: "${id}".`);
    }
    return path.join(this.pasta, `${id}${EXTENSAO}`);
  }

  private pastaDaRotina(id: string): string {
    this.caminhoDaRotina(id);
    return path.join(this.pasta, id);
  }

  private caminhoDaExecucao(rotinaId: string, execucaoId: string): string {
    if (!IDENTIDADE_VALIDA.test(execucaoId)) {
      throw new Error(`Identidade de execução inválida: "${execucaoId}".`);
    }
    return path.join(this.pastaDaRotina(rotinaId), PASTA_DAS_EXECUCOES, `${execucaoId}${EXTENSAO}`);
  }

  /** Uma Rotina com arquivo ilegível é pulada (e o arquivo, mantido), para não impedir que as outras abram. */
  private async carregarRotina(arquivo: string): Promise<void> {
    try {
      const conteudo = await readFile(path.join(this.pasta, arquivo), "utf8");
      const dados = esquemaDaRotina.parse(JSON.parse(conteudo));
      if (`${dados.id}${EXTENSAO}` !== arquivo) {
        throw new Error(`o arquivo guarda a rotina "${dados.id}".`);
      }
      // Passa pelas regras do agregado (nome, gatilho, etapas).
      this.rotinas.set(dados.id, Rotina.reconstituir(dados).paraDados());
    } catch (erro) {
      console.warn(`[rotinas] Arquivo "${arquivo}" ignorado: não foi possível ler a rotina (${detalheDe(erro)}).`);
    }
  }

  private async carregarExecucoes(rotinaId: string): Promise<void> {
    const pastaDasExecucoes = path.join(this.pastaDaRotina(rotinaId), PASTA_DAS_EXECUCOES);
    let arquivos: string[];
    try {
      arquivos = (await readdir(pastaDasExecucoes)).filter((nome) => nome.endsWith(EXTENSAO));
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[rotinas] Execuções da rotina "${rotinaId}" ignoradas: não foi possível listá-las (${detalheDe(erro)}).`);
      }
      return;
    }

    const lidas: DadosDaExecucao[] = [];
    for (const arquivo of arquivos) {
      try {
        const conteudo = await readFile(path.join(pastaDasExecucoes, arquivo), "utf8");
        const dados = esquemaDaExecucao.parse(JSON.parse(conteudo));
        if (`${dados.id}${EXTENSAO}` !== arquivo || dados.rotinaId !== rotinaId) {
          throw new Error(`o arquivo guarda a execução "${dados.id}" da rotina "${dados.rotinaId}".`);
        }
        lidas.push(ExecucaoDaRotina.reconstituir(dados).paraDados());
      } catch (erro) {
        console.warn(
          `[rotinas] Execução "${rotinaId}/${arquivo}" ignorada: não foi possível lê-la (${detalheDe(erro)}).`,
        );
      }
    }
    if (lidas.length === 0) {
      return;
    }
    // Das mais antigas para as mais novas: a ordem de leitura é a de "vista primeiro".
    lidas.sort((a, b) => Date.parse(a.iniciadaEm) - Date.parse(b.iniciadaEm) || a.id.localeCompare(b.id));
    this.execucoes.set(rotinaId, new Map(lidas.map((dados) => [dados.id, dados])));
    this.podar(rotinaId);
  }
}
