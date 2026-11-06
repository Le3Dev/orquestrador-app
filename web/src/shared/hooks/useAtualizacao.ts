import { useCallback, useEffect, useState } from "react";

import { apiDaAtualizacao, type EstadoDaAtualizacao } from "../ponteDoDesktop";

export interface Atualizacao {
  /** null sem a ponte (navegador) ou enquanto o app não respondeu. */
  estado: EstadoDaAtualizacao | null;
  /** O aviso de "pronta" foi dispensado ("Depois") e o estado não mudou desde então. */
  avisoDispensado: boolean;
  /** A falha ao reiniciar para instalar (o app segue aberto, com a atualização pronta). */
  erroAoInstalar: string | null;
  /** Verificação manual (a da paleta); a falha vira o estado "erro". */
  verificar: () => Promise<void>;
  /** Fecha o app, instala e reabre. */
  instalarAgora: () => Promise<void>;
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
};

function motivoDa(falha: unknown): string {
  return falha instanceof Error ? falha.message : String(falha);
}

function mesmoEstado(a: EstadoDaAtualizacao, b: EstadoDaAtualizacao): boolean {
  return (
    a.situacao === b.situacao &&
    a.versaoAtual === b.versaoAtual &&
    a.versaoNova === b.versaoNova &&
    a.progresso === b.progresso &&
    a.mensagemDeErro === b.mensagemDeErro
  );
}

/**
 * O mesmo objeto quando nada mudou (não re-renderiza nem desfaz o "dispensar");
 * a cada mudança, uma cópia nova, mesmo que a ponte repita um objeto antigo.
 */
function reaproveitar(anterior: EstadoDaAtualizacao | null, novo: EstadoDaAtualizacao): EstadoDaAtualizacao {
  return anterior !== null && mesmoEstado(anterior, novo) ? anterior : { ...novo };
}

function comErro(anterior: EstadoDaAtualizacao | null, mensagem: string): EstadoDaAtualizacao {
  return { ...(anterior ?? ESTADO_DESCONHECIDO), situacao: "erro", versaoNova: null, progresso: null, mensagemDeErro: mensagem };
}

/**
 * A atualização automática do app desktop: lê o estado ao montar, acompanha
 * as mudanças (baixando, pronta…) e deixa verificar e reiniciar para instalar.
 * Fora do app (sem a ponte), `estado` fica null e nada é chamado.
 */
export function useAtualizacao(): Atualizacao {
  const [api] = useState(apiDaAtualizacao);
  const [estado, setEstado] = useState<EstadoDaAtualizacao | null>(null);
  const [dispensado, setDispensado] = useState<EstadoDaAtualizacao | null>(null);
  const [erroAoInstalar, setErroAoInstalar] = useState<string | null>(null);

  const aplicar = useCallback((novo: EstadoDaAtualizacao) => {
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
      // Baixando ou pronta, a atualização segue no app: a falha da verificação não a esconde.
      setEstado((anterior) =>
        anterior !== null && (anterior.situacao === "baixando" || anterior.situacao === "pronta")
          ? anterior
          : comErro(anterior, motivoDa(falha)),
      );
    }
  }, [api, aplicar]);

  const instalarAgora = useCallback(async () => {
    if (api === null) {
      return;
    }
    setErroAoInstalar(null);
    try {
      await api.instalarAgora();
    } catch (falha) {
      setErroAoInstalar(`Não foi possível reiniciar para instalar: ${motivoDa(falha)}`);
    }
  }, [api]);

  const dispensarAviso = useCallback(() => setDispensado(estado), [estado]);

  return {
    estado,
    avisoDispensado: estado !== null && estado === dispensado,
    erroAoInstalar,
    verificar,
    instalarAgora,
    dispensarAviso,
  };
}
