import { createHash } from "node:crypto";
import { FSWatcher, watch } from "node:fs";
import { mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

import { ehNomeDeArquivoValido, formatoDoArquivo } from "../../artefatos/Artefato";
import { EntradaDeArtefatos } from "../../artefatos/EntradaDeArtefatos";
import { IDENTIDADE_DE_ORQUESTRADOR_VALIDA, OrigemDoArtefato } from "../../artefatos/OrigemDoArtefato";
import { ServicoDeArtefatos } from "../../artefatos/ServicoDeArtefatos";

/** Acima disso o arquivo é ignorado (com aviso no log). */
export const TAMANHO_MAXIMO_DO_ARTEFATO = 5 * 1024 * 1024;
/** Tempo sem mudança no arquivo antes de lê-lo: o agente pode estar no meio da gravação. */
export const ESPERA_PADRAO_DA_COLETA_MS = 700;
/** Quantas vezes um arquivo ainda em gravação (ou preso por outro programa) é reagendado antes de desistir. */
const TENTATIVAS_DE_COLETA = 10;

const PASTA_DO_CHAT = "chat";
const PASTA_DOS_ORQUESTRADORES = "orquestradores";

/** No Windows, antivírus, indexador e o próprio agente seguram o arquivo por instantes. */
const ERROS_PASSAGEIROS = new Set(["EPERM", "EACCES", "EBUSY"]);

function codigoDoErro(erro: unknown): string {
  return (erro as NodeJS.ErrnoException | undefined)?.code ?? "";
}

/** 5242880 -> "5"; 6500000 -> "6,2". */
function emMegabytes(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  return Number.isInteger(megabytes) ? String(megabytes) : megabytes.toFixed(1).replace(".", ",");
}

/** Um arquivo entregue na pasta de entrada, já identificado. */
export interface ArquivoNaEntrada {
  origem: OrigemDoArtefato;
  /** Só o nome, sem a pasta. */
  arquivo: string;
  /** Caminho absoluto. */
  caminho: string;
}

/**
 * A pasta de entrada dos artefatos e o layout dela:
 *
 * <entrada>/orquestradores/<orquestradorId>/<arquivo>   origem: o Orquestrador
 * <entrada>/chat/<arquivo>                              origem: o chat rápido
 *
 * Só o primeiro nível dentro da pasta de cada origem conta; subpastas e
 * extensões que não sejam HTML ou Markdown são ignoradas.
 */
export class PastaDeEntradaDosArtefatos implements EntradaDeArtefatos {
  constructor(public readonly caminho: string) {}

  get pastaDoChat(): string {
    return path.join(this.caminho, PASTA_DO_CHAT);
  }

  get pastaDosOrquestradores(): string {
    return path.join(this.caminho, PASTA_DOS_ORQUESTRADORES);
  }

  pastaDoOrquestrador(orquestradorId: string): string {
    // Valida o id: ele vira nome de pasta.
    const origem = OrigemDoArtefato.doOrquestrador(orquestradorId);
    return path.join(this.pastaDosOrquestradores, origem.id ?? "");
  }

  caminhoDe(origem: OrigemDoArtefato, arquivo: string): string {
    if (!ehNomeDeArquivoValido(arquivo)) {
      throw new Error(`Nome de arquivo inválido: "${arquivo}".`);
    }
    const pasta = origem.tipo === "chat" ? this.pastaDoChat : this.pastaDoOrquestrador(origem.id ?? "");
    return path.join(pasta, arquivo);
  }

  async garantirPastas(): Promise<void> {
    await mkdir(this.pastaDoChat, { recursive: true });
    await mkdir(this.pastaDosOrquestradores, { recursive: true });
  }

  /**
   * Caminho relativo à entrada → o arquivo entregue, ou `null` se não for um
   * (pasta, subpasta, extensão ignorada, nome inválido).
   */
  identificar(relativo: string): ArquivoNaEntrada | null {
    const partes = relativo.split(/[\\/]+/).filter((parte) => parte !== "");
    let origem: OrigemDoArtefato;
    let arquivo: string;
    if (partes.length === 2 && partes[0] === PASTA_DO_CHAT) {
      origem = OrigemDoArtefato.doChat();
      arquivo = partes[1] ?? "";
    } else if (
      partes.length === 3 &&
      partes[0] === PASTA_DOS_ORQUESTRADORES &&
      IDENTIDADE_DE_ORQUESTRADOR_VALIDA.test(partes[1] ?? "")
    ) {
      origem = OrigemDoArtefato.doOrquestrador(partes[1] ?? "");
      arquivo = partes[2] ?? "";
    } else {
      return null;
    }
    if (!ehNomeDeArquivoValido(arquivo) || formatoDoArquivo(arquivo) === null) {
      return null;
    }
    return { origem, arquivo, caminho: this.caminhoDe(origem, arquivo) };
  }

  /** `chat`, `orquestradores` ou `orquestradores/<id>`: pastas que podem trazer arquivos de uma vez (ex.: movidas para cá). */
  ehPastaDeOrigem(relativo: string): boolean {
    const partes = relativo.split(/[\\/]+/).filter((parte) => parte !== "");
    return (
      (partes.length === 1 && (partes[0] === PASTA_DO_CHAT || partes[0] === PASTA_DOS_ORQUESTRADORES)) ||
      (partes.length === 2 && partes[0] === PASTA_DOS_ORQUESTRADORES)
    );
  }

  /** Todos os arquivos entregues hoje, em todas as origens. */
  async listarArquivos(): Promise<ArquivoNaEntrada[]> {
    const arquivos: ArquivoNaEntrada[] = [];
    const juntar = async (pasta: string, prefixo: string[]): Promise<void> => {
      for (const entrada of await this.lerPasta(pasta)) {
        if (entrada.isFile()) {
          const identificado = this.identificar([...prefixo, entrada.name].join("/"));
          if (identificado !== null) {
            arquivos.push(identificado);
          }
        }
      }
    };

    await juntar(this.pastaDoChat, [PASTA_DO_CHAT]);
    for (const entrada of await this.lerPasta(this.pastaDosOrquestradores)) {
      if (entrada.isDirectory() && IDENTIDADE_DE_ORQUESTRADOR_VALIDA.test(entrada.name)) {
        await juntar(path.join(this.pastaDosOrquestradores, entrada.name), [PASTA_DOS_ORQUESTRADORES, entrada.name]);
      }
    }
    return arquivos;
  }

  async removerArquivo(origem: OrigemDoArtefato, arquivo: string): Promise<void> {
    await rm(this.caminhoDe(origem, arquivo), { force: true, maxRetries: 5, retryDelay: 50 });
  }

  private async lerPasta(pasta: string) {
    try {
      return await readdir(pasta, { withFileTypes: true });
    } catch (erro) {
      if (codigoDoErro(erro) === "ENOENT") {
        return [];
      }
      throw erro;
    }
  }
}

export interface OpcoesDoColetor {
  entrada: PastaDeEntradaDosArtefatos;
  servico: Pick<ServicoDeArtefatos, "coletar">;
  /** Tempo sem mudança no arquivo antes de lê-lo (padrão 700 ms). */
  esperaMs?: number;
  /** Em bytes (padrão 5 MB). */
  tamanhoMaximo?: number;
}

/** Chave da varredura completa na fila de temporizadores (nunca é um caminho). */
const VARREDURA = "\0varredura";

/**
 * Observa a pasta de entrada e transforma cada arquivo entregue (ou
 * regravado) num Artefato ou numa versão nova.
 *
 * - Espera o arquivo ficar ~700 ms sem mudança e confere que o tamanho lido
 *   bate com o do disco (senão, o agente ainda está gravando: espera de novo);
 * - cada arquivo tem a sua fila: duas leituras do mesmo arquivo nunca correm
 *   juntas, e eventos repetidos do Windows caem na mesma espera. O hash igual
 *   ao da última versão não vira versão (regra do Artefato);
 * - ao iniciar, varre a entrada inteira: pega o que foi entregue com o
 *   servidor desligado (o hash diz o que mudou);
 * - erros só vão para o log: nunca derrubam o servidor.
 */
export class ColetorDeArtefatosEmPasta {
  private readonly entrada: PastaDeEntradaDosArtefatos;
  private readonly servico: Pick<ServicoDeArtefatos, "coletar">;
  private readonly esperaMs: number;
  private readonly tamanhoMaximo: number;

  private observador: FSWatcher | null = null;
  private ativo = false;
  private readonly temporizadores = new Map<string, NodeJS.Timeout>();
  private readonly filas = new Map<string, Promise<void>>();
  private readonly tentativas = new Map<string, number>();

  constructor(opcoes: OpcoesDoColetor) {
    this.entrada = opcoes.entrada;
    this.servico = opcoes.servico;
    this.esperaMs = opcoes.esperaMs ?? ESPERA_PADRAO_DA_COLETA_MS;
    this.tamanhoMaximo = opcoes.tamanhoMaximo ?? TAMANHO_MAXIMO_DO_ARTEFATO;
  }

  /** Cria as pastas, começa a observar e varre o que já estava lá. Resolve depois da varredura. */
  async iniciar(): Promise<void> {
    if (this.ativo) {
      return;
    }
    this.ativo = true;
    await this.entrada.garantirPastas();
    // Observa antes de varrer: nada entregue durante a varredura se perde.
    await this.observar();
    await this.varrer();
  }

  /** Para de observar e espera as coletas em andamento terminarem. */
  async encerrar(): Promise<void> {
    this.ativo = false;
    this.observador?.close();
    this.observador = null;
    for (const temporizador of this.temporizadores.values()) {
      clearTimeout(temporizador);
    }
    this.temporizadores.clear();
    this.tentativas.clear();
    await Promise.all(this.filas.values());
  }

  private async observar(): Promise<void> {
    try {
      // Caminho longo, nunca o 8.3 (ex.: C:\Users\LEANDR~1.CAN\…, comum no
      // TEMP): com ele, o fs.watch recursivo do Windows aborta o processo
      // inteiro numa assertiva do libuv (fs-event.c), sem chance de catch.
      const caminhoReal = await realpath(this.entrada.caminho);
      if (!this.ativo) {
        return;
      }
      const observador = watch(caminhoReal, { recursive: true }, (_tipo, nome) => {
        if (nome === null) {
          // Sem o nome do arquivo (acontece em alguns sistemas): confere tudo.
          this.agendarVarredura();
          return;
        }
        this.aoMudar(String(nome));
      });
      observador.on("error", (erro) => {
        console.error(
          `[artefatos] A observação da pasta de entrada "${this.entrada.caminho}" falhou; novos artefatos só serão coletados ao reiniciar:`,
          erro,
        );
      });
      this.observador = observador;
    } catch (erro) {
      console.error(
        `[artefatos] Não foi possível observar a pasta de entrada "${this.entrada.caminho}"; artefatos só serão coletados ao reiniciar:`,
        erro,
      );
    }
  }

  private aoMudar(relativo: string): void {
    if (!this.ativo) {
      return;
    }
    const alvo = this.entrada.identificar(relativo);
    if (alvo !== null) {
      this.agendar(alvo.caminho, () => this.coletar(alvo));
      return;
    }
    // Uma pasta inteira que chegou de uma vez (ex.: movida) avisa só a pasta.
    if (this.entrada.ehPastaDeOrigem(relativo)) {
      this.agendarVarredura();
    }
  }

  private agendarVarredura(): void {
    if (this.ativo) {
      this.agendar(VARREDURA, () => this.varrer());
    }
  }

  /** Reinicia a espera a cada evento: só coleta depois de `esperaMs` sem mudança. */
  private agendar(chave: string, tarefa: () => Promise<void>): void {
    const anterior = this.temporizadores.get(chave);
    if (anterior !== undefined) {
      clearTimeout(anterior);
    }
    const temporizador = setTimeout(() => {
      this.temporizadores.delete(chave);
      if (this.ativo) {
        void this.enfileirar(chave, tarefa);
      }
    }, this.esperaMs);
    temporizador.unref();
    this.temporizadores.set(chave, temporizador);
  }

  /** Uma fila por arquivo: leituras do mesmo arquivo nunca correm juntas. */
  private enfileirar(chave: string, tarefa: () => Promise<void>): Promise<void> {
    const anterior = this.filas.get(chave) ?? Promise.resolve();
    const cauda = anterior.then(tarefa).catch((erro: unknown) => {
      const alvo = chave === VARREDURA ? "a pasta de entrada" : `"${this.relativo(chave)}"`;
      console.error(`[artefatos] Falha ao coletar ${alvo}:`, erro);
    });
    this.filas.set(chave, cauda);
    void cauda.then(() => {
      if (this.filas.get(chave) === cauda) {
        this.filas.delete(chave);
      }
    });
    return cauda;
  }

  private async varrer(): Promise<void> {
    if (!this.ativo) {
      return;
    }
    const arquivos = await this.entrada.listarArquivos();
    await Promise.all(arquivos.map((alvo) => this.enfileirar(alvo.caminho, () => this.coletar(alvo))));
  }

  private async coletar(alvo: ArquivoNaEntrada): Promise<void> {
    if (!this.ativo) {
      return;
    }
    let tamanhoNoDisco: number;
    let conteudo: Buffer;
    try {
      const informacoes = await stat(alvo.caminho);
      if (!informacoes.isFile()) {
        return;
      }
      tamanhoNoDisco = informacoes.size;
      if (tamanhoNoDisco > this.tamanhoMaximo) {
        this.avisarTamanho(alvo, tamanhoNoDisco);
        return;
      }
      conteudo = await readFile(alvo.caminho);
    } catch (erro) {
      const codigo = codigoDoErro(erro);
      if (codigo === "ENOENT") {
        // Apagado (ou renomeado) antes da coleta: nada a fazer.
        this.tentativas.delete(alvo.caminho);
        return;
      }
      if (ERROS_PASSAGEIROS.has(codigo)) {
        this.reagendar(alvo, `arquivo em uso (${codigo})`);
        return;
      }
      throw erro;
    }

    if (conteudo.length !== tamanhoNoDisco) {
      // Mudou entre o stat e a leitura: o agente ainda está gravando.
      this.reagendar(alvo, "o arquivo ainda está sendo gravado");
      return;
    }
    if (conteudo.length > this.tamanhoMaximo) {
      this.avisarTamanho(alvo, conteudo.length);
      return;
    }
    this.tentativas.delete(alvo.caminho);

    const hash = createHash("sha256").update(conteudo).digest("hex");
    await this.servico.coletar({ origem: alvo.origem, arquivo: alvo.arquivo, conteudo, hash });
  }

  private reagendar(alvo: ArquivoNaEntrada, motivo: string): void {
    const tentativa = (this.tentativas.get(alvo.caminho) ?? 0) + 1;
    if (tentativa > TENTATIVAS_DE_COLETA) {
      this.tentativas.delete(alvo.caminho);
      console.warn(
        `[artefatos] Arquivo "${this.relativo(alvo.caminho)}" não coletado depois de ${TENTATIVAS_DE_COLETA} tentativas: ${motivo}. Ele será coletado na próxima gravação ou ao reiniciar.`,
      );
      return;
    }
    this.tentativas.set(alvo.caminho, tentativa);
    this.agendar(alvo.caminho, () => this.coletar(alvo));
  }

  private avisarTamanho(alvo: ArquivoNaEntrada, tamanho: number): void {
    console.warn(
      `[artefatos] Arquivo "${this.relativo(alvo.caminho)}" ignorado: tem ${emMegabytes(tamanho)} MB, acima do limite de ${emMegabytes(this.tamanhoMaximo)} MB por artefato.`,
    );
  }

  private relativo(caminho: string): string {
    return path.relative(this.entrada.caminho, caminho);
  }
}
