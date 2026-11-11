import { execFile } from "node:child_process";
import { tmpdir } from "node:os";

import { ambienteSemSessaoPai } from "../infraestrutura/claudecode/ArgumentosDoClaudeCode";
import { cortar, ehObjeto } from "../skills/LeitorDeSkills";
import { InventarioDoPlugin, lerInventarioDoPlugin, precisaDeConfirmacao } from "./InventarioDoPlugin";
import { PendentesDePlugins, PendentesEmMemoria } from "./PendentesDePlugins";

export type { InventarioDoPlugin } from "./InventarioDoPlugin";

/** Um plugin do catálogo dos marketplaces (`claude plugin list --available`). */
export interface PluginDoCatalogo {
  id: string;
  nome: string;
  descricao: string;
  marketplace: string;
  oficial: boolean;
  instalacoes: number | null;
  versao: string | null;
  /** URL https do repositório, quando o marketplace informa. */
  fonte: string | null;
  instalado: boolean;
}

/** Um plugin instalado no escopo do usuário, com o que ele traz. */
export interface PluginInstalado {
  id: string;
  nome: string;
  marketplace: string;
  oficial: boolean;
  versao: string | null;
  ligado: boolean;
  instaladoEm: string | null;
  inventario: InventarioDoPlugin;
}

export type OrigemDoCatalogo = "oficial" | "aberto" | "todos";

export interface ConsultaDoCatalogo {
  busca: string;
  origem: OrigemDoCatalogo;
  limite: number;
  deslocamento: number;
}

export interface PaginaDoCatalogo {
  plugins: PluginDoCatalogo[];
  total: number;
  /** Quantos plugins de cada origem casam com a busca. */
  totais: { oficial: number; aberto: number };
}

export type MotivoDoErroDePlugin =
  | "id_invalido"
  | "nao_encontrado"
  | "instalacao_em_andamento"
  | "sem_internet"
  | "tempo_esgotado"
  | "falha_do_cli";

/** Erro com mensagem pronta para a tela; as rotas traduzem o motivo em status HTTP. */
export class ErroDePlugin extends Error {
  constructor(
    readonly motivo: MotivoDoErroDePlugin,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDePlugin";
  }
}

export interface ResultadoDoComando {
  /** Código de saída; nulo se o processo foi morto ou nem chegou a iniciar. */
  codigo: number | null;
  saida: string;
  erroPadrao: string;
  tempoEsgotado: boolean;
  /** O executável não foi encontrado ou não abriu. */
  naoIniciou: boolean;
}

/** Roda `claude <argumentos>`; injetado para os testes nunca chamarem o CLI de verdade. */
export type ExecutorDeComandos = (argumentos: readonly string[], tempoLimiteMs: number) => Promise<ResultadoDoComando>;

const LIMITE_DE_SAIDA_EM_BYTES = 8 * 1024 * 1024;

/**
 * O executor de verdade: `execFile` direto no `claude`, sem shell, no ambiente
 * sem as variáveis de uma sessão pai, fora de qualquer pasta de projeto (o
 * escopo vem sempre de `--scope user`), com tempo limite e saída limitada.
 */
export function criarExecutorDoClaude(caminhoDoClaude: string, ambiente: NodeJS.ProcessEnv = process.env): ExecutorDeComandos {
  return (argumentos, tempoLimiteMs) =>
    new Promise((resolver) => {
      const filho = execFile(
        caminhoDoClaude,
        [...argumentos],
        {
          env: ambienteSemSessaoPai(ambiente),
          cwd: tmpdir(),
          timeout: tempoLimiteMs,
          killSignal: "SIGKILL",
          maxBuffer: LIMITE_DE_SAIDA_EM_BYTES,
          windowsHide: true,
          encoding: "utf8",
        },
        (erro, saida, erroPadrao) => {
          const falha = erro as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          const estourouASaida = falha?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          resolver({
            codigo: falha === null ? 0 : typeof falha.code === "number" ? falha.code : null,
            saida,
            erroPadrao,
            tempoEsgotado: falha?.killed === true && !estourouASaida,
            naoIniciou: falha?.code === "ENOENT" || falha?.code === "EACCES",
          });
        },
      );
      // Sem terminal: qualquer pergunta interativa recebe o fim da entrada e o CLI desiste.
      filho.stdin?.end();
    });
}

const PADRAO_DO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}@[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MARKETPLACE_OFICIAL = "claude-plugins-official";
const ESCOPO = "user";

const TEMPO_PARA_LISTAR_MS = 60_000;
const TEMPO_PARA_INSTALAR_MS = 180_000;
const TEMPO_DOS_DEMAIS_MS = 30_000;
const VALIDADE_DO_CATALOGO_MS = 10 * 60_000;
const VALIDADE_DA_FALHA_DO_CATALOGO_MS = 45_000;
const LIMITE_DO_NOME = 100;
const LIMITE_DA_FONTE = 300;

const PADRAO_DE_FALHA_DE_REDE =
  /ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|network|Could not resolve host|fetch failed/i;

/** Item do catálogo com o texto da busca já normalizado, para a consulta não refazer isso a cada requisição. */
interface ItemIndexado {
  plugin: Omit<PluginDoCatalogo, "instalado">;
  texto: string;
}

/** O que o `claude plugin list --json` informa de uma instalação no escopo do usuário. */
interface EntradaInstalada {
  id: string;
  versao: string | null;
  ligado: boolean;
  instaladoEm: string | null;
  caminho: string;
}

export interface OpcoesDoCatalogoDePlugins {
  executar: ExecutorDeComandos;
  /** Pasta de configuração do Claude Code (`~/.claude`). */
  pastaDoClaude: string;
  agora?: () => number;
  /** Plugins instalados pelo app que aguardam confirmação; em memória se não vier (testes). */
  pendentes?: PendentesDePlugins;
}

/** Sem acento e sem maiúscula, para comparar a busca com nome e descrição. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function textoOuNulo(valor: unknown, limite = 100): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.slice(0, limite) : null;
}

/** A URL https do repositório do plugin, sem o `.git` final; nula quando a fonte é um caminho dentro do marketplace. */
function fonteDoPlugin(fonte: unknown): string | null {
  if (!ehObjeto(fonte)) {
    return null;
  }
  // Uma URL cortada levaria a outro lugar: acima do limite, vira nula em vez de ser cortada.
  const url = textoOuNulo(fonte["url"], LIMITE_DA_FONTE + 1);
  if (url !== null && /^https:\/\//i.test(url)) {
    const limpa = url.replace(/\.git$/i, "");
    return limpa.length <= LIMITE_DA_FONTE ? limpa : null;
  }
  const repositorio = textoOuNulo(fonte["repo"], LIMITE_DA_FONTE);
  const endereco = repositorio !== null && /^[\w.-]+\/[\w.-]+$/.test(repositorio) ? `https://github.com/${repositorio}` : null;
  return endereco !== null && endereco.length <= LIMITE_DA_FONTE ? endereco : null;
}

function indexar(bruto: unknown): ItemIndexado | null {
  if (!ehObjeto(bruto)) {
    return null;
  }
  const id = bruto["pluginId"];
  const nome = bruto["name"];
  const marketplace = bruto["marketplaceName"];
  if (typeof id !== "string" || !PADRAO_DO_ID.test(id) || typeof nome !== "string" || typeof marketplace !== "string") {
    return null;
  }
  const descricao = cortar(typeof bruto["description"] === "string" ? bruto["description"].replace(/\s+/g, " ").trim() : "");
  const instalacoes = bruto["installCount"];
  return {
    plugin: {
      id,
      nome: nome.slice(0, LIMITE_DO_NOME),
      descricao,
      marketplace: marketplace.slice(0, LIMITE_DO_NOME),
      oficial: marketplace === MARKETPLACE_OFICIAL,
      instalacoes: typeof instalacoes === "number" && Number.isFinite(instalacoes) ? instalacoes : null,
      versao: textoOuNulo(bruto["version"]),
      fonte: fonteDoPlugin(bruto["source"]),
    },
    texto: normalizar(`${nome.slice(0, LIMITE_DO_NOME)} ${descricao}`),
  };
}

function entradaInstalada(bruto: unknown): EntradaInstalada | null {
  if (!ehObjeto(bruto) || bruto["scope"] !== ESCOPO) {
    return null;
  }
  const id = bruto["id"];
  const caminho = bruto["installPath"];
  if (typeof id !== "string" || !PADRAO_DO_ID.test(id) || typeof caminho !== "string") {
    return null;
  }
  return {
    id,
    versao: textoOuNulo(bruto["version"]),
    ligado: bruto["enabled"] === true,
    instaladoEm: textoOuNulo(bruto["installedAt"]),
    caminho,
  };
}

/** Ordem da lista: mais instalados primeiro (sem a contagem, por último) e, no empate, pelo nome. */
function compararPorInstalacoes(a: ItemIndexado, b: ItemIndexado): number {
  return (b.plugin.instalacoes ?? -1) - (a.plugin.instalacoes ?? -1) || a.plugin.nome.localeCompare(b.plugin.nome, "pt-BR");
}

function lerJson(saida: string): unknown {
  try {
    return JSON.parse(saida);
  } catch {
    return undefined;
  }
}

/** Resultado de `claude plugin <comando> --json`: uma linha de JSON no fim da saída. */
function respostaEmJson(saida: string): Record<string, unknown> | null {
  const linhas = saida.split(/\r?\n/).filter((linha) => linha.trim() !== "");
  for (let indice = linhas.length - 1; indice >= 0; indice -= 1) {
    const lido = lerJson(linhas[indice] ?? "");
    if (ehObjeto(lido)) {
      return lido;
    }
  }
  return null;
}

/**
 * Catálogo dos marketplaces do Claude Code e o ciclo de vida dos plugins
 * (instalar, ligar, desligar e remover), tudo pelo próprio CLI `claude plugin`
 * no escopo do usuário, o mesmo que vale fora do app.
 *
 * Segurança: só ids `<plugin>@<marketplace>` bem formados chegam ao CLI (sem
 * shell, argumentos separados); o app nunca aceita sozinho um comando que o
 * marketplace declare (sem `-y` nem `--accept-command`: o CLI recusa); o
 * inventário vem do disco, restrito à pasta de plugins do Claude Code. O
 * `enable` do CLI aceita até um id que não existe e grava a chave nas
 * configurações, por isso ligar, desligar e remover só chamam o CLI para
 * plugins que a lista do usuário já mostra.
 *
 * Todo comando que muda estado passa por uma fila única (um por vez). A
 * instalação desliga o plugin na hora (sem nada no meio) e só liga sozinha se o
 * inventário provar que não há hooks, `bin/` nem leitura duvidosa; o que fica
 * aguardando confirmação é registrado em `pendentes`, para o início seguinte do
 * app desligar o que tiver ficado ligado por uma interrupção.
 */
export class CatalogoDePlugins {
  private readonly executar: ExecutorDeComandos;
  private readonly pastaDoClaude: string;
  private readonly agora: () => number;
  private readonly pendentes: PendentesDePlugins;

  private catalogo: { validoAte: number; itens: ItemIndexado[] } | null = null;
  private falhaDoCatalogo: { validoAte: number; erro: ErroDePlugin } | null = null;
  private instalados: EntradaInstalada[] | null = null;
  private inventarios = new Map<string, InventarioDoPlugin>();
  private carregandoOCatalogo: Promise<void> | null = null;
  private lendoInstalados: { geracao: number; promessa: Promise<EntradaInstalada[]> } | null = null;
  /** Sobe a cada mudança de instalação, para uma leitura que começou antes não gravar dado velho. */
  private geracao = 0;
  private instalando = false;
  /** Fila única dos comandos que mudam estado; nunca rejeita. */
  private fila: Promise<unknown> = Promise.resolve();

  constructor(opcoes: OpcoesDoCatalogoDePlugins) {
    this.executar = opcoes.executar;
    this.pastaDoClaude = opcoes.pastaDoClaude;
    this.agora = opcoes.agora ?? Date.now;
    this.pendentes = opcoes.pendentes ?? new PendentesEmMemoria();
  }

  async buscarCatalogo(consulta: ConsultaDoCatalogo): Promise<PaginaDoCatalogo> {
    await this.carregarCatalogo();
    const itens = this.catalogo?.itens ?? [];
    const termos = normalizar(consulta.busca).split(/\s+/).filter((termo) => termo !== "");
    const casam = itens.filter((item) => termos.every((termo) => item.texto.includes(termo)));
    const totais = {
      oficial: casam.filter((item) => item.plugin.oficial).length,
      aberto: casam.filter((item) => !item.plugin.oficial).length,
    };
    const daOrigem =
      consulta.origem === "todos"
        ? casam
        : casam.filter((item) => item.plugin.oficial === (consulta.origem === "oficial"));
    const instalados = new Set((await this.instaladosDoUsuario(false)).map((entrada) => entrada.id));
    return {
      plugins: daOrigem
        .slice(consulta.deslocamento, consulta.deslocamento + consulta.limite)
        .map((item) => ({ ...item.plugin, instalado: instalados.has(item.plugin.id) })),
      total: daOrigem.length,
      totais,
    };
  }

  async listarInstalados(): Promise<PluginInstalado[]> {
    const entradas = await this.instaladosDoUsuario(false);
    const plugins = await Promise.all(entradas.map((entrada) => this.montar(entrada)));
    return plugins.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id));
  }

  /**
   * Ao iniciar o servidor: desliga os plugins que o app instalou, que ficaram
   * aguardando confirmação e estão ligados (o app pode ter fechado entre a
   * instalação e o desligamento). Só mexe em ids que a lista do usuário mostra.
   * Nunca lança: a falha só vai para o log.
   */
  reconciliar(): Promise<void> {
    return this.naFila(async () => {
      try {
        const ids = this.pendentes.ler();
        if (ids.length === 0) {
          return;
        }
        const entradas = await this.instaladosDoUsuario(true);
        for (const id of ids) {
          const entrada = entradas.find((item) => item.id === id);
          if (entrada === undefined) {
            this.pendentes.remover(id);
          } else if (entrada.ligado) {
            await this.mudar(["plugin", "disable", id, "--scope", ESCOPO, "--json"], TEMPO_DOS_DEMAIS_MS);
          }
        }
      } catch (erro) {
        console.error("[plugins] Não foi possível reconciliar os plugins pendentes de confirmação:", erro);
      }
    });
  }

  /**
   * Instala no escopo do usuário. O plugin é desligado logo depois do `install`
   * e só volta a ligar sozinho se o inventário provar que não há hooks, `bin/`
   * nem leitura duvidosa; senão fica desligado (`precisaConfirmar`) até `ligar`.
   */
  async instalar(id: string): Promise<{ plugin: PluginInstalado; precisaConfirmar: boolean }> {
    this.validarId(id);
    if (this.instalando) {
      throw new ErroDePlugin("instalacao_em_andamento", "Já há uma instalação em andamento. Aguarde ela terminar.");
    }
    this.instalando = true;
    try {
      return await this.naFila(() => this.instalarNaFila(id));
    } finally {
      this.instalando = false;
    }
  }

  private async instalarNaFila(id: string): Promise<{ plugin: PluginInstalado; precisaConfirmar: boolean }> {
    const jaInstalado = (await this.instaladosDoUsuario(true)).find((entrada) => entrada.id === id);
    if (jaInstalado !== undefined) {
      return { plugin: await this.montar(jaInstalado), precisaConfirmar: this.pendentes.ler().includes(id) };
    }
    // Registrado antes do `install`: se o app fechar no meio, o próximo início desliga o que ficou ligado.
    try {
      this.pendentes.adicionar(id);
    } catch (erro) {
      console.error("[plugins] Não foi possível registrar a instalação pendente:", erro);
      throw new ErroDePlugin("falha_do_cli", "Não foi possível registrar a instalação. Tente de novo.");
    }
    try {
      await this.mudar(["plugin", "install", id, "--scope", ESCOPO, "--json"], TEMPO_PARA_INSTALAR_MS);
    } catch (erro) {
      // Tempo esgotado deixa o estado incerto: o registro fica para o próximo início conferir.
      if (!(erro instanceof ErroDePlugin && erro.motivo === "tempo_esgotado")) {
        this.esquecerPendente(id);
      }
      throw erro;
    }
    // Sem nada no meio: o plugin recém instalado nasce ligado e os hooks dele não podem rodar antes da checagem.
    try {
      await this.mudar(["plugin", "disable", id, "--scope", ESCOPO, "--json"], TEMPO_DOS_DEMAIS_MS);
    } catch (erro) {
      throw await this.removerPorSeguranca(id, erro);
    }
    const instalado = (await this.instaladosDoUsuario(true)).find((entrada) => entrada.id === id);
    if (instalado === undefined) {
      throw new ErroDePlugin("falha_do_cli", "O Claude Code terminou, mas o plugin não aparece entre os instalados.");
    }
    // Lido direto do disco: a decisão de ligar nunca usa o que está guardado.
    const inventario = await lerInventarioDoPlugin(this.pastaDoClaude, instalado.caminho);
    const desligado = { ...instalado, ligado: false };
    if (precisaDeConfirmacao(inventario)) {
      return { plugin: this.paraPlugin(desligado, inventario), precisaConfirmar: true };
    }
    try {
      await this.mudar(["plugin", "enable", id, "--scope", ESCOPO, "--json"], TEMPO_DOS_DEMAIS_MS);
    } catch (erro) {
      // Fica instalado e desligado: a pessoa liga pela lista.
      console.error("[plugins] Não foi possível ligar o plugin depois de instalar:", erro);
      return { plugin: this.paraPlugin(desligado, inventario), precisaConfirmar: true };
    }
    this.esquecerPendente(id);
    return { plugin: this.paraPlugin({ ...instalado, ligado: true }, inventario), precisaConfirmar: false };
  }

  /** Liga também confirma: tira o plugin da lista de pendentes. */
  async ligar(id: string): Promise<PluginInstalado> {
    return this.naFila(async () => {
      const plugin = await this.mudarEstado(id, "enable");
      this.esquecerPendente(id);
      return plugin;
    });
  }

  async desligar(id: string): Promise<PluginInstalado> {
    return this.naFila(() => this.mudarEstado(id, "disable"));
  }

  async remover(id: string): Promise<void> {
    return this.naFila(async () => {
      await this.exigirInstalado(id);
      await this.mudar(["plugin", "uninstall", id, "--scope", ESCOPO, "--json"], TEMPO_DOS_DEMAIS_MS);
      this.esquecerPendente(id);
    });
  }

  /** Roda `tarefa` depois de tudo o que já está na fila. */
  private naFila<T>(tarefa: () => Promise<T>): Promise<T> {
    const execucao = this.fila.then(tarefa);
    this.fila = execucao.catch(() => undefined);
    return execucao;
  }

  private async mudarEstado(id: string, comando: "enable" | "disable"): Promise<PluginInstalado> {
    await this.exigirInstalado(id);
    await this.mudar(["plugin", comando, id, "--scope", ESCOPO, "--json"], TEMPO_DOS_DEMAIS_MS);
    const atual = (await this.instaladosDoUsuario(true)).find((entrada) => entrada.id === id);
    if (atual === undefined) {
      throw new ErroDePlugin("nao_encontrado", "Plugin não encontrado entre os instalados.");
    }
    return this.montar(atual);
  }

  /** Comando que muda estado: o que estava guardado deixa de valer, dê certo ou não. */
  private async mudar(argumentos: readonly string[], tempoLimiteMs: number): Promise<void> {
    try {
      await this.comando(argumentos, tempoLimiteMs);
    } finally {
      this.invalidarInstalados();
    }
  }

  private esquecerPendente(id: string): void {
    try {
      this.pendentes.remover(id);
    } catch (erro) {
      console.error("[plugins] Não foi possível atualizar o registro de plugins pendentes:", erro);
    }
  }

  /** O `disable` depois da instalação falhou: tenta remover, para não deixar um plugin ligado sem checagem. */
  private async removerPorSeguranca(id: string, causa: unknown): Promise<ErroDePlugin> {
    let removido = true;
    try {
      await this.mudar(["plugin", "uninstall", id, "--scope", ESCOPO, "--json"], TEMPO_DOS_DEMAIS_MS);
      this.esquecerPendente(id);
    } catch {
      removido = false;
    }
    console.error("[plugins] Não foi possível desligar o plugin recém instalado:", causa);
    return new ErroDePlugin(
      "falha_do_cli",
      removido
        ? "Não foi possível deixar o plugin desligado depois de instalar; ele foi removido por segurança."
        : "Não foi possível deixar o plugin desligado depois de instalar. Desligue ou remova pela lista de instalados.",
    );
  }

  private validarId(id: unknown): asserts id is string {
    if (typeof id !== "string" || !PADRAO_DO_ID.test(id)) {
      throw new ErroDePlugin("id_invalido", "Identificador de plugin inválido. Use o formato nome@marketplace.");
    }
  }

  private async exigirInstalado(id: string): Promise<EntradaInstalada> {
    this.validarId(id);
    const entrada = (await this.instaladosDoUsuario(true)).find((item) => item.id === id);
    if (entrada === undefined) {
      throw new ErroDePlugin("nao_encontrado", "Plugin não encontrado entre os instalados.");
    }
    return entrada;
  }

  private invalidarInstalados(): void {
    this.geracao += 1;
    this.instalados = null;
    this.inventarios = new Map();
  }

  /** O inventário fica guardado até a próxima operação que muda estado. */
  private async montar(entrada: EntradaInstalada): Promise<PluginInstalado> {
    const guardado = this.inventarios.get(entrada.caminho);
    if (guardado !== undefined) {
      return this.paraPlugin(entrada, guardado);
    }
    const geracao = this.geracao;
    const inventario = await lerInventarioDoPlugin(this.pastaDoClaude, entrada.caminho);
    if (geracao === this.geracao) {
      this.inventarios.set(entrada.caminho, inventario);
    }
    return this.paraPlugin(entrada, inventario);
  }

  private paraPlugin(entrada: EntradaInstalada, inventario: InventarioDoPlugin): PluginInstalado {
    const [nome = entrada.id, marketplace = ""] = entrada.id.split("@");
    return {
      id: entrada.id,
      nome,
      marketplace,
      oficial: marketplace === MARKETPLACE_OFICIAL,
      versao: entrada.versao,
      ligado: entrada.ligado,
      instaladoEm: entrada.instaladoEm,
      inventario,
    };
  }

  /**
   * O catálogo (10 minutos de cache); leituras simultâneas compartilham a mesma
   * chamada ao CLI. Uma falha também fica guardada por 45 segundos, para uma tela
   * que insiste não martelar o CLI.
   */
  private async carregarCatalogo(): Promise<void> {
    if (this.catalogo !== null && this.agora() < this.catalogo.validoAte) {
      return;
    }
    if (this.falhaDoCatalogo !== null && this.agora() < this.falhaDoCatalogo.validoAte) {
      throw new ErroDePlugin(this.falhaDoCatalogo.erro.motivo, this.falhaDoCatalogo.erro.message);
    }
    this.carregandoOCatalogo ??= (async () => {
      try {
        const geracao = this.geracao;
        const resposta = await this.consultarLista(["plugin", "list", "--available", "--json"], TEMPO_PARA_LISTAR_MS);
        if (!ehObjeto(resposta) || !Array.isArray(resposta["available"])) {
          throw new ErroDePlugin("falha_do_cli", "O Claude Code devolveu o catálogo em um formato inesperado.");
        }
        const itens = (resposta["available"] as unknown[])
          .map(indexar)
          .filter((item): item is ItemIndexado => item !== null)
          .sort(compararPorInstalacoes);
        this.catalogo = { validoAte: this.agora() + VALIDADE_DO_CATALOGO_MS, itens };
        this.falhaDoCatalogo = null;
        if (geracao === this.geracao && Array.isArray(resposta["installed"])) {
          this.instalados = (resposta["installed"] as unknown[])
            .map(entradaInstalada)
            .filter((entrada): entrada is EntradaInstalada => entrada !== null);
        }
      } catch (erro) {
        if (erro instanceof ErroDePlugin) {
          this.falhaDoCatalogo = { validoAte: this.agora() + VALIDADE_DA_FALHA_DO_CATALOGO_MS, erro };
        }
        throw erro;
      } finally {
        this.carregandoOCatalogo = null;
      }
    })();
    await this.carregandoOCatalogo;
  }

  /**
   * Os plugins do escopo do usuário; `forcar` ignora o que está guardado (antes
   * de mudar algo). Leituras simultâneas da mesma geração compartilham a chamada.
   */
  private async instaladosDoUsuario(forcar: boolean): Promise<EntradaInstalada[]> {
    if (!forcar && this.instalados !== null) {
      return this.instalados;
    }
    if (this.lendoInstalados !== null && this.lendoInstalados.geracao === this.geracao) {
      return this.lendoInstalados.promessa;
    }
    const geracao = this.geracao;
    const promessa = (async () => {
      const resposta = await this.consultarLista(["plugin", "list", "--json"], TEMPO_DOS_DEMAIS_MS);
      if (!Array.isArray(resposta)) {
        throw new ErroDePlugin("falha_do_cli", "O Claude Code devolveu os plugins instalados em um formato inesperado.");
      }
      const entradas = (resposta as unknown[])
        .map(entradaInstalada)
        .filter((entrada): entrada is EntradaInstalada => entrada !== null);
      if (geracao === this.geracao) {
        this.instalados = entradas;
      }
      return entradas;
    })();
    const leitura = { geracao, promessa };
    this.lendoInstalados = leitura;
    try {
      return await promessa;
    } finally {
      if (this.lendoInstalados === leitura) {
        this.lendoInstalados = null;
      }
    }
  }

  private async consultarLista(argumentos: readonly string[], tempoLimiteMs: number): Promise<unknown> {
    const resultado = await this.comando(argumentos, tempoLimiteMs);
    const lido = lerJson(resultado.saida);
    if (lido === undefined) {
      throw new ErroDePlugin("falha_do_cli", "O Claude Code devolveu uma resposta que não é JSON.");
    }
    return lido;
  }

  /** Roda o CLI e transforma qualquer falha em `ErroDePlugin`, com mensagem fixa; o texto bruto vai só para o log. */
  private async comando(argumentos: readonly string[], tempoLimiteMs: number): Promise<ResultadoDoComando> {
    let resultado: ResultadoDoComando;
    try {
      resultado = await this.executar(argumentos, tempoLimiteMs);
    } catch (erro) {
      console.error("[plugins] Falha ao executar o Claude Code:", erro);
      throw new ErroDePlugin("falha_do_cli", "Não foi possível executar o Claude Code.");
    }
    const resposta = respostaEmJson(resultado.saida);
    const falhou = resultado.tempoEsgotado || resultado.naoIniciou || resultado.codigo !== 0 || resposta?.["outcome"] === "failed";
    if (!falhou) {
      return resultado;
    }
    const erro = this.traduzirFalha(resultado, resposta);
    console.error(`[plugins] "claude ${argumentos.slice(0, 3).join(" ")}" falhou (${erro.motivo}):`, {
      mensagem: typeof resposta?.["message"] === "string" ? resposta["message"].slice(0, 500) : undefined,
      erroPadrao: resultado.erroPadrao.slice(0, 500),
    });
    throw erro;
  }

  /** Só mensagens fixas: nada do que o CLI escreve (que pode ter caminho, URL com senha ou texto de terceiros) vai para a tela. */
  private traduzirFalha(resultado: ResultadoDoComando, resposta: Record<string, unknown> | null): ErroDePlugin {
    if (resultado.naoIniciou) {
      return new ErroDePlugin("falha_do_cli", "O Claude Code não foi encontrado. Confira a instalação dele.");
    }
    if (resultado.tempoEsgotado) {
      return new ErroDePlugin("tempo_esgotado", "O Claude Code demorou demais para responder. Tente de novo em instantes.");
    }
    const codigo = typeof resposta?.["failureCode"] === "string" ? resposta["failureCode"] : "";
    const mensagem = typeof resposta?.["message"] === "string" ? resposta["message"] : "";
    if (["not_found", "not_installed", "not_installed_at_scope"].includes(codigo)) {
      return new ErroDePlugin("nao_encontrado", "Plugin não encontrado.");
    }
    if (codigo === "command_source_refused") {
      return new ErroDePlugin(
        "falha_do_cli",
        "Este plugin pede para rodar um comando declarado pelo marketplace, e o app não aceita isso sozinho. Instale pelo terminal, com claude plugin install.",
      );
    }
    const textos = [mensagem, resultado.erroPadrao, resultado.saida];
    if (textos.some((texto) => PADRAO_DE_FALHA_DE_REDE.test(texto))) {
      return new ErroDePlugin(
        "sem_internet",
        "Não foi possível acessar o marketplace. Confira a conexão com a internet e tente de novo.",
      );
    }
    return new ErroDePlugin("falha_do_cli", "O Claude Code não conseguiu concluir a operação. Tente de novo ou use o terminal.");
  }
}
