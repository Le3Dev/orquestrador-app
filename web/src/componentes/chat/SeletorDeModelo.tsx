import { type RefObject, useEffect, useId, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { PreferenciasDoChat } from "../../shared/api/tipos";
import { AVISO_DO_ULTRACODE } from "../../shared/formatacao";
import { ESFORCOS_DO_CHAT, MODELOS_DO_CHAT, nomeComVersao, rotuloDoEsforco } from "../../shared/modelos";

interface Props {
  preferencias: PreferenciasDoChat;
  /** Modelo informado pela última resposta (ex.: "claude-opus-5-5"), para mostrar a versão real. */
  modeloUsado: string | null;
  desabilitado: boolean;
  /** O campo do chat: o foco volta para ele ao fechar o menu. */
  campo: RefObject<HTMLTextAreaElement | null>;
  /** As preferências que o servidor gravou. */
  aoAlterar: (preferencias: PreferenciasDoChat) => void;
  aoFalhar: (mensagem: string) => void;
  /** Avisa quando o menu abre ou fecha (o composer não recolhe com ele aberto). */
  aoAlternarMenu?: (aberto: boolean) => void;
}

/**
 * Modelo e esforço do chat, num menu que abre para cima: os modelos com nome,
 * descrição e ✓ no escolhido; abaixo, "Esforço" com um submenu. Escolher grava
 * no servidor, e a escolha vira o padrão das próximas perguntas.
 */
export function SeletorDeModelo({
  preferencias,
  modeloUsado,
  desabilitado,
  campo,
  aoAlterar,
  aoFalhar,
  aoAlternarMenu,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [esforcoAberto, setEsforcoAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const idDoMenu = useId();
  const nomeDoModelo = nomeComVersao(preferencias.modelo, modeloUsado);
  const esforco = rotuloDoEsforco(preferencias.esforco);

  function fechar(): void {
    setAberto(false);
    setEsforcoAberto(false);
    campo.current?.focus();
  }

  useEffect(() => {
    aoAlternarMenu?.(aberto);
  }, [aberto, aoAlternarMenu]);

  // Esc e clique fora fecham. A referência a `fechar` muda a cada render; o
  // efeito só depende de `aberto`, e o campo é um ref estável.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    const fecharMenu = () => {
      setAberto(false);
      setEsforcoAberto(false);
      campo.current?.focus();
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        evento.preventDefault();
        evento.stopPropagation();
        fecharMenu();
      }
    };
    const aoClicar = (evento: MouseEvent) => {
      if (raiz.current !== null && !raiz.current.contains(evento.target as Node | null)) {
        fecharMenu();
      }
    };
    document.addEventListener("keydown", aoTeclar, true);
    document.addEventListener("mousedown", aoClicar);
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      document.removeEventListener("mousedown", aoClicar);
    };
  }, [aberto, campo]);

  async function escolher(alteracao: Partial<PreferenciasDoChat>): Promise<void> {
    fechar();
    if (
      (alteracao.modelo === undefined || alteracao.modelo === preferencias.modelo) &&
      (alteracao.esforco === undefined || alteracao.esforco === preferencias.esforco)
    ) {
      return;
    }
    setSalvando(true);
    try {
      aoAlterar(await api.alterarPreferenciasDoChat(alteracao));
    } catch (falha) {
      aoFalhar(`Não foi possível trocar o modelo: ${mensagemDeErro(falha)}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div ref={raiz} className="seletor-de-modelo">
      <button
        type="button"
        className="botao-do-seletor"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        aria-label={`Modelo: ${nomeDoModelo}, esforço ${esforco.toLowerCase()}`}
        disabled={desabilitado || salvando}
        onClick={() => (aberto ? fechar() : setAberto(true))}
      >
        {/* Como no protótipo: o modelo em cinza, o esforço em destaque e a seta para baixo. */}
        <span>{nomeDoModelo}</span>
        <b>{esforco}</b>
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>

      {aberto && (
        <div id={idDoMenu} role="menu" aria-label="Modelo do chat" className="menu-do-seletor painel-flutuante">
          {MODELOS_DO_CHAT.map((item) => {
            const escolhido = item.modelo === preferencias.modelo;
            return (
              <button
                key={item.modelo}
                type="button"
                role="menuitemradio"
                aria-checked={escolhido}
                className="item-do-menu"
                onClick={() => void escolher({ modelo: item.modelo })}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-titulo text-[12.5px] font-medium text-primary">
                    {item.nome} {item.versao}
                  </span>
                  <span className="text-[11px] text-secondary">{item.descricao}</span>
                </span>
                <span aria-hidden="true" className="marca-do-item">
                  {escolhido ? "✓" : ""}
                </span>
              </button>
            );
          })}
          <hr className="separador-do-menu" />
          <div className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={esforcoAberto}
              className="item-do-menu"
              onClick={() => setEsforcoAberto((atual) => !atual)}
            >
              <span className="font-titulo text-[12.5px] font-medium text-primary">Esforço</span>
              <span className="text-secondary">
                {esforco} <span aria-hidden="true">›</span>
              </span>
            </button>
            {esforcoAberto && (
              <div role="menu" aria-label="Esforço" className="submenu-do-seletor painel-flutuante">
                {ESFORCOS_DO_CHAT.map((item) => {
                  const escolhido = item.esforco === preferencias.esforco;
                  return (
                    <button
                      key={item.esforco}
                      type="button"
                      role="menuitemradio"
                      aria-checked={escolhido}
                      className="item-do-menu"
                      onClick={() => void escolher({ esforco: item.esforco })}
                    >
                      <span className="text-[12.5px] text-primary">{item.rotulo}</span>
                      <span aria-hidden="true" className="marca-do-item">
                        {escolhido ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
                {preferencias.esforco === "ultracode" && (
                  <p className="hint-warning px-2.5 pt-1.5 pb-1 leading-snug">{AVISO_DO_ULTRACODE}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
