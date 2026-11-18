import { extrairEnderecosLocais } from "../../orquestracao/EnderecoLocal";
import { EventoDoMotor, OrigemDoEnderecoLocal } from "../../orquestracao/EventoDeOrquestracao";
import { semBlocosDePrevia } from "../../previas/PreviaDoApp";
import { SondaDeEndereco } from "../claudecode/SondaDeEnderecoLocal";

/**
 * Procura endereços locais (`http://localhost:5173`) no que os agentes dizem e
 * no que os comandos imprimem, para a tela oferecer a prévia ao vivo — o mesmo
 * que o adaptador do Claude Code faz. Uma instância por turno.
 *
 * Um endereço só vira anúncio depois que o motor confere que há um servidor nele
 * (`retirarCandidatos` e `confirmar`). A origem é "resposta" quando a resposta
 * final do Orquestrador o cita (o agente quer que o usuário veja a página) e
 * "ferramenta" quando veio da saída de um comando.
 */
export class DetectorDeEnderecosLocais {
  private readonly anunciados = new Map<string, OrigemDoEnderecoLocal>();
  private readonly origemDaCitacao = new Map<string, OrigemDoEnderecoLocal>();
  private readonly candidatos = new Set<string>();

  /** Registra os endereços locais de um texto. O bloco ```previa-do-app só lista prévias a fechar: não conta. */
  citar(texto: string, origem: OrigemDoEnderecoLocal = "ferramenta"): void {
    for (const url of extrairEnderecosLocais(semBlocosDePrevia(texto))) {
      this.candidatos.add(url);
      if (origem === "resposta" || !this.origemDaCitacao.has(url)) {
        this.origemDaCitacao.set(url, origem);
      }
    }
  }

  /**
   * Os endereços citados desde a última retirada que ainda não foram anunciados.
   * Um já anunciado como "ferramenta" volta quando a resposta final o cita.
   */
  retirarCandidatos(): string[] {
    const novos = [...this.candidatos].filter((url) => {
      const anunciado = this.anunciados.get(url);
      return anunciado === undefined || (anunciado === "ferramenta" && this.origemDaCitacao.get(url) === "resposta");
    });
    this.candidatos.clear();
    return novos;
  }

  /** Um endereço que respondeu: vira o anúncio, uma vez por turno e por origem. */
  confirmar(url: string): EventoDoMotor[] {
    const origem = this.origemDaCitacao.get(url) ?? "ferramenta";
    const anunciado = this.anunciados.get(url);
    if (anunciado === "resposta" || anunciado === origem) {
      return [];
    }
    this.anunciados.set(url, origem);
    return [{ tipo: "endereco_local_detectado", url, origem }];
  }
}

/**
 * Confere em segundo plano os endereços que o detector vai achando e anuncia os
 * que respondem; o turno espera as conferências no fim (`aguardar`) para o
 * anúncio não chegar depois do fim do turno.
 */
export class ConferenciaDeEnderecos {
  private readonly conferencias: Promise<void>[] = [];
  private readonly emConferencia = new Set<string>();

  constructor(
    private readonly detector: DetectorDeEnderecosLocais,
    private readonly sondar: SondaDeEndereco,
    private readonly aoObservar: (evento: EventoDoMotor) => void,
    private readonly sinal: AbortSignal,
  ) {}

  /** Chamar depois de cada coisa que pode ter citado um endereço. */
  conferirCitados(): void {
    for (const url of this.detector.retirarCandidatos()) {
      if (this.emConferencia.has(url)) {
        continue;
      }
      this.emConferencia.add(url);
      this.conferencias.push(
        this.sondar(url)
          .then(
            (noAr) => {
              if (noAr && !this.sinal.aborted) {
                for (const evento of this.detector.confirmar(url)) {
                  this.aoObservar(evento);
                }
              }
            },
            () => undefined,
          )
          .finally(() => this.emConferencia.delete(url)),
      );
    }
  }

  async aguardar(): Promise<void> {
    await Promise.all(this.conferencias);
  }
}
