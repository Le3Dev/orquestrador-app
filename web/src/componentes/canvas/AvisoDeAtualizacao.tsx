import { type KeyboardEvent as EventoDeTecladoDoReact, useCallback, useEffect, useId, useRef, useState } from "react";

import {
  avisoDosOrquestradoresTrabalhando,
  avisoDosPedidosEmAndamento,
  percentualDoDownload,
  resumirMensagem,
  textoDaEspera,
  textoDaEtapa,
} from "../../shared/atualizacao";
import { useAtualizacao } from "../../shared/hooks/useAtualizacao";

interface PropsDoAviso {
  /** Pedidos rodando agora (Orquestradores trabalhando e o chat respondendo): reiniciar os cancela. */
  pedidosEmAndamento: number;
}

/** "0.2.1" (sem o "v" que algumas versões trazem). */
function semPrefixo(versao: string): string {
  return versao.trim().replace(/^v/i, "");
}

interface PropsDoErroCompacto {
  /** A mensagem inteira, que pode ser longa (no Mac, o fim do log). */
  mensagem: string;
  /** Classe do parágrafo do resumo (ex.: "hint-error"). */
  className?: string;
}

/**
 * Uma mensagem de erro sem paredão de texto: a primeira linha (cortada se for
 * longa) e, quando há mais, o texto inteiro recolhido em "Ver detalhes".
 */
export function ErroCompacto({ mensagem, className = "hint-error" }: PropsDoErroCompacto) {
  const { resumo, detalhes } = resumirMensagem(mensagem);
  return (
    <div className="erro-compacto">
      <p className={className} role="alert">
        {resumo}
      </p>
      {detalhes !== null && <DetalhesDoErro texto={detalhes} />}
    </div>
  );
}

/** O texto inteiro de um erro, recolhido; aberto, rola numa caixa baixa. */
export function DetalhesDoErro({ texto }: { texto: string }) {
  return (
    <details className="detalhes-do-erro">
      <summary>Ver detalhes</summary>
      <pre className="custom-scrollbar mono">{texto}</pre>
    </details>
  );
}

/**
 * A atualização do app na barra de título (só no desktop). Baixando: um
 * indicador discreto com o percentual (no Mac, a etapa e uma barra, que fica
 * indeterminada sem percentual). Pronta: a pílula "Atualização pronta" abre um
 * cartão para reiniciar agora ou depois (instala ao fechar o app). Com a ponte
 * nova, quem conta os orquestradores trabalhando é o app: se ele recusar,
 * o cartão oferece esperar ou reiniciar mesmo assim. Na ponte antiga, com
 * pedidos em andamento, a própria tela pede confirmação. Aguardando: o aviso
 * da espera e "Cancelar espera". Nas outras situações (e sem a ponte) não
 * desenha nada: o resultado da verificação fica na paleta.
 */
export function AvisoDeAtualizacao({ pedidosEmAndamento }: PropsDoAviso) {
  const atualizacao = useAtualizacao();
  const { estado, avisoDispensado, erroAoInstalar, suportaEspera, instalarAgora, dispensarAviso } = atualizacao;
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  /** Ponte nova: quantos orquestradores fizeram o app recusar o reinício (null: não recusou). */
  const [trabalhando, setTrabalhando] = useState<number | null>(null);
  const ancora = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const cartao = useRef<HTMLDivElement>(null);
  const idDoCartao = `${useId()}-cartao`;

  const mostrarPronta = estado?.situacao === "pronta" && !avisoDispensado;
  if (aberto && !mostrarPronta) {
    // Ajuste durante o render: saiu de "pronta" (ou foi dispensada), o cartão não reabre sozinho depois.
    setAberto(false);
    setConfirmando(false);
    setTrabalhando(null);
  }
  const cartaoAberto = aberto && mostrarPronta;
  // Se os pedidos terminam com a confirmação na tela, ela some e reiniciar fica direto.
  const pedirConfirmacao = confirmando && pedidosEmAndamento > 0;

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    setConfirmando(false);
    setTrabalhando(null);
    if (devolverFoco) {
      botao.current?.focus();
    }
  }, []);

  // O foco vai para o cartão ao abrir e ao trocar de passo (o botão clicado some).
  useEffect(() => {
    if (cartaoAberto) {
      cartao.current?.focus();
    }
  }, [cartaoAberto, pedirConfirmacao, trabalhando]);

  // Clique fora (no canvas ou na própria barra) fecha.
  useEffect(() => {
    if (!cartaoAberto) {
      return;
    }
    const aoPressionar = (evento: MouseEvent) => {
      if (ancora.current !== null && evento.target instanceof Node && !ancora.current.contains(evento.target)) {
        fechar(false);
      }
    };
    document.addEventListener("mousedown", aoPressionar, true);
    return () => document.removeEventListener("mousedown", aoPressionar, true);
  }, [cartaoAberto, fechar]);

  if (estado === null) {
    return null;
  }

  if (estado.situacao === "baixando") {
    const percentual = percentualDoDownload(estado.progresso);
    const versao = estado.versaoNova === null ? "A nova versão" : `A versão ${semPrefixo(estado.versaoNova)}`;
    const etapa = textoDaEtapa(estado.etapa);
    if (etapa !== null) {
      // Mac: a etapa ("Gerando o app…") e a barra, indeterminada sem percentual.
      return (
        <span className="aviso-de-atualizacao mono no-drag" role="status" title={`${versao} está sendo preparada.`}>
          {percentual === null ? etapa : `${etapa} ${percentual}%`}
          <span
            className={`medidor medidor-curto${percentual === null ? " medidor-indeterminado" : ""}`}
            aria-hidden="true"
          >
            <span style={percentual === null ? undefined : { width: `${percentual}%` }} />
          </span>
        </span>
      );
    }
    return (
      <span
        className="aviso-de-atualizacao mono no-drag"
        role="status"
        title={`${versao} está sendo baixada; ela será instalada quando você fechar o app.`}
      >
        {percentual === null ? "Baixando atualização…" : `Baixando atualização ${percentual}%`}
        {percentual !== null && (
          <span className="medidor medidor-curto" aria-hidden="true">
            <span style={{ width: `${percentual}%` }} />
          </span>
        )}
      </span>
    );
  }

  if (estado.situacao === "aguardando") {
    return (
      <div className="aviso-da-espera no-drag">
        <div className="linha-da-espera">
          <span className="aviso-de-atualizacao" role="status">
            {textoDaEspera(estado.orquestradoresTrabalhando)}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void atualizacao.cancelarEspera()}>
            Cancelar espera
          </button>
        </div>
        {erroAoInstalar !== null && <ErroCompacto mensagem={erroAoInstalar} />}
      </div>
    );
  }

  if (!mostrarPronta) {
    return null;
  }

  const versaoNova = estado.versaoNova === null ? null : semPrefixo(estado.versaoNova);
  const rotulo = versaoNova === null ? "Atualização pronta" : `Atualização pronta (v${versaoNova})`;

  const aoTeclar = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    if (evento.key === "Escape" && cartaoAberto) {
      evento.preventDefault();
      evento.stopPropagation();
      fechar(true);
    }
  };

  const reiniciarAgora = async () => {
    if (!suportaEspera) {
      // Ponte antiga: o app reinicia sem perguntar, então a tela confirma antes.
      if (pedidosEmAndamento > 0) {
        setConfirmando(true);
        return;
      }
      void instalarAgora();
      return;
    }
    const resultado = await instalarAgora();
    if (resultado !== null && !resultado.iniciou && resultado.orquestradoresTrabalhando > 0) {
      setTrabalhando(resultado.orquestradoresTrabalhando);
    }
  };

  const reiniciarQuandoTerminarem = () => {
    setTrabalhando(null);
    void atualizacao.instalarQuandoLivre();
  };

  const depois = () => {
    dispensarAviso();
    fechar(false);
  };

  return (
    <div ref={ancora} className="ancora-da-atualizacao no-drag" onKeyDown={aoTeclar}>
      <button
        ref={botao}
        type="button"
        className="etiqueta etiqueta-success pilula-da-atualizacao"
        aria-haspopup="dialog"
        aria-expanded={cartaoAberto}
        aria-controls={cartaoAberto ? idDoCartao : undefined}
        title="Uma nova versão do app foi baixada"
        onClick={() => (cartaoAberto ? fechar(false) : setAberto(true))}
      >
        {rotulo}
      </button>
      {cartaoAberto && (
        <div
          ref={cartao}
          id={idDoCartao}
          role="dialog"
          aria-label="Atualização pronta"
          tabIndex={-1}
          className="cartao-da-atualizacao painel-flutuante no-drag"
        >
          {trabalhando !== null ? (
            <>
              <p className="texto-do-cartao-da-atualizacao" role="alert">
                {avisoDosOrquestradoresTrabalhando(trabalhando)}
              </p>
              <div className="botoes-do-cartao-da-atualizacao">
                <button type="button" className="btn btn-sm btn-cta" onClick={reiniciarQuandoTerminarem}>
                  Reiniciar quando terminarem
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => void instalarAgora({ forcar: true })}>
                  Reiniciar mesmo assim
                </button>
              </div>
            </>
          ) : pedirConfirmacao ? (
            <>
              <p className="texto-do-cartao-da-atualizacao" role="alert">
                {avisoDosPedidosEmAndamento(pedidosEmAndamento)}
              </p>
              <div className="botoes-do-cartao-da-atualizacao">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmando(false)}>
                  Voltar
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => void instalarAgora()}>
                  Reiniciar mesmo assim
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="texto-do-cartao-da-atualizacao">
                {versaoNova === null ? "A nova versão" : `A versão ${versaoNova}`} foi baixada. Ela será instalada
                quando você fechar o app, ou reinicie agora.
              </p>
              <div className="botoes-do-cartao-da-atualizacao">
                <button type="button" className="btn btn-sm btn-ghost" onClick={depois}>
                  Depois
                </button>
                <button type="button" className="btn btn-sm btn-cta" onClick={() => void reiniciarAgora()}>
                  Reiniciar agora
                </button>
              </div>
            </>
          )}
          {erroAoInstalar !== null && <ErroCompacto mensagem={erroAoInstalar} />}
        </div>
      )}
    </div>
  );
}
