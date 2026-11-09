import { useEffect, useSyncExternalStore } from "react";
import { sessaoDaEscuta, type SessaoDaEscuta } from "./sessaoDaEscuta";

/**
 * Em que pé está a escuta do áudio do computador no modo invisível.
 */
export type SituacaoDaEscuta =
  | "indisponivel" // fora do desktop ou fora do Windows
  | "desligada" // modo invisível desligado
  | "aguardando-aviso" // primeira vez: espera o usuário confirmar o aviso
  | "iniciando" // pedindo a captura do áudio
  | "baixando-modelo" // Whisper ainda não está no cache
  | "escutando"
  | "pausada"
  | "erro"; // a captura falhou ou terminou; retomar tenta de novo

/** O que a tela informa à escuta, sempre com os valores mais recentes. */
export interface OpcoesDaEscuta {
  modoInvisivelAtivo: boolean;
  escutaDisponivel: boolean;
  chatLivre: boolean;
  autorizacaoAtiva: boolean;
  enviar: (texto: string) => Promise<void>;
  preencherComposer: (texto: string) => void;
}

/** O que a tela recebe da escuta para desenhar o indicador e o aviso. */
export interface EscutaNaTela {
  situacao: SituacaoDaEscuta;
  progressoDoDownload: number | null; // 0–100 enquanto baixa; null fora disso
  linhas: readonly string[]; // últimas linhas da transcrição (até 6)
  automatico: boolean;
  alternarAutomatico: () => void;
  pausar: () => void;
  retomar: () => void;
  erro: string | null;
  descartarErro: () => void;
  precisaDoAviso: boolean; // situacao === "aguardando-aviso"
  confirmarAviso: () => void;
  recusarAviso: () => void; // não escuta nesta entrada no modo invisível
  ultimaPergunta: string | null; // última pergunta enviada ou posta no composer
}

/**
 * Liga a tela à sessão da escuta. A sessão vive fora do React (singleton do
 * módulo), então remontar o chat rápido não derruba a captura nem a janela de
 * transcrição.
 */
export function useEscuta(
  opcoes: OpcoesDaEscuta,
  sessao: SessaoDaEscuta = sessaoDaEscuta,
): EscutaNaTela {
  const estado = useSyncExternalStore(sessao.assinar, sessao.instantaneo);

  const {
    modoInvisivelAtivo,
    escutaDisponivel,
    chatLivre,
    autorizacaoAtiva,
    enviar,
    preencherComposer,
  } = opcoes;

  // Repassa as opções a cada mudança: a sessão sempre usa as mais recentes.
  useEffect(() => {
    sessao.atualizarOpcoes({
      modoInvisivelAtivo,
      escutaDisponivel,
      chatLivre,
      autorizacaoAtiva,
      enviar,
      preencherComposer,
    });
  }, [
    sessao,
    modoInvisivelAtivo,
    escutaDisponivel,
    chatLivre,
    autorizacaoAtiva,
    enviar,
    preencherComposer,
  ]);

  return {
    situacao: estado.situacao,
    progressoDoDownload: estado.progressoDoDownload,
    linhas: estado.linhas,
    automatico: estado.automatico,
    alternarAutomatico: sessao.alternarAutomatico,
    pausar: sessao.pausar,
    retomar: sessao.retomar,
    erro: estado.erro,
    descartarErro: sessao.descartarErro,
    precisaDoAviso: estado.situacao === "aguardando-aviso",
    confirmarAviso: sessao.confirmarAviso,
    recusarAviso: sessao.recusarAviso,
    ultimaPergunta: estado.ultimaPergunta,
  };
}
