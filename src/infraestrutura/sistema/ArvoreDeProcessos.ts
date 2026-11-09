import path from "node:path";

/**
 * Um processo da máquina com o que é preciso para ligar pai e filho e para
 * reconhecê-lo depois, mesmo que o PID seja reaproveitado.
 */
export interface ProcessoNaArvore {
  pid: number;
  ppid: number;
  /** Instante de criação, em milissegundos desde 1970. */
  criadoEm: number;
  /** Nome do executável (`node.exe`, `bash`...). */
  nome: string;
  /** Linha de comando completa; vazia quando o sistema não a mostra. */
  comando: string;
  /** Grupo de processos (Mac/Linux); nulo no Windows. */
  grupo: number | null;
}

/**
 * Folga ao comparar datas de criação. No Windows a data vem exata; no
 * Mac/Linux é calculada pelo `etime` do `ps` (resolução de 1 s), e duas
 * leituras do mesmo processo podem diferir em até 1 s.
 */
export const FOLGA_DA_DATA_DE_CRIACAO_MS = 2_000;

/** É o mesmo processo (e não um PID reaproveitado): mesmo pid, mesma criação e mesma linha de comando. */
export function mesmoProcesso(
  a: Pick<ProcessoNaArvore, "pid" | "criadoEm" | "comando">,
  b: Pick<ProcessoNaArvore, "pid" | "criadoEm" | "comando">,
): boolean {
  return a.pid === b.pid && Math.abs(a.criadoEm - b.criadoEm) <= FOLGA_DA_DATA_DE_CRIACAO_MS && a.comando === b.comando;
}

/** O filho nasceu depois do pai: sem isso, o ppid pode apontar para um PID já reaproveitado. */
function nasceuDepois(filho: ProcessoNaArvore, pai: Pick<ProcessoNaArvore, "criadoEm">): boolean {
  return filho.criadoEm >= pai.criadoEm - FOLGA_DA_DATA_DE_CRIACAO_MS;
}

function ehRegistroDoWindows(valor: unknown): valor is { p: number; pp: number; c: string; n?: unknown; l?: unknown } {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const { p, pp, c } = valor as Record<string, unknown>;
  return typeof p === "number" && typeof pp === "number" && typeof c === "string";
}

/**
 * Lê o JSON do `Get-CimInstance Win32_Process` montado por `listarArvore`
 * (`p`, `pp`, `c` em ISO 8601, `n`, `l`). Um processo só vem como objeto, não
 * como lista; processos sem data de criação (os do sistema) são ignorados.
 */
export function lerArvoreDoWindows(json: string): ProcessoNaArvore[] {
  let conteudo: unknown;
  try {
    conteudo = JSON.parse(json.trim() === "" ? "[]" : json);
  } catch {
    return [];
  }
  const lista: unknown[] = Array.isArray(conteudo) ? conteudo : [conteudo];
  const processos: ProcessoNaArvore[] = [];
  for (const item of lista) {
    if (!ehRegistroDoWindows(item)) {
      continue;
    }
    const criadoEm = Date.parse(item.c);
    if (!Number.isFinite(criadoEm)) {
      continue;
    }
    processos.push({
      pid: item.p,
      ppid: item.pp,
      criadoEm,
      nome: typeof item.n === "string" ? item.n : "",
      comando: typeof item.l === "string" ? item.l : "",
      grupo: null,
    });
  }
  return processos;
}

/**
 * Lê a saída de `ps -A -o pid=,ppid=,pgid=,etime=,args=`. A criação é
 * `agora - etime`; o nome é o do primeiro trecho da linha de comando.
 */
export function lerArvoreDoPs(texto: string, agoraMs: number): ProcessoNaArvore[] {
  const processos: ProcessoNaArvore[] = [];
  for (const linha of texto.split("\n")) {
    const campos = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(linha);
    if (campos === null) {
      continue;
    }
    const decorrido = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(campos[4] ?? "");
    if (decorrido === null) {
      continue;
    }
    const [dias, horas, minutos, segundos] = [decorrido[1], decorrido[2], decorrido[3], decorrido[4]].map((parte) =>
      Number(parte ?? 0),
    );
    const haMs = ((((dias ?? 0) * 24 + (horas ?? 0)) * 60 + (minutos ?? 0)) * 60 + (segundos ?? 0)) * 1000;
    const comando = (campos[5] ?? "").trim();
    processos.push({
      pid: Number(campos[1]),
      ppid: Number(campos[2]),
      criadoEm: agoraMs - haMs,
      nome: path.basename(comando.split(/\s+/)[0] ?? ""),
      comando,
      grupo: Number(campos[3]),
    });
  }
  return processos;
}

/** Caminho normalizado para comparar com linhas de comando: barras para frente e minúsculas. */
function normalizarCaminho(caminho: string): string {
  return caminho.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Formas da pasta que podem aparecer numa linha de comando: `c:/x/y` e a do
 * Git Bash (`/c/x/y`). Nulo se a pasta for curta demais para reconhecer um
 * processo por ela (a raiz de um disco, `/home`, a pasta do usuário).
 */
export function formasDaPasta(pasta: string, pastaDoUsuario: string): string[] | null {
  const normalizada = normalizarCaminho(pasta);
  const partes = normalizada.split("/").filter((parte) => parte !== "");
  if (partes.length < 3 || normalizada === normalizarCaminho(pastaDoUsuario)) {
    return null;
  }
  const disco = /^([a-z]):(\/.*)$/.exec(normalizada);
  return disco === null ? [normalizada] : [normalizada, `/${disco[1]}${disco[2]}`];
}

export interface BuscaDeDescendentes {
  /** O processo do Claude Code do turno (vivo ou não). */
  raiz: ProcessoNaArvore;
  /** A listagem atual da máquina. */
  arvore: readonly ProcessoNaArvore[];
  /** Descendentes vistos em listagens anteriores (podem já ter morrido): pais possíveis. */
  vistos: readonly ProcessoNaArvore[];
  /** Pids que nunca entram (o servidor, o Electron, os Claude Code de todos os turnos). */
  protegidos: ReadonlySet<number>;
  /**
   * Para adotar processos cujo pai já morreu sem ter sido visto: só os
   * nascidos durante o turno (`ate`) cuja árvore cita a pasta do turno. Nulo
   * desliga a adoção.
   */
  adocao: { formasDaPasta: readonly string[]; ate: number } | null;
  /** Processos conhecidos que não são do turno (shells dos terminais do canvas): os filhos deles não são adotados. */
  alheios?: readonly ProcessoNaArvore[];
}

/**
 * Os descendentes vivos da raiz na listagem atual. Liga pai e filho pelo
 * ppid, sempre conferindo que o filho nasceu depois do pai (o Windows
 * reaproveita PIDs e não atualiza o ppid de quem perdeu o pai):
 * - pelo pai vivo, se ele for a raiz ou um descendente;
 * - pelo pai já morto, se ele foi visto numa listagem anterior;
 * - no Mac/Linux, também pelo grupo de processos da raiz;
 * - por adoção (ver `adocao`), quando o pai morreu sem ser visto.
 */
export function descendentesVivos(busca: BuscaDeDescendentes): ProcessoNaArvore[] {
  const { raiz, arvore, protegidos } = busca;
  const vivosPorPid = new Map(arvore.map((processo) => [processo.pid, processo]));
  const conhecidos = new Map<number, ProcessoNaArvore>([[raiz.pid, raiz]]);
  for (const visto of busca.vistos) {
    if (!conhecidos.has(visto.pid)) {
      conhecidos.set(visto.pid, visto);
    }
  }
  const alheios = new Map((busca.alheios ?? []).map((processo) => [processo.pid, processo]));
  const achados = new Map<number, ProcessoNaArvore>();
  const podeEntrar = (processo: ProcessoNaArvore): boolean =>
    !achados.has(processo.pid) && !protegidos.has(processo.pid) && processo.pid !== raiz.pid;

  const ehNosso = (processo: ProcessoNaArvore): boolean => {
    if (raiz.grupo !== null && processo.grupo === raiz.pid && nasceuDepois(processo, raiz)) {
      return true;
    }
    const pai = conhecidos.get(processo.ppid);
    if (pai === undefined || !nasceuDepois(processo, pai)) {
      return false;
    }
    // O pid do pai foi reaproveitado por um processo que já existia quando
    // este nasceu: o pai de verdade é esse outro.
    const paiVivo = vivosPorPid.get(processo.ppid);
    return paiVivo === undefined || mesmoProcesso(paiVivo, pai) || !nasceuDepois(processo, paiVivo);
  };

  const expandir = (): void => {
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const processo of arvore) {
        if (podeEntrar(processo) && ehNosso(processo)) {
          achados.set(processo.pid, processo);
          conhecidos.set(processo.pid, processo);
          mudou = true;
        }
      }
    }
  };
  expandir();

  if (busca.adocao !== null) {
    const { formasDaPasta: formas, ate } = busca.adocao;
    const citaAPasta = (processo: ProcessoNaArvore): boolean => {
      const comando = normalizarCaminho(processo.comando);
      return formas.some((forma) => comando.includes(forma));
    };
    const subarvore = (topo: ProcessoNaArvore): ProcessoNaArvore[] => {
      const membros = [topo];
      for (let i = 0; i < membros.length; i++) {
        const pai = membros[i] as ProcessoNaArvore;
        for (const filho of arvore) {
          if (filho.ppid === pai.pid && filho !== pai && nasceuDepois(filho, pai) && !membros.includes(filho)) {
            membros.push(filho);
          }
        }
      }
      return membros;
    };
    for (const processo of arvore) {
      if (!podeEntrar(processo) || processo.criadoEm < raiz.criadoEm - FOLGA_DA_DATA_DE_CRIACAO_MS || processo.criadoEm > ate) {
        continue;
      }
      const paiVivo = vivosPorPid.get(processo.ppid);
      const paiMorreu = paiVivo === undefined || !nasceuDepois(processo, paiVivo);
      const paiAlheio = alheios.get(processo.ppid);
      if (!paiMorreu || (paiAlheio !== undefined && nasceuDepois(processo, paiAlheio))) {
        continue;
      }
      const membros = subarvore(processo).filter((membro) => !protegidos.has(membro.pid));
      if (membros.some(citaAPasta)) {
        for (const membro of membros) {
          achados.set(membro.pid, membro);
          conhecidos.set(membro.pid, membro);
        }
      }
    }
    expandir();
  }

  return [...achados.values()];
}
