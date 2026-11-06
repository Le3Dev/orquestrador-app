import { spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";
import path from "node:path";

import {
  ArquivoAlterado,
  arquivoAlterado,
  DiffDoArquivo,
  diffDoArquivo,
  LeitorDeAlteracoes,
  SituacaoDoArquivo,
} from "../../orquestracao/AlteracoesDoWorktree";
import { criarExecutorDeGit, ExecutorDeGit, Worktrees } from "./Worktrees";

/**
 * Teto da lista de arquivos. Um agente que gera um build ou instala
 * dependências fora do `.gitignore` produziria milhares de não rastreados: a
 * lista vira inútil para revisão e cara de montar. Os rastreados (o que o
 * agente mudou de fato) entram primeiro; os não rastreados completam até o
 * teto. O que passar disso não aparece no painel nem pode ter o diff aberto.
 */
export const LIMITE_DE_ARQUIVOS = 500;

/** Teto do diff de um arquivo (~200 KB). Acima disso, corta no fim de uma linha e marca `truncado`. */
export const LIMITE_DO_DIFF_BYTES = 200 * 1024;

/** Tempo máximo de cada comando git. */
const TEMPO_LIMITE_MS = 15_000;

/** Saída máxima das listagens (`diff --name-status`, `--numstat`, `ls-files`). */
const MAX_BUFFER_DAS_LISTAS = 32 * 1024 * 1024;

/** Como o git: um byte nulo nos primeiros 8000 bytes faz o arquivo ser tratado como binário. */
const BYTES_PARA_DETECTAR_BINARIO = 8000;

/** Não rastreados maiores que isto não têm as linhas contadas na lista (`adicoes: null`). */
const TAMANHO_MAXIMO_PARA_CONTAR_LINHAS = 1024 * 1024;

/**
 * Opções globais de todo comando de leitura:
 * - `--no-optional-locks`: não disputa o `index.lock` com um agente que roda git no worktree ao mesmo tempo;
 * - `--literal-pathspecs`: um arquivo chamado `*.ts` ou `[a].txt` é ele mesmo, não um padrão;
 * - `core.quotepath=false`: nomes com acento saem como estão, sem escapes octais;
 * - `core.longpaths=true`: no Windows, worktrees com `node_modules` estouram o MAX_PATH.
 */
const OPCOES_DE_LEITURA: readonly string[] = [
  "--no-optional-locks",
  "--literal-pathspecs",
  "-c",
  "core.quotepath=false",
  "-c",
  "core.longpaths=true",
];

const SITUACAO_POR_LETRA: Readonly<Record<string, SituacaoDoArquivo>> = {
  A: "adicionado",
  M: "modificado",
  T: "modificado",
  U: "modificado",
  D: "removido",
  R: "renomeado",
  C: "adicionado",
};

export interface OpcoesDoLeitorDeAlteracoes {
  limiteDeArquivos?: number;
  limiteDoDiffBytes?: number;
  tempoLimiteMs?: number;
}

interface Contagem {
  adicoes: number | null;
  remocoes: number | null;
  binario: boolean;
}

/**
 * Lê as alterações de um worktree com o `git` do usuário, sem shell e sem
 * alterar nada (nem o índice). Compara a árvore de trabalho com o HEAD do
 * próprio worktree — alterações no índice e fora dele, juntas — e soma os não
 * rastreados (respeitando o `.gitignore`).
 */
export class LeitorDeAlteracoesGit implements LeitorDeAlteracoes {
  private readonly executar: ExecutorDeGit;
  private readonly worktrees: Worktrees;
  private readonly limiteDeArquivos: number;
  private readonly limiteDoDiffBytes: number;
  private readonly tempoLimiteMs: number;

  constructor(opcoes: OpcoesDoLeitorDeAlteracoes = {}) {
    this.limiteDeArquivos = opcoes.limiteDeArquivos ?? LIMITE_DE_ARQUIVOS;
    this.limiteDoDiffBytes = opcoes.limiteDoDiffBytes ?? LIMITE_DO_DIFF_BYTES;
    this.tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS;
    this.executar = criarExecutorDeGit({ maxBuffer: MAX_BUFFER_DAS_LISTAS, tempoLimiteMs: this.tempoLimiteMs });
    this.worktrees = new Worktrees(this.executar);
  }

  async ehRepositorioComHead(pasta: string): Promise<boolean> {
    try {
      return (await this.worktrees.ehRepoGit(pasta)) && (await this.worktrees.temHead(pasta));
    } catch {
      return false;
    }
  }

  async listarArquivos(caminhoDoWorktree: string): Promise<readonly ArquivoAlterado[]> {
    const [nomes, numeros, outros] = await Promise.all([
      this.git(["diff", "HEAD", "--name-status", "-z", "-M", "--no-ext-diff"], caminhoDoWorktree),
      this.git(["diff", "HEAD", "--numstat", "-z", "-M", "--no-ext-diff", "--no-textconv"], caminhoDoWorktree),
      this.git(["ls-files", "--others", "--exclude-standard", "-z"], caminhoDoWorktree),
    ]);

    const contagens = lerNumstat(numeros);
    const rastreados = lerNameStatus(nomes)
      .slice(0, this.limiteDeArquivos)
      .map((entrada) =>
        arquivoAlterado({
          ...entrada,
          ...(contagens.get(entrada.caminho) ?? { adicoes: null, remocoes: null, binario: false }),
        }),
      );

    const jaListados = new Set(rastreados.map((arquivo) => arquivo.caminho));
    const vagas = Math.max(0, this.limiteDeArquivos - rastreados.length);
    const caminhosNaoRastreados = separarPorNulo(outros)
      .filter((caminho) => !jaListados.has(caminho))
      .slice(0, vagas);
    const naoRastreados: ArquivoAlterado[] = [];
    for (const caminho of caminhosNaoRastreados) {
      const { adicoes, binario } = await examinarNaoRastreado(caminhoDoWorktree, caminho);
      naoRastreados.push(
        arquivoAlterado({ caminho, caminhoAnterior: null, situacao: "nao_rastreado", adicoes, remocoes: null, binario }),
      );
    }

    return [...rastreados, ...naoRastreados].sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  }

  async contarCommitsNaBranch(caminhoDoWorktree: string, pastaOriginal: string): Promise<number> {
    try {
      const headOriginal = await this.executar([...OPCOES_DE_LEITURA, "rev-parse", "--verify", "HEAD"], pastaOriginal);
      const sha = headOriginal.saida.trim();
      if (headOriginal.codigo !== 0 || !/^[0-9a-f]{40,64}$/i.test(sha)) {
        return 0;
      }
      const contagem = await this.executar(
        [...OPCOES_DE_LEITURA, "rev-list", "--count", `${sha}..HEAD`],
        caminhoDoWorktree,
      );
      const total = Number.parseInt(contagem.saida.trim(), 10);
      return contagem.codigo === 0 && Number.isFinite(total) && total > 0 ? total : 0;
    } catch {
      return 0;
    }
  }

  async lerDiff(caminhoDoWorktree: string, arquivo: ArquivoAlterado): Promise<DiffDoArquivo> {
    if (arquivo.binario) {
      return diffDoArquivo({ caminho: arquivo.caminho, diff: "", truncado: false, binario: true });
    }
    if (arquivo.situacao === "nao_rastreado") {
      return this.diffDeArquivoNovo(caminhoDoWorktree, arquivo.caminho);
    }

    // Na renomeação, os dois caminhos entram para o git parear origem e destino.
    const caminhos = arquivo.caminhoAnterior === null ? [arquivo.caminho] : [arquivo.caminhoAnterior, arquivo.caminho];
    const { codigo, saida, cortada, erro } = await lerSaidaLimitada(
      [...OPCOES_DE_LEITURA, "diff", "HEAD", "-M", "--no-color", "--no-ext-diff", "--no-textconv", "--", ...caminhos],
      caminhoDoWorktree,
      this.limiteDoDiffBytes,
      this.tempoLimiteMs,
    );
    if (!cortada && codigo !== 0) {
      throw new Error(`git diff falhou (código ${codigo}): ${erro.trim()}`);
    }
    const diff = (cortada ? ateAUltimaLinha(saida) : saida).toString("utf8");
    if (!diff.includes("\n@@") && /^Binary files .* differ$/m.test(diff)) {
      return diffDoArquivo({ caminho: arquivo.caminho, diff: "", truncado: false, binario: true });
    }
    return diffDoArquivo({ caminho: arquivo.caminho, diff, truncado: cortada, binario: false });
  }

  /** Arquivo não rastreado: o git não tem com o que comparar, então o diff é o do arquivo novo inteiro. */
  private async diffDeArquivoNovo(raiz: string, caminho: string): Promise<DiffDoArquivo> {
    const absoluto = caminhoDentroDe(raiz, caminho);
    if (absoluto === null) {
      throw new Error(`Caminho fora do worktree: "${caminho}".`);
    }
    const informacoes = await stat(absoluto);
    if (!informacoes.isFile()) {
      // Ex.: um repositório git aninhado aparece como pasta não rastreada.
      return diffDoArquivo({ caminho, diff: "", truncado: false, binario: false });
    }
    const { conteudo, cortado } = await lerInicio(absoluto, this.limiteDoDiffBytes);
    if (ehBinario(conteudo)) {
      return diffDoArquivo({ caminho, diff: "", truncado: false, binario: true });
    }
    const texto = (cortado ? ateAUltimaLinha(conteudo) : conteudo).toString("utf8");
    return diffDoArquivo({ caminho, diff: montarDiffDeArquivoNovo(caminho, texto, cortado), truncado: cortado, binario: false });
  }

  /** Roda um comando de leitura e devolve a saída; lança se o git falhar. */
  private async git(argumentos: readonly string[], cwd: string): Promise<string> {
    const { codigo, saida, erro } = await this.executar([...OPCOES_DE_LEITURA, ...argumentos], cwd);
    if (codigo !== 0) {
      throw new Error(`git ${argumentos.slice(0, 2).join(" ")} falhou (código ${codigo}): ${erro.trim()}`);
    }
    return saida;
  }
}

function separarPorNulo(saida: string): string[] {
  return saida.split("\0").filter((parte) => parte !== "");
}

/**
 * `git diff --name-status -z`: `M\0caminho\0`, ou `R086\0anterior\0atual\0`
 * na renomeação (e `C…` na cópia).
 */
function lerNameStatus(saida: string): { caminho: string; caminhoAnterior: string | null; situacao: SituacaoDoArquivo }[] {
  const partes = saida.split("\0");
  const entradas: { caminho: string; caminhoAnterior: string | null; situacao: SituacaoDoArquivo }[] = [];
  let indice = 0;
  while (indice < partes.length) {
    const codigo = partes[indice] ?? "";
    if (codigo === "") {
      indice += 1;
      continue;
    }
    const letra = codigo.charAt(0);
    if (letra === "R" || letra === "C") {
      const anterior = partes[indice + 1];
      const atual = partes[indice + 2];
      indice += 3;
      if (anterior === undefined || atual === undefined) {
        break;
      }
      entradas.push({
        caminho: atual,
        caminhoAnterior: letra === "R" ? anterior : null,
        situacao: SITUACAO_POR_LETRA[letra] ?? "modificado",
      });
      continue;
    }
    const caminho = partes[indice + 1];
    indice += 2;
    if (caminho === undefined) {
      break;
    }
    entradas.push({ caminho, caminhoAnterior: null, situacao: SITUACAO_POR_LETRA[letra] ?? "modificado" });
  }
  return entradas;
}

/**
 * `git diff --numstat -z`: `adicoes\tremocoes\tcaminho\0`, ou
 * `adicoes\tremocoes\t\0anterior\0atual\0` na renomeação. Binário: `-\t-`.
 * Chave do mapa: o caminho atual.
 */
function lerNumstat(saida: string): Map<string, Contagem> {
  const partes = saida.split("\0");
  const contagens = new Map<string, Contagem>();
  let indice = 0;
  while (indice < partes.length) {
    const linha = partes[indice] ?? "";
    const primeiraTab = linha.indexOf("\t");
    const segundaTab = primeiraTab < 0 ? -1 : linha.indexOf("\t", primeiraTab + 1);
    if (segundaTab < 0) {
      indice += 1;
      continue;
    }
    const adicoes = linha.slice(0, primeiraTab);
    const remocoes = linha.slice(primeiraTab + 1, segundaTab);
    const resto = linha.slice(segundaTab + 1);
    let caminho: string | undefined;
    if (resto === "") {
      caminho = partes[indice + 2];
      indice += 3;
    } else {
      caminho = resto;
      indice += 1;
    }
    if (caminho === undefined) {
      break;
    }
    const binario = adicoes === "-" && remocoes === "-";
    contagens.set(caminho, {
      adicoes: binario ? null : numeroOuNulo(adicoes),
      remocoes: binario ? null : numeroOuNulo(remocoes),
      binario,
    });
  }
  return contagens;
}

function numeroOuNulo(texto: string): number | null {
  const numero = Number.parseInt(texto, 10);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Resolve um caminho relativo dentro da raiz do worktree. `null` se ele for
 * absoluto, tiver `..` ou, resolvido, cair fora da raiz.
 */
function caminhoDentroDe(raiz: string, relativo: string): string | null {
  if (relativo === "" || path.isAbsolute(relativo) || relativo.split(/[\\/]/).includes("..")) {
    return null;
  }
  const base = path.resolve(raiz);
  const alvo = path.resolve(base, relativo);
  const deVolta = path.relative(base, alvo);
  if (deVolta === "" || deVolta === ".." || deVolta.startsWith(`..${path.sep}`) || path.isAbsolute(deVolta)) {
    return null;
  }
  return alvo;
}

function ehBinario(conteudo: Buffer): boolean {
  return conteudo.subarray(0, BYTES_PARA_DETECTAR_BINARIO).includes(0);
}

function contarLinhas(conteudo: Buffer): number {
  if (conteudo.length === 0) {
    return 0;
  }
  let linhas = 0;
  for (const byte of conteudo) {
    if (byte === 0x0a) {
      linhas += 1;
    }
  }
  return conteudo[conteudo.length - 1] === 0x0a ? linhas : linhas + 1;
}

/** Lê até `limite` bytes do começo do arquivo; `cortado` diz se havia mais. */
async function lerInicio(caminho: string, limite: number): Promise<{ conteudo: Buffer; cortado: boolean }> {
  const arquivo = await open(caminho, "r");
  try {
    const buffer = Buffer.alloc(limite + 1);
    let lidos = 0;
    while (lidos < buffer.length) {
      const { bytesRead } = await arquivo.read(buffer, lidos, buffer.length - lidos, lidos);
      if (bytesRead === 0) {
        break;
      }
      lidos += bytesRead;
    }
    return { conteudo: buffer.subarray(0, Math.min(lidos, limite)), cortado: lidos > limite };
  } finally {
    await arquivo.close();
  }
}

/** Linhas e binário de um não rastreado, para a lista. Na dúvida (sumiu, é pasta, ilegível), não conta. */
async function examinarNaoRastreado(raiz: string, caminho: string): Promise<{ adicoes: number | null; binario: boolean }> {
  const absoluto = caminhoDentroDe(raiz, caminho);
  if (absoluto === null) {
    return { adicoes: null, binario: false };
  }
  try {
    const informacoes = await stat(absoluto);
    if (!informacoes.isFile()) {
      return { adicoes: null, binario: false };
    }
    const grande = informacoes.size > TAMANHO_MAXIMO_PARA_CONTAR_LINHAS;
    const { conteudo } = await lerInicio(absoluto, grande ? BYTES_PARA_DETECTAR_BINARIO : TAMANHO_MAXIMO_PARA_CONTAR_LINHAS);
    if (ehBinario(conteudo)) {
      return { adicoes: null, binario: true };
    }
    return { adicoes: grande ? null : contarLinhas(conteudo), binario: false };
  } catch {
    return { adicoes: null, binario: false };
  }
}

/** Corta depois da última quebra de linha, para não deixar meia linha (nem meio caractere UTF-8) no fim. */
function ateAUltimaLinha(conteudo: Buffer): Buffer {
  const ultimaQuebra = conteudo.lastIndexOf(0x0a);
  return ultimaQuebra < 0 ? conteudo : conteudo.subarray(0, ultimaQuebra + 1);
}

/** Diff unificado de um arquivo novo, no formato do git: todas as linhas com `+`. */
function montarDiffDeArquivoNovo(caminho: string, texto: string, cortado: boolean): string {
  const cabecalho = [`diff --git a/${caminho} b/${caminho}`, "--- /dev/null", `+++ b/${caminho}`];
  if (texto === "") {
    return `${cabecalho.join("\n")}\n`;
  }
  const terminaComQuebra = texto.endsWith("\n");
  const linhas = (terminaComQuebra ? texto.slice(0, -1) : texto).split("\n").map((linha) => linha.replace(/\r$/, ""));
  const corpo = [`@@ -0,0 +1,${linhas.length} @@`, ...linhas.map((linha) => `+${linha}`)];
  if (!terminaComQuebra && !cortado) {
    corpo.push("\\ No newline at end of file");
  }
  return `${[...cabecalho, ...corpo].join("\n")}\n`;
}

/**
 * Roda o git guardando no máximo `limite` bytes da saída: passou disso, encerra
 * o processo e marca `cortada` — um diff enorme não chega a ocupar a memória.
 */
function lerSaidaLimitada(
  argumentos: readonly string[],
  cwd: string,
  limite: number,
  tempoLimiteMs: number,
): Promise<{ codigo: number; saida: Buffer; cortada: boolean; erro: string }> {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn("git", [...argumentos], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const pedacos: Buffer[] = [];
    let total = 0;
    let cortada = false;
    let estourouOTempo = false;
    let erro = "";

    const relogio = setTimeout(() => {
      estourouOTempo = true;
      processo.kill();
    }, tempoLimiteMs);

    processo.stdout.on("data", (pedaco: Buffer) => {
      if (cortada) {
        return;
      }
      pedacos.push(pedaco);
      total += pedaco.length;
      if (total > limite) {
        cortada = true;
        processo.kill();
      }
    });
    processo.stderr.on("data", (pedaco: Buffer) => {
      if (erro.length < 4_000) {
        erro += pedaco.toString("utf8");
      }
    });
    processo.on("error", (falha) => {
      clearTimeout(relogio);
      rejeitar(falha);
    });
    processo.on("close", (codigo) => {
      clearTimeout(relogio);
      if (estourouOTempo && !cortada) {
        rejeitar(new Error(`git demorou mais de ${tempoLimiteMs} ms e foi encerrado.`));
        return;
      }
      resolver({ codigo: codigo ?? 1, saida: Buffer.concat(pedacos).subarray(0, limite), cortada, erro });
    });
  });
}
