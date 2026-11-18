import { useCallback, useEffect, useState } from "react";

import {
  apiDaAtualizacao,
  type EstadoDaAtualizacao,
  type EstadoDaAtualizacaoNaPonte,
  type ResultadoDoReinicio,
} from "../ponteDoDesktop";

export interface Atualizacao {
  /** null sem a ponte (navegador) ou enquanto o app não respondeu. */
  estado: EstadoDaAtualizacao | null;
  /** O aviso de "pronta" foi dispensado ("Depois") e o estado não mudou desde então. */
  avisoDispensado: boolean;
  /** A falha ao reiniciar para instalar, ao agendar o reinício ou ao cancelar a espera (o app segue aberto). */
  erroAoInstalar: string | null;
  /**
   * A ponte sabe esperar os orquestradores (`instalarQuandoLivre`): quem pergunta
   * antes de reiniciar é o app. Na ponte antiga a tela confirma sozinha.
   */
  suportaEspera: boolean;
  /** Verificação manual (a da paleta); a falha vira o estado "erro". */
  verificar: () => Promise<void>;
  /**
   * Fecha o app, instala e reabre. Devolve a resposta do app (`iniciou` false
   * com orquestradores trabalhando, sem `forcar`), ou null sem a ponte ou se
   * falhou. A ponte antiga não responde: vale como "iniciou".
   */
  instalarAgora: (opcoes?: { forcar?: boolean }) => Promise<ResultadoDoReinicio | null>;
  /** Reinicia sozinho quando os orquestradores terminarem. Sem efeito na ponte antiga. */
  instalarQuandoLivre: () => Promise<void>;
  /** Desiste de esperar os orquestradores (volta para "pronta"). Sem efeito na ponte antiga. */
  cancelarEspera: () => Promise<void>;
  /** Esconde o aviso de "pronta" até o estado mudar de novo. */
  dispensarAviso: () => void;
}

/** A base do estado de erro antes da primeira resposta do app: a versão ainda não é conhecida. */
const ESTADO_DESCONHECIDO: EstadoDaAtualizacao = {
  situacao: "erro",
  versaoAtual: "",
  versaoNova: null,
  progresso: null,
  mensagemDeErro: null,
  etapa: null,
  orquestradoresTrabalhando: null,
};

const REINICIO_SEM_RESPOSTA: ResultadoDoReinicio = { iniciou: true, orquestradoresTrabalhando: 0 };

function motivoDa(falha: unknown): string {
  return falha instanceof Error ? falha.message : String(falha);
}

/** A ponte antiga não manda `etapa` nem `orquestradoresTrabalhando`: ausentes valem null. */
function completar(estado: EstadoDaAtualizacaoNaPonte): EstadoDaAtualizacao {
  return { ...estado, etapa: estado.etapa ?? null, orquestradoresTrabalhando: estado.orquestradoresTrabalhando ?? null };
}

function mesmoEstado(a: EstadoDaAtualizacao, b: EstadoDaAtualizacao): boolean {
  return (
    a.situacao === b.situacao &&
    a.versaoAtual === b.versaoAtual &&
    a.versaoNova === b.versaoNova &&
    a.progresso === b.progresso &&
    a.mensagemDeErro === b.mensagemDeErro &&
    a.etapa === b.etapa &&
    a.orquestradoresTrabalhando === b.orquestradoresTrabalhando
  );
}

/**
 * O mesmo objeto quando nada mudou (não re-renderiza nem desfaz o "dispensar");
 * a cada mudança, uma cópia nova, mesmo que a ponte repita um objeto antigo.
 */
function reaproveitar(anterior: EstadoDaAtualizacao | null, novo: EstadoDaAtualizacaoNaPonte): EstadoDaAtualizacao {
  const completo = completar(novo);
  return anterior !== null && mesmoEstado(anterior, completo) ? anterior : completo;
}

function comErro(anterior: EstadoDaAtualizacao | null, mensagem: string): EstadoDaAtualizacao {
  return {
    ...(anterior ?? ESTADO_DESCONHECIDO),
    situacao: "erro",
    versaoNova: null,
    progresso: null,
    mensagemDeErro: mensagem,
    etapa: null,
    orquestradoresTrabalhando: null,
  };
}

/** A resposta de `instalarAgora`; a ponte antiga não devolve nada (reiniciou). */
function lerResultado(resposta: ResultadoDoReinicio | void): ResultadoDoReinicio {
  if (resposta === undefined || resposta === null || typeof resposta !== "object") {
    return REINICIO_SEM_RESPOSTA;
  }
  const quantidade = Number(resposta.orquestradoresTrabalhando);
  return {
    iniciou: resposta.iniciou !== false,
    orquestradoresTrabalhando: Number.isFinite(quantidade) && quantidade > 0 ? Math.floor(quantidade) : 0,
  };
}

/**
 * A atualização automática do app desktop: lê o estado ao montar, acompanha
 * as mudanças (baixando, pronta, aguardando…) e deixa verificar, reiniciar
 * para instalar e esperar os orquestradores terminarem.
 * Fora do app (sem a ponte), `estado` fica null e nada é chamado.
 */
export function useAtualizacao(): Atualizacao {
  const [api] = useState(apiDaAtualizacao);
  const [estado, setEstado] = useState<EstadoDaAtualizacao | null>(null);
  const [dispensado, setDispensado] = useState<EstadoDaAtualizacao | null>(null);
  const [erroAoInstalar, setErroAoInstalar] = useState<string | null>(null);

  const aplicar = useCallback((novo: EstadoDaAtualizacaoNaPonte) => {
    setEstado((anterior) => reaproveitar(anterior, novo));
  }, []);

  useEffect(() => {
    if (api === null) {
      return;
    }
    let ativo = true;
    // Um aviso que chega antes da resposta de `obter` é mais novo que ela.
    let avisado = false;
    let cancelar: (() => void) | undefined;
    try {
      cancelar = api.aoMudar((novo) => {
        avisado = true;
        if (ativo) {
          aplicar(novo);
        }
      });
    } catch {
      /* sem os avisos, fica a leitura inicial */
    }
    const lerEstado = async () => {
      try {
        const lido = await api.obter();
        if (ativo && !avisado) {
          aplicar(lido);
        }
      } catch (falha) {
        if (ativo && !avisado) {
          setEstado((anterior) => comErro(anterior, motivoDa(falha)));
        }
      }
    };
    void lerEstado();
    return () => {
      ativo = false;
      cancelar?.();
    };
  }, [api, aplicar]);

  const verificar = useCallback(async () => {
    if (api === null) {
      return;
    }
    // Retorno imediato na paleta; o app também avisa pelo `aoMudar`.
    setEstado((anterior) =>
      anterior !== null && (anterior.situacao === "em-dia" || anterior.situacao === "erro")
        ? { ...anterior, situacao: "verificando", mensagemDeErro: null }
        : anterior,
    );
    try {
      aplicar(await api.verificar());
    } catch (falha) {
      // Baixando, pronta ou aguardando, a atualização segue no app: a falha da verificação não a esconde.
      setEstado((anterior) =>
        anterior !== null &&
        (anterior.situacao === "baixando" || anterior.situacao === "pronta" || anterior.situacao === "aguardando")
          ? anterior
          : comErro(anterior, motivoDa(falha)),
      );
    }
  }, [api, aplicar]);

  const instalarAgora = useCallback(
    async (opcoes?: { forcar?: boolean }) => {
      if (api === null) {
        return null;
      }
      setErroAoInstalar(null);
      try {
        return lerResultado(await (opcoes === undefined ? api.instalarAgora() : api.instalarAgora(opcoes)));
      } catch (falha) {
        setErroAoInstalar(`Não foi possível reiniciar para instalar: ${motivoDa(falha)}`);
        return null;
      }
    },
    [api],
  );

  const instalarQuandoLivre = useCallback(async () => {
    if (api?.instalarQuandoLivre === undefined) {
      return;
    }
    setErroAoInstalar(null);
    try {
      await api.instalarQuandoLivre();
    } catch (falha) {
      setErroAoInstalar(`Não foi possível agendar o reinício: ${motivoDa(falha)}`);
    }
  }, [api]);

  const cancelarEspera = useCallback(async () => {
    if (api?.cancelarEspera === undefined) {
      return;
    }
    setErroAoInstalar(null);
    try {
      await api.cancelarEspera();
    } catch (falha) {
      setErroAoInstalar(`Não foi possível cancelar a espera: ${motivoDa(falha)}`);
    }
  }, [api]);

  const dispensarAviso = useCallback(() => setDispensado(estado), [estado]);

  return {
    estado,
    avisoDispensado: estado !== null && estado === dispensado,
    erroAoInstalar,
    suportaEspera: typeof api?.instalarQuandoLivre === "function",
    verificar,
    instalarAgora,
    instalarQuandoLivre,
    cancelarEspera,
    dispensarAviso,
  };
}
