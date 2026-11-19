import { type KeyboardEvent as EventoDeTecladoDoReact, useCallback, useEffect, useId, useRef, useState } from "react";

import { avisoDosPedidosEmAndamento, percentualDoDownload } from "../../shared/atualizacao";
import { useAtualizacao } from "../../shared/hooks/useAtualizacao";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeBarrasDoCanvas } from "../../shared/idioma/textos/canvasBarras";

interface PropsDoAviso {
  /** Pedidos rodando agora (Orquestradores trabalhando e o chat respondendo): reiniciar os cancela. */
  pedidosEmAndamento: number;
}

/** "0.2.1" (sem o "v" que algumas versões trazem). */
function semPrefixo(versao: string): string {
  return versao.trim().replace(/^v/i, "");
}

/**
 * A atualização do app na barra de título (só no desktop). Baixando: um
 * indicador discreto com o percentual. Pronta: a pílula "Atualização pronta"
 * abre um cartão para reiniciar agora ou depois (instala ao fechar o app);
 * com pedidos em andamento, reiniciar pede confirmação. Nas outras situações
 * (e sem a ponte) não desenha nada: o resultado da verificação fica na paleta.
 */
export function AvisoDeAtualizacao({ pedidosEmAndamento }: PropsDoAviso) {
  const t = useTextos(textosDeBarrasDoCanvas);
  const atualizacao = useAtualizacao();
  const { estado, avisoDispensado, erroAoInstalar, instalarAgora, dispensarAviso } = atualizacao;
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const ancora = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const cartao = useRef<HTMLDivElement>(null);
  const idDoCartao = `${useId()}-cartao`;

  const mostrarPronta = estado?.situacao === "pronta" && !avisoDispensado;
  if (aberto && !mostrarPronta) {
    // Ajuste durante o render: saiu de "pronta" (ou foi dispensada), o cartão não reabre sozinho depois.
    setAberto(false);
    setConfirmando(false);
  }
  const cartaoAberto = aberto && mostrarPronta;
  // Se os pedidos terminam com a confirmação na tela, ela some e reiniciar fica direto.
  const pedirConfirmacao = confirmando && pedidosEmAndamento > 0;

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    setConfirmando(false);
    if (devolverFoco) {
      botao.current?.focus();
    }
  }, []);

  // O foco vai para o cartão ao abrir e ao trocar de passo (o botão clicado some).
  useEffect(() => {
    if (cartaoAberto) {
      cartao.current?.focus();
    }
  }, [cartaoAberto, pedirConfirmacao]);

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
    const versao = estado.versaoNova === null ? t.novaVersao : t.versaoNumerada(semPrefixo(estado.versaoNova));
    return (
      <span
        className="aviso-de-atualizacao mono no-drag"
        role="status"
        title={t.baixandoTitulo(versao)}
      >
        {percentual === null ? t.baixando : t.baixandoPercentual(percentual)}
        {percentual !== null && (
          <span className="medidor medidor-curto" aria-hidden="true">
            <span style={{ width: `${percentual}%` }} />
          </span>
        )}
      </span>
    );
  }

  if (!mostrarPronta) {
    return null;
  }

  const versaoNova = estado.versaoNova === null ? null : semPrefixo(estado.versaoNova);
  const rotulo = versaoNova === null ? t.atualizacaoPronta : t.atualizacaoProntaVersao(versaoNova);

  const aoTeclar = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    if (evento.key === "Escape" && cartaoAberto) {
      evento.preventDefault();
      evento.stopPropagation();
      fechar(true);
    }
  };

  const reiniciarAgora = () => {
    if (pedidosEmAndamento > 0) {
      setConfirmando(true);
      return;
    }
    void instalarAgora();
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
        title={t.atualizacaoProntaDica}
        onClick={() => (cartaoAberto ? fechar(false) : setAberto(true))}
      >
        {rotulo}
      </button>
      {cartaoAberto && (
        <div
          ref={cartao}
          id={idDoCartao}
          role="dialog"
          aria-label={t.atualizacaoPronta}
          tabIndex={-1}
          className="cartao-da-atualizacao painel-flutuante no-drag"
        >
          {pedirConfirmacao ? (
            <>
              <p className="texto-do-cartao-da-atualizacao" role="alert">
                {avisoDosPedidosEmAndamento(pedidosEmAndamento)}
              </p>
              <div className="botoes-do-cartao-da-atualizacao">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmando(false)}>
                  {t.voltar}
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => void instalarAgora()}>
                  {t.reiniciarMesmoAssim}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="texto-do-cartao-da-atualizacao">
                {t.foiBaixada(versaoNova === null ? t.novaVersao : t.versaoNumerada(versaoNova))}
              </p>
              <div className="botoes-do-cartao-da-atualizacao">
                <button type="button" className="btn btn-sm btn-ghost" onClick={depois}>
                  {t.depois}
                </button>
                <button type="button" className="btn btn-sm btn-cta" onClick={reiniciarAgora}>
                  {t.reiniciarAgora}
                </button>
              </div>
            </>
          )}
          {erroAoInstalar !== null && (
            <p className="hint-error" role="alert">
              {erroAoInstalar}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
