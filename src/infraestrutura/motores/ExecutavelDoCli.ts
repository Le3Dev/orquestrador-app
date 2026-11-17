import { statSync } from "node:fs";
import path from "node:path";

/** Como iniciar um processo: o comando e os argumentos prontos para o `spawn`. */
export interface ComandoParaProcesso {
  comando: string;
  argumentos: string[];
  /** Verdadeiro quando os argumentos já foram escritos para o `cmd.exe` e não devem ser re-citados. */
  verbatim: boolean;
}

export type PlataformaDoSistema = NodeJS.Platform;

export interface OpcoesDaProcura {
  ambiente?: NodeJS.ProcessEnv;
  plataforma?: PlataformaDoSistema;
  /** Diz se o caminho é um arquivo; padrão: confere no disco. */
  ehArquivo?: (caminho: string) => boolean;
}

/** Extensões que o Windows executa, na ordem de preferência: o `.exe` antes do `.cmd` do npm. */
const EXTENSOES_DO_WINDOWS = [".exe", ".cmd", ".bat", ".com"];

function arquivoNoDisco(caminho: string): boolean {
  try {
    return statSync(caminho).isFile();
  } catch {
    return false;
  }
}

function variantesDoCaminho(caminho: string, plataforma: PlataformaDoSistema): string[] {
  if (plataforma !== "win32") {
    return [caminho];
  }
  if (path.extname(caminho) !== "") {
    return [caminho];
  }
  return [...EXTENSOES_DO_WINDOWS.map((extensao) => `${caminho}${extensao}`), caminho];
}

/**
 * Acha um executável pelo nome (procurando no `PATH`) ou confere um caminho já
 * informado. No Windows tenta as extensões executáveis (`.exe`, `.cmd`...), porque
 * o instalador do npm cria um `copilot.cmd`, e o `spawn` não o acha só pelo nome
 * sem extensão. Nulo quando não existe.
 */
export function procurarExecutavel(nomeOuCaminho: string, opcoes: OpcoesDaProcura = {}): string | null {
  const ambiente = opcoes.ambiente ?? process.env;
  const plataforma = opcoes.plataforma ?? process.platform;
  const ehArquivo = opcoes.ehArquivo ?? arquivoNoDisco;
  const nome = nomeOuCaminho.trim();
  if (nome === "") {
    return null;
  }
  const temPasta = nome.includes("/") || nome.includes("\\") || path.isAbsolute(nome);
  const pastas = temPasta
    ? [""]
    : (ambiente.PATH ?? ambiente.Path ?? "").split(plataforma === "win32" ? ";" : ":").filter((pasta) => pasta !== "");
  for (const pasta of pastas) {
    const candidato = pasta === "" ? nome : path.join(pasta.replace(/^"|"$/g, ""), nome);
    for (const variante of variantesDoCaminho(candidato, plataforma)) {
      if (ehArquivo(variante)) {
        return variante;
      }
    }
  }
  return null;
}

/** Um `.cmd` ou `.bat` só roda pelo `cmd.exe`: o Node recusa iniciá-lo direto (CVE-2024-27980). */
export function ehScriptDoWindows(caminho: string, plataforma: PlataformaDoSistema = process.platform): boolean {
  return plataforma === "win32" && /\.(cmd|bat)$/i.test(caminho);
}

/** Caracteres que o `cmd.exe` interpretaria mesmo entre aspas ou que não dá para citar com segurança. */
const PROIBIDOS_NO_CMD = /["%\r\n\0]/;
const PRECISA_DE_ASPAS = /[\s&|<>^()!,;=]/;

export class ArgumentoInseguroError extends Error {
  constructor(argumento: string) {
    super(
      `O argumento "${argumento.slice(0, 60)}" tem caracteres que não dá para repassar com segurança a um script .cmd no Windows.`,
    );
    this.name = "ArgumentoInseguroError";
  }
}

/** Cita um argumento para a linha de comando do `cmd.exe`; recusa os que não dá para citar com segurança. */
export function citarParaCmd(argumento: string): string {
  if (PROIBIDOS_NO_CMD.test(argumento)) {
    throw new ArgumentoInseguroError(argumento);
  }
  if (argumento === "") {
    return '""';
  }
  if (!PRECISA_DE_ASPAS.test(argumento)) {
    return argumento;
  }
  // Uma barra invertida antes da aspa final escaparia a aspa: dobra as do fim.
  return `"${argumento.replace(/\\+$/, (barras) => barras + barras)}"`;
}

/**
 * O comando que o `spawn` recebe para executar `executavel` com `argumentos`.
 * Um `.exe` (ou qualquer binário no Mac/Linux) vai direto, sem shell: nenhum
 * argumento passa por regras de aspas. Um `.cmd` do Windows vai pelo `cmd.exe`
 * com a linha montada à mão.
 */
export function comandoParaProcesso(
  executavel: string,
  argumentos: readonly string[],
  plataforma: PlataformaDoSistema = process.platform,
  interpretadorDoWindows: string = process.env.ComSpec ?? "cmd.exe",
): ComandoParaProcesso {
  if (!ehScriptDoWindows(executavel, plataforma)) {
    return { comando: executavel, argumentos: [...argumentos], verbatim: false };
  }
  const linha = [executavel, ...argumentos].map(citarParaCmd).join(" ");
  // `/s` remove só as aspas externas; o resto da linha segue como está.
  return { comando: interpretadorDoWindows, argumentos: ["/d", "/s", "/c", `"${linha}"`], verbatim: true };
}
