import { ServicoDeRotinas } from "../../rotinas/ServicoDeRotinas";
import { Temporizador } from "../../rotinas/Temporizador";

/** De quanto em quanto tempo o agendador olha se alguma Rotina venceu. */
export const INTERVALO_DE_VERIFICACAO_EM_MS = 30_000;

export interface DependenciasDoAgendador {
  servico: ServicoDeRotinas;
  temporizador: Temporizador;
  /** Padrão: 30 segundos. */
  intervaloEmMs?: number | undefined;
}

/**
 * O laço que dispara as Rotinas na hora. Só cuida do ritmo: as regras (qual
 * Rotina venceu, pular ou executar, perdidas, interrompidas) são do
 * `ServicoDeRotinas`.
 *
 * `iniciar` recupera o que o fechamento anterior deixou e passa a verificar a
 * cada ~30 s; as verificações nunca se sobrepõem. `encerrar` para o laço e
 * aborta as execuções em andamento.
 */
export class Agendador {
  private readonly intervaloEmMs: number;
  private cancelarProximaVerificacao: (() => void) | null = null;
  private verificacaoEmCurso: Promise<void> = Promise.resolve();
  private rodando = false;

  constructor(private readonly dependencias: DependenciasDoAgendador) {
    this.intervaloEmMs = dependencias.intervaloEmMs ?? INTERVALO_DE_VERIFICACAO_EM_MS;
  }

  async iniciar(): Promise<void> {
    if (this.rodando) {
      return;
    }
    this.rodando = true;
    try {
      await this.dependencias.servico.recuperarAoIniciar();
    } catch (erro) {
      // Uma falha na recuperação não pode impedir o agendador de funcionar.
      console.error("[rotinas] Falha ao recuperar as rotinas ao abrir o app:", erro);
    }
    if (this.rodando) {
      this.agendarVerificacao();
    }
  }

  /** Uma verificação agora: dispara o que venceu. Falha de uma não impede as seguintes. */
  async verificar(): Promise<void> {
    try {
      await this.dependencias.servico.dispararVencidas();
    } catch (erro) {
      console.error("[rotinas] Falha ao verificar as rotinas vencidas:", erro);
    }
  }

  async encerrar(): Promise<void> {
    this.rodando = false;
    this.cancelarProximaVerificacao?.();
    this.cancelarProximaVerificacao = null;
    await this.verificacaoEmCurso;
    try {
      await this.dependencias.servico.interromperEmAndamento();
    } catch (erro) {
      console.error("[rotinas] Falha ao encerrar as execuções em andamento:", erro);
    }
  }

  /** Só marca a próxima verificação depois de a anterior terminar: o ritmo é fixo e sem sobreposição. */
  private agendarVerificacao(): void {
    this.cancelarProximaVerificacao = this.dependencias.temporizador.agendar(() => {
      this.cancelarProximaVerificacao = null;
      this.verificacaoEmCurso = this.verificar().then(() => {
        if (this.rodando) {
          this.agendarVerificacao();
        }
      });
    }, this.intervaloEmMs);
  }
}
