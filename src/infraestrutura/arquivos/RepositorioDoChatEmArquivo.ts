import { appendFile, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { ConversaDoChat, DadosDaConversaDoChat } from "../../chat/ConversaDoChat";
import { EventoDoChat, EventoDoChatRegistrado } from "../../chat/EventoDoChat";
import { PreferenciasDoChat } from "../../chat/PreferenciasDoChat";
import { ConversaDoChatArquivada, RepositorioDoChat } from "../../chat/RepositorioDoChat";
import { JanelaDaCota } from "../../orquestracao/EventoDeOrquestracao";

const ARQUIVO_DA_CONVERSA = "conversa.json";
const ARQUIVO_DE_EVENTOS = "eventos.jsonl";
const ARQUIVO_DAS_PREFERENCIAS = "preferencias.json";
const PASTA_DO_HISTORICO = "historico";
const PASTA_DA_SESSAO = "sessao";

async function lerSeExistir(caminho: string): Promise<string | null> {
  try {
    return await readFile(caminho, "utf8");
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw erro;
  }
}

async function copiarSeExistir(origem: string, destino: string): Promise<void> {
  try {
    await copyFile(origem, destino);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "ENOENT") {
      throw erro;
    }
  }
}

/** Grava num arquivo temporário e renomeia: um desligamento no meio não deixa JSON pela metade. */
async function gravarAtomicamente(caminho: string, conteudo: string): Promise<void> {
  const temporario = `${caminho}.tmp`;
  await writeFile(temporario, conteudo, "utf8");
  await rename(temporario, caminho);
}

/**
 * Guarda uma cópia de um arquivo que não deu para ler antes de ele ser
 * sobrescrito: o conteúdo nunca é apagado, fica para consulta.
 */
async function preservarIlegivel(caminho: string): Promise<string> {
  const copia = `${caminho}.ilegivel-${Date.now()}`;
  await copyFile(caminho, copia);
  return copia;
}

function ultimaCotaDe(eventos: readonly EventoDoChatRegistrado[]): JanelaDaCota[] | null {
  for (let indice = eventos.length - 1; indice >= 0; indice -= 1) {
    const evento = eventos[indice];
    if (evento?.tipo === "uso_da_cota") {
      return evento.janelas;
    }
  }
  return null;
}

/**
 * Repositório do chat em arquivos, para uso local de uma pessoa só:
 *
 * dados/chat/conversa.json      — estado atual da conversa (mensagens, sessão e
 *                                 autorização para alterar; sem o campo, vale false)
 * dados/chat/eventos.jsonl      — histórico da conversa atual, um evento por linha
 * dados/chat/preferencias.json  — modelo e esforço escolhidos (sobrevivem ao /clear)
 * dados/chat/historico/conversa-<N>/{conversa.json,eventos.jsonl}
 *                               — conversas anteriores, arquivadas ao limpar;
 *                                 <N> é a sequência do evento de limpeza
 * dados/chat/sessao/            — pasta onde o Claude Code do chat roda
 *
 * Tudo é carregado na abertura e mantido em memória; o disco recebe as
 * gravações numa fila única, na ordem em que foram pedidas.
 */
export class RepositorioDoChatEmArquivo implements RepositorioDoChat {
  private conversaAtual: ConversaDoChat;
  private preferenciasAtuais = PreferenciasDoChat.padrao();
  private eventos: EventoDoChatRegistrado[] = [];
  private cota: JanelaDaCota[] | null = null;
  private filaDeGravacao: Promise<void> = Promise.resolve();

  private constructor(
    private readonly pasta: string,
    sessaoId: string,
  ) {
    this.conversaAtual = ConversaDoChat.nova(sessaoId);
  }

  /** `gerarSessaoId`: usado só quando não há conversa gravada. */
  static async abrir(pastaDeDados: string, gerarSessaoId: () => string): Promise<RepositorioDoChatEmArquivo> {
    const repositorio = new RepositorioDoChatEmArquivo(path.join(pastaDeDados, "chat"), gerarSessaoId());
    await mkdir(repositorio.pastaDaSessao, { recursive: true });
    await repositorio.carregar();
    return repositorio;
  }

  /** Onde o processo do Claude Code do chat roda: uma pasta vazia, só dele. */
  get pastaDaSessao(): string {
    return path.join(this.pasta, PASTA_DA_SESSAO);
  }

  conversa(): ConversaDoChat {
    return this.conversaAtual;
  }

  salvar(conversa: ConversaDoChat): Promise<void> {
    this.conversaAtual = conversa;
    const conteudo = JSON.stringify(conversa.paraDados(), null, 2);
    return this.enfileirar(() => gravarAtomicamente(this.caminho(ARQUIVO_DA_CONVERSA), conteudo));
  }

  preferencias(): PreferenciasDoChat {
    return this.preferenciasAtuais;
  }

  salvarPreferencias(preferencias: PreferenciasDoChat): Promise<void> {
    this.preferenciasAtuais = preferencias;
    const conteudo = JSON.stringify(preferencias.paraDados(), null, 2);
    return this.enfileirar(() => gravarAtomicamente(this.caminho(ARQUIVO_DAS_PREFERENCIAS), conteudo));
  }

  anexarEvento(evento: EventoDoChat): EventoDoChatRegistrado {
    const registrado: EventoDoChatRegistrado = {
      ...evento,
      sequencia: this.ultimaSequencia() + 1,
      em: new Date().toISOString(),
    };
    this.eventos.push(registrado);
    if (registrado.tipo === "uso_da_cota") {
      this.cota = registrado.janelas;
    }

    const linha = `${JSON.stringify(registrado)}\n`;
    this.enfileirar(() => appendFile(this.caminho(ARQUIVO_DE_EVENTOS), linha, "utf8")).catch(() => undefined);
    return registrado;
  }

  /**
   * A sequência do evento de limpeza (N+1) e o histórico em memória mudam na
   * hora. No disco, numa única tarefa da fila: copia a conversa atual para
   * `historico/conversa-<N+1>/` e só então troca, de forma atômica, os
   * arquivos pelos da conversa nova. As preferências não mudam.
   */
  arquivarConversa(conversa: ConversaDoChat, evento: EventoDoChat): ConversaDoChatArquivada {
    const registrado: EventoDoChatRegistrado = {
      ...evento,
      sequencia: this.ultimaSequencia() + 1,
      em: new Date().toISOString(),
    };
    this.conversaAtual = conversa;
    this.eventos = [registrado];

    const estado = JSON.stringify(conversa.paraDados(), null, 2);
    const linha = `${JSON.stringify(registrado)}\n`;
    const arquivada = path.join(this.pasta, PASTA_DO_HISTORICO, `conversa-${registrado.sequencia}`);

    const gravacao = this.enfileirar(async () => {
      await mkdir(arquivada, { recursive: true });
      await copiarSeExistir(this.caminho(ARQUIVO_DE_EVENTOS), path.join(arquivada, ARQUIVO_DE_EVENTOS));
      await copiarSeExistir(this.caminho(ARQUIVO_DA_CONVERSA), path.join(arquivada, ARQUIVO_DA_CONVERSA));
      await gravarAtomicamente(this.caminho(ARQUIVO_DA_CONVERSA), estado);
      await gravarAtomicamente(this.caminho(ARQUIVO_DE_EVENTOS), linha);
    });
    return { registrado, gravacao };
  }

  lerEventos(depoisDaSequencia: number): readonly EventoDoChatRegistrado[] {
    return this.eventos.filter((evento) => evento.sequencia > depoisDaSequencia);
  }

  ultimaSequencia(): number {
    return this.eventos.at(-1)?.sequencia ?? 0;
  }

  /** Continua valendo depois do /clear, enquanto o servidor estiver no ar. */
  ultimaCota(): JanelaDaCota[] | null {
    return this.cota;
  }

  /** Resolve quando tudo o que foi pedido até agora estiver no disco. */
  aguardarGravacoes(): Promise<void> {
    return this.filaDeGravacao;
  }

  private enfileirar(tarefa: () => Promise<void>): Promise<void> {
    const gravacao = this.filaDeGravacao.then(tarefa);
    this.filaDeGravacao = gravacao.catch((erro: unknown) => {
      console.error("[chat] Falha ao gravar no disco:", erro);
    });
    return gravacao;
  }

  private caminho(arquivo: string): string {
    return path.join(this.pasta, arquivo);
  }

  /** Arquivo ilegível não impede o chat de abrir: vira aviso no log e uma cópia ao lado. */
  private async carregar(): Promise<void> {
    const conversa = await this.lerArquivo(ARQUIVO_DA_CONVERSA, (conteudo) =>
      ConversaDoChat.reconstituir(JSON.parse(conteudo) as DadosDaConversaDoChat),
    );
    if (conversa !== null) {
      this.conversaAtual = conversa;
    }

    const preferencias = await this.lerArquivo(ARQUIVO_DAS_PREFERENCIAS, (conteudo) => {
      const dados = JSON.parse(conteudo) as { modelo?: unknown; esforco?: unknown; permitirArtefatosOnline?: unknown };
      return PreferenciasDoChat.de({
        modelo: dados.modelo,
        esforco: dados.esforco,
        permitirArtefatosOnline: dados.permitirArtefatosOnline,
      });
    });
    if (preferencias !== null) {
      this.preferenciasAtuais = preferencias;
    }

    const linhas = (await this.lerArquivo(ARQUIVO_DE_EVENTOS, (conteudo) => conteudo)) ?? "";
    for (const linha of linhas.split("\n")) {
      if (linha.trim() === "") {
        continue;
      }
      try {
        this.eventos.push(JSON.parse(linha) as EventoDoChatRegistrado);
      } catch {
        // Última linha cortada por um desligamento no meio da gravação.
      }
    }
    this.cota = ultimaCotaDe(this.eventos);
  }

  private async lerArquivo<T>(arquivo: string, interpretar: (conteudo: string) => T): Promise<T | null> {
    const caminho = this.caminho(arquivo);
    try {
      const conteudo = await lerSeExistir(caminho);
      return conteudo === null ? null : interpretar(conteudo);
    } catch (erro) {
      let copia = "";
      try {
        copia = ` Cópia guardada em "${await preservarIlegivel(caminho)}".`;
      } catch {
        // Sem cópia: o aviso abaixo ainda sai.
      }
      console.warn(`[chat] Não foi possível ler "${caminho}"; seguindo sem ele.${copia}`, erro);
      return null;
    }
  }
}
