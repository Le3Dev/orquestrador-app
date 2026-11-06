import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";

import { z } from "zod";

import { Artefato, DadosDoArtefato, EXTENSAO_DO_FORMATO, FORMATOS_DE_ARTEFATO } from "../../artefatos/Artefato";
import { IDENTIDADE_DE_ORQUESTRADOR_VALIDA, OrigemDoArtefato } from "../../artefatos/OrigemDoArtefato";
import { ConteudoDaVersao, RepositorioDeArtefatos } from "../../artefatos/RepositorioDeArtefatos";
import { HASH_VALIDO } from "../../artefatos/VersaoDoArtefato";

export const PASTA_DOS_ARTEFATOS = "artefatos";
/** Subpasta de `artefatos/` onde os agentes entregam os arquivos: nunca é um Artefato. */
export const PASTA_DE_ENTRADA = "entrada";
const ARQUIVO_DO_ARTEFATO = "artefato.json";

/** Só identidades geradas por nós: nada de "..\" escapando da pasta dos artefatos. */
const IDENTIDADE_VALIDA = /^[A-Za-z0-9_-]{1,100}$/;

const esquemaDaVersao = z.object({
  numero: z.number().int().positive(),
  criadaEm: z.iso.datetime({ offset: true }),
  tamanho: z.number().int().nonnegative(),
  hash: z.string().regex(HASH_VALIDO),
});

const esquemaDoArquivo = z.object({
  id: z.string().regex(IDENTIDADE_VALIDA),
  titulo: z.string(),
  formato: z.enum(FORMATOS_DE_ARTEFATO),
  origem: z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("orquestrador"), id: z.string().regex(IDENTIDADE_DE_ORQUESTRADOR_VALIDA) }),
    z.object({ tipo: z.literal("chat"), id: z.null() }),
  ]),
  arquivo: z.string(),
  criadoEm: z.iso.datetime({ offset: true }),
  atualizadoEm: z.iso.datetime({ offset: true }),
  versoes: z.array(esquemaDaVersao).min(1),
});

/** No Windows, antivírus e indexador seguram o arquivo por instantes e o rename falha. */
const ERROS_PASSAGEIROS = new Set(["EPERM", "EACCES", "EBUSY"]);
const TENTATIVAS_DE_RENOMEAR = 5;

async function renomearComNovasTentativas(origem: string, destino: string): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await rename(origem, destino);
      return;
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code ?? "";
      if (tentativa >= TENTATIVAS_DE_RENOMEAR || !ERROS_PASSAGEIROS.has(codigo)) {
        throw erro;
      }
      await esperar(25 * tentativa);
    }
  }
}

/** Grava num arquivo temporário e renomeia: um desligamento no meio não deixa arquivo pela metade. */
async function gravarAtomicamente(caminho: string, conteudo: string | Buffer): Promise<void> {
  const temporario = `${caminho}.tmp`;
  await writeFile(temporario, conteudo);
  await renomearComNovasTentativas(temporario, caminho);
}

function compararPorAtualizacao(a: DadosDoArtefato, b: DadosDoArtefato): number {
  return Date.parse(b.atualizadoEm) - Date.parse(a.atualizadoEm) || a.id.localeCompare(b.id);
}

/**
 * Repositório em arquivos, uma pasta por Artefato:
 *
 * dados/artefatos/<id>/artefato.json   o agregado (título, origem, versões)
 * dados/artefatos/<id>/v<N>.html|md    o conteúdo de cada versão
 *
 * (`dados/artefatos/entrada/` é a pasta de entrada dos agentes, e não um Artefato.)
 *
 * Tudo, menos o conteúdo das versões, é carregado na abertura e mantido em
 * memória (como cópias dos dados). O disco recebe as gravações numa fila por
 * Artefato: gravações do mesmo Artefato saem na ordem pedida; Artefatos
 * diferentes gravam em paralelo.
 */
export class RepositorioDeArtefatosEmArquivo implements RepositorioDeArtefatos {
  private readonly artefatos = new Map<string, DadosDoArtefato>();
  private readonly filasDeGravacao = new Map<string, Promise<void>>();

  private constructor(private readonly pasta: string) {}

  static async abrir(pastaDeDados: string): Promise<RepositorioDeArtefatosEmArquivo> {
    const repositorio = new RepositorioDeArtefatosEmArquivo(path.join(pastaDeDados, PASTA_DOS_ARTEFATOS));
    await mkdir(repositorio.pasta, { recursive: true });

    const entradas = await readdir(repositorio.pasta, { withFileTypes: true });
    for (const entrada of entradas) {
      if (entrada.isDirectory() && entrada.name !== PASTA_DE_ENTRADA) {
        await repositorio.carregar(entrada.name);
      }
    }
    return repositorio;
  }

  todos(): readonly Artefato[] {
    return [...this.artefatos.values()].sort(compararPorAtualizacao).map((dados) => Artefato.reconstituir(dados));
  }

  buscar(id: string): Artefato | null {
    const dados = this.artefatos.get(id);
    return dados === undefined ? null : Artefato.reconstituir(dados);
  }

  buscarPorArquivo(origem: OrigemDoArtefato, arquivo: string): Artefato | null {
    for (const dados of this.artefatos.values()) {
      if (dados.arquivo === arquivo && dados.origem.tipo === origem.tipo && dados.origem.id === origem.id) {
        return Artefato.reconstituir(dados);
      }
    }
    return null;
  }

  salvar(artefato: Artefato, novaVersao?: ConteudoDaVersao): Promise<void> {
    const dados = artefato.paraDados();
    const pastaDoArtefato = this.pastaDo(dados.id);
    const caminhoDoConteudo =
      novaVersao === undefined ? null : path.join(pastaDoArtefato, this.nomeDaVersao(dados, novaVersao.numero));
    // A memória troca na hora: a próxima coleta já parte desta versão.
    this.artefatos.set(dados.id, dados);
    const estado = JSON.stringify(dados, null, 2);
    return this.enfileirar(dados.id, async () => {
      await mkdir(pastaDoArtefato, { recursive: true });
      if (caminhoDoConteudo !== null && novaVersao !== undefined) {
        await gravarAtomicamente(caminhoDoConteudo, novaVersao.conteudo);
      }
      await gravarAtomicamente(path.join(pastaDoArtefato, ARQUIVO_DO_ARTEFATO), estado);
    });
  }

  async lerConteudo(id: string, numero: number): Promise<Buffer | null> {
    const dados = this.artefatos.get(id);
    if (dados === undefined || !dados.versoes.some((versao) => versao.numero === numero)) {
      return null;
    }
    // Uma versão recém-coletada pode ainda estar a caminho do disco.
    await this.filasDeGravacao.get(id);
    try {
      return await readFile(path.join(this.pastaDo(id), this.nomeDaVersao(dados, numero)));
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") {
        console.warn(`[artefatos] Conteúdo da versão ${numero} do artefato "${id}" não está no disco.`);
        return null;
      }
      throw erro;
    }
  }

  remover(id: string): Promise<void> {
    const pastaDoArtefato = this.pastaDo(id);
    this.artefatos.delete(id);
    return this.enfileirar(id, () =>
      rm(pastaDoArtefato, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    );
  }

  /** Resolve quando tudo o que foi pedido até agora estiver no disco. */
  async aguardarGravacoes(): Promise<void> {
    await Promise.all(this.filasDeGravacao.values());
  }

  private enfileirar(id: string, tarefa: () => Promise<void>): Promise<void> {
    const anterior = this.filasDeGravacao.get(id) ?? Promise.resolve();
    const gravacao = anterior.then(tarefa);
    const cauda = gravacao.catch((erro: unknown) => {
      console.error(`[artefatos] Falha ao gravar o artefato "${id}" no disco:`, erro);
    });
    this.filasDeGravacao.set(id, cauda);
    // Fila vazia some do mapa, para não acumular uma entrada por Artefato já gravado.
    void cauda.then(() => {
      if (this.filasDeGravacao.get(id) === cauda) {
        this.filasDeGravacao.delete(id);
      }
    });
    return gravacao;
  }

  private pastaDo(id: string): string {
    if (!IDENTIDADE_VALIDA.test(id) || id === PASTA_DE_ENTRADA) {
      throw new Error(`Identidade de artefato inválida: "${id}".`);
    }
    return path.join(this.pasta, id);
  }

  private nomeDaVersao(dados: DadosDoArtefato, numero: number): string {
    return `v${numero}.${EXTENSAO_DO_FORMATO[dados.formato]}`;
  }

  /** Um Artefato ilegível é pulado (e mantido no disco), para não impedir que os outros abram. */
  private async carregar(pastaDoArtefato: string): Promise<void> {
    const caminho = path.join(pastaDoArtefato, ARQUIVO_DO_ARTEFATO);
    try {
      const conteudo = await readFile(path.join(this.pasta, caminho), "utf8");
      const dados = esquemaDoArquivo.parse(JSON.parse(conteudo));
      if (dados.id !== pastaDoArtefato) {
        throw new Error(`a pasta guarda o artefato "${dados.id}".`);
      }
      // Passa pelas regras do agregado (título, nome do arquivo, versões em sequência).
      this.artefatos.set(dados.id, Artefato.reconstituir(dados).paraDados());
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      console.warn(`[artefatos] Artefato "${caminho}" ignorado: não foi possível lê-lo (${detalhe}).`);
    }
  }
}
