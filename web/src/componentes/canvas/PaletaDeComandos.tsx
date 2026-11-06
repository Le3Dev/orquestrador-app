import {
  type KeyboardEvent as EventoDeTecladoDoReact,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  agruparPorTipo,
  buscarNaPaleta,
  type FonteDaPaleta,
  type ItemDaPaleta,
  montarItensDaPaleta,
} from "../../shared/paletaDeComandos";

/** O que o canvas pode pedir à paleta (o "Buscar ou executar…" da barra de título; no navegador, o "Buscar"). */
export interface ControleDaPaleta {
  abrir: () => void;
}

interface PropsDaPaleta {
  /** Lê do canvas o que listar, só na hora de abrir: a paleta fechada não acompanha os eventos. */
  lerFonte: () => FonteDaPaleta;
  /** Executa o item escolhido; a paleta já fechou. */
  aoExecutar: (item: ItemDaPaleta) => void;
  controle?: RefObject<ControleDaPaleta | null>;
}

/** Ctrl+K, inclusive com o foco num campo de texto. */
function ehAtalhoDaPaleta(evento: KeyboardEvent): boolean {
  return (
    evento.ctrlKey &&
    !evento.altKey &&
    !evento.shiftKey &&
    !evento.metaKey &&
    (evento.code === "KeyK" || evento.key === "k" || evento.key === "K")
  );
}

/**
 * Paleta de comandos (Ctrl+K): busca ações do canvas, Orquestradores, notas,
 * artefatos e pedidos, e executa o escolhido. Caixa no topo da área do canvas, fora do
 * viewport do React Flow (não escala com o zoom).
 *
 * Todo o estado é daqui: abrir, digitar e navegar não re-renderizam o canvas.
 * Fechada, não renderiza nada; as props do canvas são estáveis (`memo`).
 */
function Paleta({ lerFonte, aoExecutar, controle }: PropsDaPaleta) {
  const [aberta, setAberta] = useState(false);
  const [itens, setItens] = useState<readonly ItemDaPaleta[]>([]);
  const [consulta, setConsulta] = useState("");
  const [selecionado, setSelecionado] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);
  const idBase = useId();
  const idDaLista = `${idBase}-lista`;

  const abrir = useCallback(() => {
    // Já aberta: nada a fazer (e o foco anterior continua o de antes de abrir).
    if (caixa.current !== null) {
      return;
    }
    focoAnterior.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setItens(montarItensDaPaleta(lerFonte()));
    setConsulta("");
    setSelecionado(0);
    setAberta(true);
  }, [lerFonte]);

  /** Fecha; ao desistir (Esc, clique fora, Ctrl+K), o foco volta para onde estava. */
  const fechar = useCallback((devolverFoco: boolean) => {
    setAberta(false);
    setItens([]);
    const anterior = focoAnterior.current;
    focoAnterior.current = null;
    if (devolverFoco && anterior !== null && anterior.isConnected) {
      // Sem rolar: o elemento pode estar dentro do canvas (ex.: o prompt de um terminal).
      anterior.focus({ preventScroll: true });
    }
  }, []);

  useImperativeHandle(controle, () => ({ abrir }), [abrir]);

  // Ctrl+K abre de qualquer lugar e, com a paleta aberta, fecha. Na captura,
  // para nenhum campo engolir o atalho antes.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (!ehAtalhoDaPaleta(evento) || evento.repeat) {
        return;
      }
      evento.preventDefault();
      if (caixa.current !== null) {
        fechar(true);
      } else {
        abrir();
      }
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [abrir, fechar]);

  // Clique fora da caixa fecha (inclusive fora da área do canvas, como na barra de título).
  useEffect(() => {
    if (!aberta) {
      return;
    }
    const aoPressionar = (evento: MouseEvent) => {
      if (caixa.current !== null && evento.target instanceof Node && !caixa.current.contains(evento.target)) {
        fechar(true);
      }
    };
    document.addEventListener("mousedown", aoPressionar, true);
    return () => document.removeEventListener("mousedown", aoPressionar, true);
  }, [aberta, fechar]);

  const resultados = useMemo(() => buscarNaPaleta(itens, consulta), [itens, consulta]);
  const grupos = useMemo(() => agruparPorTipo(resultados), [resultados]);
  // A ordem da navegação é a da lista na tela: grupo a grupo.
  const ordem = useMemo(() => grupos.flatMap((grupo) => grupo.itens), [grupos]);
  const posicoes = useMemo(() => new Map(ordem.map((item, indice) => [item.id, indice])), [ordem]);
  const indiceAtual = ordem.length === 0 ? -1 : Math.min(selecionado, ordem.length - 1);
  const idDaOpcao = (indice: number) => `${idBase}-opcao-${indice}`;
  const idSelecionado = indiceAtual === -1 ? undefined : idDaOpcao(indiceAtual);

  // O item escolhido pelo teclado fica sempre à vista na lista.
  useEffect(() => {
    if (idSelecionado !== undefined) {
      document.getElementById(idSelecionado)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [idSelecionado]);

  const executar = (item: ItemDaPaleta) => {
    fechar(false);
    aoExecutar(item);
  };

  const aoTeclarNoCampo = (evento: EventoDeTecladoDoReact<HTMLInputElement>) => {
    if (evento.nativeEvent.isComposing) {
      return;
    }
    switch (evento.key) {
      case "ArrowDown":
        evento.preventDefault();
        if (ordem.length > 0) {
          setSelecionado((indiceAtual + 1) % ordem.length);
        }
        break;
      case "ArrowUp":
        evento.preventDefault();
        if (ordem.length > 0) {
          setSelecionado((indiceAtual - 1 + ordem.length) % ordem.length);
        }
        break;
      case "Enter": {
        evento.preventDefault();
        const item = ordem[indiceAtual];
        if (item !== undefined) {
          executar(item);
        }
        break;
      }
      case "Escape":
        evento.preventDefault();
        evento.stopPropagation();
        fechar(true);
        break;
      case "Tab":
        // Diálogo modal: o foco fica no campo.
        evento.preventDefault();
        break;
    }
  };

  if (!aberta) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-screen-bg/40 px-4 pt-14" data-testid="fundo-da-paleta">
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        className="painel-flutuante flex w-full max-w-[560px] flex-col overflow-hidden"
      >
        <div className="border-b border-border p-2.5">
          <input
            className="input"
            type="text"
            role="combobox"
            aria-label="Buscar ações, orquestradores, notas, artefatos e pedidos"
            aria-expanded="true"
            aria-controls={idDaLista}
            aria-autocomplete="list"
            aria-activedescendant={idSelecionado}
            placeholder="Buscar ações, orquestradores, notas, artefatos e pedidos…"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={consulta}
            onChange={(evento) => {
              setConsulta(evento.target.value);
              setSelecionado(0);
            }}
            onKeyDown={aoTeclarNoCampo}
          />
        </div>
        <div id={idDaLista} role="listbox" aria-label="Resultados" className="custom-scrollbar max-h-[55vh] overflow-y-auto p-1.5">
          {grupos.map((grupo) => {
            const idDoRotulo = `${idBase}-grupo-${grupo.tipo}`;
            return (
              <div key={grupo.tipo} role="group" aria-labelledby={idDoRotulo}>
                <div id={idDoRotulo} role="presentation" className="rotulo-tecnico px-2.5 pt-2 pb-1">
                  {grupo.rotulo}
                </div>
                {grupo.itens.map((item) => {
                  const indice = posicoes.get(item.id) ?? -1;
                  const escolhido = indice === indiceAtual;
                  return (
                    <div
                      key={item.id}
                      id={idDaOpcao(indice)}
                      role="option"
                      aria-selected={escolhido}
                      className={`item-do-menu ${escolhido ? "bg-surface-3" : ""}`}
                      onMouseMove={() => setSelecionado(indice)}
                      // O foco fica no campo de busca.
                      onMouseDown={(evento) => evento.preventDefault()}
                      onClick={() => executar(item)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {item.tipo === "orquestrador" && (
                          <span
                            aria-hidden="true"
                            className={`ponto-de-status ${item.trabalhando ? "ponto-de-status-ativo" : ""}`}
                          />
                        )}
                        {item.tipo === "artefato" && (
                          <span aria-hidden="true" className={`icone-do-artefato icone-do-artefato-${item.formato}`}>
                            {item.formato === "html" ? "</>" : "M↓"}
                          </span>
                        )}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-titulo text-[12.5px] font-medium text-primary">{item.titulo}</span>
                          {item.detalhe !== "" && <span className="truncate text-[11px] text-secondary">{item.detalhe}</span>}
                        </span>
                      </span>
                      {item.tipo === "acao" && item.atalho !== null && (
                        <kbd className="mono shrink-0 text-muted">{item.atalho}</kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {ordem.length === 0 && (
          <p className="text-support px-4 pb-3" role="status">
            Nada encontrado.
          </p>
        )}
        <div className="mono flex gap-3 border-t border-border px-3 py-1.5 text-muted" aria-hidden="true">
          <span>↑↓ navegar</span>
          <span>enter abrir</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>
  );
}

/** Memorizada: com as props estáveis do canvas, nunca re-renderiza por causa dele. */
export const PaletaDeComandos = memo(Paleta);
