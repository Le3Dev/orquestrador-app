import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { EventoDeOrquestracao, EventoRegistrado } from "../../orquestracao/EventoDeOrquestracao";
import { DadosDoOrquestrador, Orquestrador } from "../../orquestracao/Orquestrador";
import { RepositorioDeOrquestradores } from "../../orquestracao/RepositorioDeOrquestradores";

const ARQUIVO_DO_ORQUESTRADOR = "orquestrador.json";
const ARQUIVO_DE_EVENTOS = "eventos.jsonl";

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

/** Grava num arquivo temporário e renomeia: um desligamento no meio não deixa JSON pela metade. */
async function gravarAtomicamente(caminho: string, conteudo: string): Promise<void> {
  const temporario = `${caminho}.tmp`;
  await writeFile(temporario, conteudo, "utf8");
  await rename(temporario, caminho);
}

/**
 * Repositório em arquivos, para uso local de uma pessoa só:
 *
 * dados/orquestradores/<id>/orquestrador.json  — estado atual do agregado
 * dados/orquestradores/<id>/eventos.jsonl      — histórico, um evento por linha
 *
 * Tudo é carregado na abertura e mantido em memória; o disco recebe as
 * gravações numa fila única, na ordem em que foram pedidas.
 */
export class RepositorioDeOrquestradoresEmArquivo implements RepositorioDeOrquestradores {
  private readonly orquestradores = new Map<string, Orquestrador>();
  private readonly eventos = new Map<string, EventoRegistrado[]>();
  private filaDeGravacao: Promise<void> = Promise.resolve();

  private constructor(private readonly pasta: string) {}

  static async abrir(pastaDeDados: string): Promise<RepositorioDeOrquestradoresEmArquivo> {
    const repositorio = new RepositorioDeOrquestradoresEmArquivo(path.join(pastaDeDados, "orquestradores"));
    await mkdir(repositorio.pasta, { recursive: true });

    const entradas = await readdir(repositorio.pasta, { withFileTypes: true });
    for (const entrada of entradas.filter((item) => item.isDirectory())) {
      await repositorio.carregar(entrada.name);
    }
    return repositorio;
  }

  listar(): readonly Orquestrador[] {
    return [...this.orquestradores.values()].sort(
      (a, b) => a.criadoEm.getTime() - b.criadoEm.getTime(),
    );
  }

  buscarPorId(id: string): Orquestrador | null {
    return this.orquestradores.get(id) ?? null;
  }

  salvar(orquestrador: Orquestrador): Promise<void> {
    this.orquestradores.set(orquestrador.id, orquestrador);
    if (!this.eventos.has(orquestrador.id)) {
      this.eventos.set(orquestrador.id, []);
    }
    const conteudo = JSON.stringify(orquestrador.paraDados(), null, 2);
    return this.enfileirar(async () => {
      await mkdir(this.pastaDo(orquestrador.id), { recursive: true });
      await gravarAtomicamente(path.join(this.pastaDo(orquestrador.id), ARQUIVO_DO_ORQUESTRADOR), conteudo);
    });
  }

  remover(id: string): Promise<void> {
    this.orquestradores.delete(id);
    this.eventos.delete(id);
    return this.enfileirar(() => rm(this.pastaDo(id), { recursive: true, force: true }));
  }

  anexarEvento(orquestradorId: string, evento: EventoDeOrquestracao): EventoRegistrado {
    const historico = this.eventos.get(orquestradorId) ?? [];
    this.eventos.set(orquestradorId, historico);

    const registrado: EventoRegistrado = {
      ...evento,
      sequencia: (historico.at(-1)?.sequencia ?? 0) + 1,
      em: new Date().toISOString(),
    };
    historico.push(registrado);

    const linha = `${JSON.stringify(registrado)}\n`;
    this.enfileirar(async () => {
      await mkdir(this.pastaDo(orquestradorId), { recursive: true });
      await appendFile(path.join(this.pastaDo(orquestradorId), ARQUIVO_DE_EVENTOS), linha, "utf8");
    }).catch(() => undefined);
    return registrado;
  }

  lerEventos(orquestradorId: string, depoisDaSequencia: number): readonly EventoRegistrado[] {
    return (this.eventos.get(orquestradorId) ?? []).filter(
      (evento) => evento.sequencia > depoisDaSequencia,
    );
  }

  /** Resolve quando tudo o que foi pedido até agora estiver no disco. */
  aguardarGravacoes(): Promise<void> {
    return this.filaDeGravacao;
  }

  private enfileirar(tarefa: () => Promise<void>): Promise<void> {
    const gravacao = this.filaDeGravacao.then(tarefa);
    this.filaDeGravacao = gravacao.catch((erro: unknown) => {
      console.error("[repositorio] Falha ao gravar no disco:", erro);
    });
    return gravacao;
  }

  private pastaDo(id: string): string {
    return path.join(this.pasta, id);
  }

  /** Um orquestrador com arquivo corrompido é pulado, para não impedir que os outros abram. */
  private async carregar(id: string): Promise<void> {
    try {
      const estado = await lerSeExistir(path.join(this.pastaDo(id), ARQUIVO_DO_ORQUESTRADOR));
      if (estado === null) {
        return;
      }
      const orquestrador = Orquestrador.reconstituir(JSON.parse(estado) as DadosDoOrquestrador);

      const linhas = (await lerSeExistir(path.join(this.pastaDo(id), ARQUIVO_DE_EVENTOS))) ?? "";
      const historico: EventoRegistrado[] = [];
      for (const linha of linhas.split("\n")) {
        if (linha.trim() === "") {
          continue;
        }
        try {
          historico.push(JSON.parse(linha) as EventoRegistrado);
        } catch {
          // Última linha cortada por um desligamento no meio da gravação.
        }
      }

      this.orquestradores.set(orquestrador.id, orquestrador);
      this.eventos.set(orquestrador.id, historico);
    } catch (erro) {
      console.error(`[repositorio] Orquestrador "${id}" ignorado: não foi possível ler o histórico.`, erro);
    }
  }
}
