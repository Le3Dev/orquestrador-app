import { spawn } from "node:child_process";
import path from "node:path";

import { encerrarArvore } from "./Processos";

/** O sistema não tem como abrir a janela (ex.: Linux sem zenity). A tela usa o navegador interno. */
export class SeletorDePastaIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SeletorDePastaIndisponivel";
  }
}

/** Abre a janela de escolher pasta do sistema. Nulo quando a pessoa cancela. */
export interface SeletorDePasta {
  escolher(inicial: string | undefined, sinal: AbortSignal): Promise<string | null>;
}

export interface ComandoDoSeletor {
  comando: string;
  argumentos: string[];
  ambiente?: Record<string, string>;
  /** Saídas que significam "cancelou" (além de sair com 0 e sem caminho). */
  codigosDeCancelamento: number[];
}

const PERGUNTA = "Escolha a pasta em que o Claude vai trabalhar";

/**
 * `activate` traz a janela para a frente do navegador. Cancelar dá o erro
 * -128, que vira saída vazia. A pasta inicial chega como argumento, nunca
 * dentro do texto do script.
 */
const SCRIPT_DO_MACOS = [
  "on run argv",
  "  activate",
  `  set pergunta to "${PERGUNTA}"`,
  "  try",
  "    if (count of argv) > 0 then",
  "      set escolhida to choose folder with prompt pergunta default location (POSIX file (item 1 of argv))",
  "    else",
  "      set escolhida to choose folder with prompt pergunta",
  "    end if",
  "    return POSIX path of escolhida",
  "  on error number -128",
  '    return ""',
  "  end try",
  "end run",
].join("\n");

/**
 * Um formulário invisível com TopMost é o dono da janela, para ela não abrir
 * atrás do navegador. A pasta inicial vai por variável de ambiente, e a saída
 * em UTF-8 preserva acentos do caminho.
 */
const SCRIPT_DO_WINDOWS = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "Add-Type -AssemblyName System.Windows.Forms",
  "[System.Windows.Forms.Application]::EnableVisualStyles()",
  "$dono = New-Object System.Windows.Forms.Form",
  "$dono.TopMost = $true",
  "$dono.ShowInTaskbar = $false",
  "$dialogo = New-Object System.Windows.Forms.FolderBrowserDialog",
  `$dialogo.Description = '${PERGUNTA}'`,
  "$dialogo.ShowNewFolderButton = $true",
  "if ($env:ORQUESTRADOR_PASTA_INICIAL) { $dialogo.SelectedPath = $env:ORQUESTRADOR_PASTA_INICIAL }",
  "if ($dialogo.ShowDialog($dono) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialogo.SelectedPath) }",
  "$dono.Dispose()",
].join("\n");

/** O comando de cada sistema, sem shell. Nulo onde não há janela conhecida. */
export function comandoDoSeletor(plataforma: NodeJS.Platform, inicial: string | undefined): ComandoDoSeletor | null {
  if (plataforma === "darwin") {
    return {
      comando: "osascript",
      argumentos: ["-e", SCRIPT_DO_MACOS, ...(inicial === undefined ? [] : [inicial])],
      codigosDeCancelamento: [],
    };
  }
  if (plataforma === "win32") {
    return {
      comando: "powershell.exe",
      argumentos: [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-EncodedCommand",
        Buffer.from(SCRIPT_DO_WINDOWS, "utf16le").toString("base64"),
      ],
      ...(inicial === undefined ? {} : { ambiente: { ORQUESTRADOR_PASTA_INICIAL: inicial } }),
      codigosDeCancelamento: [],
    };
  }
  if (plataforma === "linux") {
    return {
      comando: "zenity",
      argumentos: [
        "--file-selection",
        "--directory",
        `--title=${PERGUNTA}`,
        ...(inicial === undefined ? [] : [`--filename=${inicial}${path.posix.sep}`]),
      ],
      codigosDeCancelamento: [1],
    };
  }
  return null;
}

/** Caminho que a janela devolveu, sem BOM, quebra de linha nem a barra final do macOS. */
export function caminhoDaSaida(saida: string): string | null {
  const caminho = saida.replace(/^﻿/, "").trim();
  if (caminho === "") {
    return null;
  }
  return caminho.length > 1 && /[\\/]$/.test(caminho) && !/^[A-Za-z]:\\$/.test(caminho)
    ? caminho.replace(/[\\/]+$/, "")
    : caminho;
}

export interface SaidaDoSeletor {
  /** Nulo quando o processo foi encerrado por cancelamento ou tempo esgotado. */
  codigo: number | null;
  saida: string;
  erro: string;
}

export type ExecutorDoSeletor = (comando: ComandoDoSeletor, sinal: AbortSignal) => Promise<SaidaDoSeletor>;

/** Roda o comando sem shell. Cancelar (o sinal) encerra a janela. */
export const executarSeletor: ExecutorDoSeletor = (comando, sinal) =>
  new Promise((resolver, rejeitar) => {
    const processo = spawn(comando.comando, comando.argumentos, {
      windowsHide: true,
      env: { ...process.env, ...comando.ambiente },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    let erro = "";
    processo.stdout.setEncoding("utf8").on("data", (pedaco: string) => (saida += pedaco));
    processo.stderr.setEncoding("utf8").on("data", (pedaco: string) => (erro += pedaco));
    const encerrar = () => encerrarArvore(processo.pid);
    sinal.addEventListener("abort", encerrar, { once: true });
    processo.on("error", (falha: NodeJS.ErrnoException) => {
      sinal.removeEventListener("abort", encerrar);
      rejeitar(
        falha.code === "ENOENT"
          ? new SeletorDePastaIndisponivel(`"${comando.comando}" não está instalado.`)
          : falha,
      );
    });
    processo.on("close", (codigo) => {
      sinal.removeEventListener("abort", encerrar);
      resolver({ codigo: sinal.aborted ? null : codigo, saida, erro });
    });
  });

/** Ninguém respondeu à janela nesse tempo: ela é fechada e vale como cancelada. */
const TEMPO_MAXIMO_MS = 5 * 60_000;

export class SeletorDePastaNativo implements SeletorDePasta {
  constructor(
    private readonly plataforma: NodeJS.Platform = process.platform,
    private readonly executar: ExecutorDoSeletor = executarSeletor,
    private readonly tempoMaximoMs = TEMPO_MAXIMO_MS,
  ) {}

  async escolher(inicial: string | undefined, sinal: AbortSignal): Promise<string | null> {
    const comando = comandoDoSeletor(this.plataforma, inicial);
    if (comando === null) {
      throw new SeletorDePastaIndisponivel("Este sistema não tem uma janela de escolher pasta conhecida.");
    }
    const { codigo, saida, erro } = await this.executar(
      comando,
      AbortSignal.any([sinal, AbortSignal.timeout(this.tempoMaximoMs)]),
    );
    if (codigo === null || comando.codigosDeCancelamento.includes(codigo)) {
      return null;
    }
    if (codigo !== 0) {
      throw new SeletorDePastaIndisponivel(`A janela do sistema falhou (código ${codigo}): ${erro.trim()}`);
    }
    return caminhoDaSaida(saida);
  }
}
