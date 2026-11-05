import { createReadStream } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { ehObjeto, JanelaDeTempo, lerLinhaJson, linhaNaJanela, texto, TranscricaoLida } from "./MedicaoDasTranscricoes";

/**
 * Onde o Claude Code guarda as transcrições das sessões e como encontrá-las.
 * Trazido do benchmark local, que passa a importar daqui.
 */

/**
 * Pasta de configuração do Claude Code: `CLAUDE_CONFIG_DIR` ou `~/.claude`
 * (no Windows, `%USERPROFILE%\.claude`). Ali ficam as configurações do
 * usuário e o histórico das sessões (`projects/`).
 */
export function pastaDoClaude(ambiente: NodeJS.ProcessEnv = process.env, pastaPessoal: string = homedir()): string {
  const configurada = ambiente["CLAUDE_CONFIG_DIR"];
  return configurada !== undefined && configurada.trim() !== "" ? configurada : path.join(pastaPessoal, ".claude");
}

/** Como o Claude Code nomeia a pasta do projeto: todo caractere não alfanumérico vira `-`. */
export function slugDaPasta(caminho: string): string {
  return caminho.replace(/[^a-zA-Z0-9]/g, "-");
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await access(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pasta de projeto que contém `<sessao>.jsonl`: primeiro pelo slug da pasta
 * de trabalho; se não achar (slug truncado em caminhos longos), procura em todas.
 */
async function pastaDoProjetoDaSessao(projetos: string, pastaDeTrabalho: string, sessao: string): Promise<string | null> {
  const porSlug = path.join(projetos, slugDaPasta(pastaDeTrabalho));
  if (await existe(path.join(porSlug, `${sessao}.jsonl`))) {
    return porSlug;
  }
  try {
    for (const entrada of await readdir(projetos, { withFileTypes: true })) {
      if (entrada.isDirectory() && (await existe(path.join(projetos, entrada.name, `${sessao}.jsonl`)))) {
        return path.join(projetos, entrada.name);
      }
    }
  } catch {
    // Sem pasta de projetos.
  }
  return null;
}

export interface ArquivoDeTranscricao {
  caminho: string;
  papel: "principal" | "subagente";
  agenteId: string | null;
  tipoDeAgente: string | null;
  /** `toolUseId` do `.meta.json`: a chamada `Agent` que lançou o subagente. */
  chamadaId: string | null;
}

/**
 * Principal em `<projetos>/<slug>/<sessao>.jsonl`; cada subagente em
 * `<projetos>/<slug>/<sessao>/subagents/agent-<id>.jsonl`, com o tipo
 * (`agentType`) e a chamada (`toolUseId`) em `agent-<id>.meta.json`.
 * Sessões sem transcrição principal são ignoradas.
 */
export async function localizarTranscricoes(
  pastaDeTrabalho: string,
  sessoes: readonly string[],
  pastaDeConfiguracao: string = pastaDoClaude(),
): Promise<ArquivoDeTranscricao[]> {
  const projetos = path.join(pastaDeConfiguracao, "projects");
  const arquivos: ArquivoDeTranscricao[] = [];
  for (const sessao of sessoes) {
    const pasta = await pastaDoProjetoDaSessao(projetos, pastaDeTrabalho, sessao);
    if (pasta === null) {
      continue;
    }
    arquivos.push({
      caminho: path.join(pasta, `${sessao}.jsonl`),
      papel: "principal",
      agenteId: null,
      tipoDeAgente: null,
      chamadaId: null,
    });
    const pastaDeSubagentes = path.join(pasta, sessao, "subagents");
    let nomes: string[] = [];
    try {
      nomes = await readdir(pastaDeSubagentes);
    } catch {
      continue;
    }
    for (const nome of nomes.filter((item) => /^agent-.+\.jsonl$/.test(item)).sort()) {
      const agenteId = nome.replace(/^agent-/, "").replace(/\.jsonl$/, "");
      let tipoDeAgente: string | null = null;
      let chamadaId: string | null = null;
      try {
        const meta: unknown = JSON.parse(
          await readFile(path.join(pastaDeSubagentes, `agent-${agenteId}.meta.json`), "utf8"),
        );
        if (ehObjeto(meta)) {
          tipoDeAgente = texto(meta, "agentType") || null;
          chamadaId = texto(meta, "toolUseId") || null;
        }
      } catch {
        // Sem meta: tipo e chamada desconhecidos.
      }
      arquivos.push({ caminho: path.join(pastaDeSubagentes, nome), papel: "subagente", agenteId, tipoDeAgente, chamadaId });
    }
  }
  return arquivos;
}

/**
 * Lê um `.jsonl` linha a linha (sem carregar o arquivo inteiro), guardando só
 * as linhas válidas que passam no filtro. Arquivo ausente ou ilegível → lista vazia.
 */
export async function lerLinhasDoArquivo(
  caminho: string,
  manter: (linha: unknown) => boolean = () => true,
): Promise<unknown[]> {
  const linhas: unknown[] = [];
  try {
    const fluxo = createReadStream(caminho, { encoding: "utf8" });
    const leitor = createInterface({ input: fluxo, crlfDelay: Infinity });
    for await (const bruta of leitor) {
      const linha = lerLinhaJson(bruta);
      if (linha !== undefined && manter(linha)) {
        linhas.push(linha);
      }
    }
  } catch {
    // Arquivo sumiu ou não pôde ser lido: mede o que deu.
  }
  return linhas;
}

/** Lê as transcrições; com `janela`, guarda só as linhas com `timestamp` dentro dela. */
export async function lerTranscricoes(
  arquivos: readonly ArquivoDeTranscricao[],
  janela?: JanelaDeTempo,
): Promise<TranscricaoLida[]> {
  const manter = janela === undefined ? undefined : (linha: unknown): boolean => linhaNaJanela(linha, janela);
  return Promise.all(
    arquivos.map(async (arquivo) => ({
      papel: arquivo.papel,
      agenteId: arquivo.agenteId,
      tipoDeAgente: arquivo.tipoDeAgente,
      chamadaId: arquivo.chamadaId,
      linhas: await lerLinhasDoArquivo(arquivo.caminho, manter),
    })),
  );
}
