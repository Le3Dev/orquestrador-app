import {
  type KeyboardEvent as EventoDeTecladoDoReact,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DadosDoSubagentePronto, ResumoDoOrquestrador } from "../../shared/api/tipos";
import { IconeEngrenagem, IconeModelo, IconeNavegador, IconeOrquestrador, IconePessoas, IconeShell } from "../Icones";
import {
  IconeLista,
  IconeLupa,
  IconeMais,
  IconeParado,
  IconeSetaDireita,
  IconeTrabalhando,
} from "./IconesDasIlhas";
import "../../theme/ilhas.css";

/** O submenu aberto ao lado do menu: a lista de orquestradores ou a de subagentes prontos. */
type IdDoSubmenu = "orquestradores" | "subagentes";

interface ItemDeAcao {
  tipo: "acao";
  id: string;
  rotulo: string;
  icone: ReactNode;
  /** Como aparece à direita (mono, apagado); vazio, nada aparece. */
  atalho?: string;
  /** O mesmo atalho no formato do `aria-keyshortcuts`. */
  teclas?: string;
  dica: string;
  executar: () => void;
}

interface ItemDeSubmenu {
  tipo: "submenu";
  id: IdDoSubmenu;
  rotulo: string;
  icone: ReactNode;
  /** Quantos itens a lista tem; nulo enquanto não se sabe. */
  contagem: number | null;
  dica: string;
}

type ItemDoMenu = ItemDeAcao | ItemDeSubmenu;

export interface PropsDoMenuNovo {
  aoCriar: () => void;
  aoCriarNota: () => void;
  aoCriarPrevia: () => void;
  /** Sem ela, o item "Terminal" não aparece. */
  aoCriarShell?: () => void;
  /** Abre o painel de modelos de canvas. */
  aoAbrirModelos: () => void;
  /** Abre a paleta de comandos (o mesmo do Ctrl+K). */
  aoBuscar: () => void;
  aoAbrirConfiguracoes: () => void;
  /** Nulo enquanto a lista não chegou. */
  orquestradores: readonly ResumoDoOrquestrador[] | null;
  erroDosOrquestradores: string | null;
  /** Os orquestradores que já têm janela no canvas. */
  noCanvas: ReadonlySet<string>;
  /** Foca a janela do orquestrador; se ela não está no canvas, abre. */
  aoEscolherOrquestrador: (id: string) => void;
  /** Nulo enquanto a lista não chegou. */
  subagentes: readonly DadosDoSubagentePronto[] | null;
  /** "Novo subagente", "Gerenciar subagentes" e um subagente da lista: todos abrem o painel de subagentes prontos. */
  aoAbrirSubagentes: () => void;
}

/** O texto de um orquestrador para o leitor de tela. */
function descreverOrquestrador(orquestrador: ResumoDoOrquestrador, noCanvas: boolean): string {
  const situacao = orquestrador.situacao === "trabalhando" ? "trabalhando" : "parado";
  return `${orquestrador.nome}, ${situacao}, pasta ${orquestrador.nomeDaPasta}, ${noCanvas ? "aberto no canvas" : "fechado, abre ao escolher"}`;
}

function plural(total: number, singular: string, pluralDoTermo: string): string {
  return `${total} ${total === 1 ? singular : pluralDoTermo}`;
}

/**
 * O botão `+ Novo` da ilha do canto superior esquerdo e o menu dele, no estilo
 * do menu do Excalidraw: cai para baixo, com ícone, rótulo e atalho à direita
 * e divisores entre os grupos. Grupo 1: o que criar. Grupo 2: "Orquestradores ›"
 * e "Subagentes ›", que abrem um segundo painel à direita (ao passar o mouse,
 * clicar ou com →). Grupo 3: modelos de canvas, busca e configurações.
 *
 * Teclado: ↓ ou Enter no botão abrem; ↑/↓ (e Home/End) navegam; → entra no
 * submenu e ← (ou Esc) volta dele; Enter ativa; Esc, Tab e clique fora fecham.
 */
export function MenuNovo({
  aoCriar,
  aoCriarNota,
  aoCriarPrevia,
  aoCriarShell,
  aoAbrirModelos,
  aoBuscar,
  aoAbrirConfiguracoes,
  orquestradores,
  erroDosOrquestradores,
  noCanvas,
  aoEscolherOrquestrador,
  subagentes,
  aoAbrirSubagentes,
}: PropsDoMenuNovo) {
  const [aberto, setAberto] = useState(false);
  const [submenu, setSubmenu] = useState<IdDoSubmenu | null>(null);
  const ancora = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const itensPrincipais = useRef<(HTMLButtonElement | null)[]>([]);
  const itensDoSubmenu = useRef<(HTMLButtonElement | null)[]>([]);
  // Onde o foco cai no próximo render: o item de índice dado do menu, ou o primeiro do submenu.
  const focoPendente = useRef<{ onde: "menu"; indice: number } | { onde: "submenu" } | null>(null);
  const idBase = useId();
  const idDoMenu = `${idBase}-menu`;
  const idDoSubmenu = (id: IdDoSubmenu) => `${idBase}-${id}`;

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    setSubmenu(null);
    if (devolverFoco) {
      botao.current?.focus();
    }
  }, []);

  const grupos = useMemo<ItemDoMenu[][]>(() => {
    const criar: ItemDoMenu[] = [
      {
        tipo: "acao",
        id: "orquestrador",
        rotulo: "Novo orquestrador",
        icone: <IconeOrquestrador tamanho={18} />,
        atalho: "Ctrl+N",
        teclas: "Control+N",
        dica: "Abre o formulário de um terminal novo",
        executar: aoCriar,
      },
      {
        tipo: "acao",
        id: "nota",
        rotulo: "Nota",
        icone: <span className="glifo-do-menu">✎</span>,
        atalho: "Ctrl+Shift+N",
        teclas: "Control+Shift+N",
        dica: "Cria uma nota no centro da tela (bloco de notas, salvo automaticamente)",
        executar: aoCriarNota,
      },
      ...(aoCriarShell === undefined
        ? []
        : [
            {
              tipo: "acao" as const,
              id: "terminal",
              rotulo: "Terminal",
              icone: <IconeShell tamanho={18} />,
              dica: "Abre um terminal de verdade (o shell do computador) numa pasta escolhida",
              executar: aoCriarShell,
            },
          ]),
      {
        tipo: "acao",
        id: "previa",
        rotulo: "Prévia",
        icone: <IconeNavegador tamanho={18} />,
        dica: "Abre uma prévia ao vivo: um navegador no canvas para ver o site que os agentes estão fazendo",
        executar: aoCriarPrevia,
      },
    ];
    const listas: ItemDoMenu[] = [
      {
        tipo: "submenu",
        id: "orquestradores",
        rotulo: "Orquestradores",
        icone: <IconeLista tamanho={18} />,
        contagem: orquestradores?.length ?? null,
        dica: "Os orquestradores: escolher um leva até a janela dele",
      },
      {
        tipo: "submenu",
        id: "subagentes",
        rotulo: "Subagentes",
        icone: <IconePessoas tamanho={18} />,
        contagem: subagentes?.length ?? null,
        dica: "Ajudantes prontos que todo orquestrador pode chamar",
      },
    ];
    const outros: ItemDoMenu[] = [
      {
        tipo: "acao",
        id: "modelos",
        rotulo: "Modelos de canvas",
        icone: <IconeModelo tamanho={18} />,
        dica: "Modelos de canvas: arranjos salvos para recriar, exportar e importar",
        executar: aoAbrirModelos,
      },
      {
        tipo: "acao",
        id: "buscar",
        rotulo: "Buscar",
        icone: <IconeLupa tamanho={18} />,
        atalho: "Ctrl+K",
        teclas: "Control+K",
        dica: "Paleta de comandos: ações, orquestradores, notas e pedidos",
        executar: aoBuscar,
      },
      {
        tipo: "acao",
        id: "configuracoes",
        rotulo: "Configurações",
        icone: <IconeEngrenagem tamanho={18} />,
        dica: "Padrões, sistema, conta, atualização e aparência",
        executar: aoAbrirConfiguracoes,
      },
    ];
    return [criar, listas, outros];
  }, [
    aoCriar,
    aoCriarNota,
    aoCriarShell,
    aoCriarPrevia,
    aoAbrirModelos,
    aoBuscar,
    aoAbrirConfiguracoes,
    orquestradores,
    subagentes,
  ]);
  const itens = useMemo(() => grupos.flat(), [grupos]);

  const abrir = (indice: number) => {
    if (aberto) {
      itensPrincipais.current[indice]?.focus();
      return;
    }
    focoPendente.current = { onde: "menu", indice };
    setAberto(true);
  };

  // O foco vai para onde o teclado pediu, depois de o menu ou o submenu aparecerem.
  useEffect(() => {
    const pendente = focoPendente.current;
    if (pendente === null || !aberto) {
      return;
    }
    if (pendente.onde === "menu") {
      itensPrincipais.current[pendente.indice]?.focus();
      focoPendente.current = null;
    } else if (submenu !== null) {
      itensDoSubmenu.current[0]?.focus();
      focoPendente.current = null;
    }
  }, [aberto, submenu]);

  // Clique fora (inclusive no canvas) fecha.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    const aoPressionar = (evento: MouseEvent) => {
      if (ancora.current !== null && evento.target instanceof Node && !ancora.current.contains(evento.target)) {
        fechar(false);
      }
    };
    document.addEventListener("mousedown", aoPressionar, true);
    return () => document.removeEventListener("mousedown", aoPressionar, true);
  }, [aberto, fechar]);

  const executar = (item: ItemDeAcao) => {
    fechar(true);
    item.executar();
  };

  const escolherOrquestrador = (id: string) => {
    fechar(true);
    aoEscolherOrquestrador(id);
  };

  const abrirSubagentes = () => {
    fechar(true);
    aoAbrirSubagentes();
  };

  /** Abre o submenu e, vindo do teclado, leva o foco ao primeiro item dele. */
  const abrirSubmenu = (id: IdDoSubmenu, comFoco: boolean) => {
    if (comFoco && submenu === id) {
      // Já aberto (pelo mouse): não há render novo, o foco vai direto.
      itensDoSubmenu.current[0]?.focus();
      return;
    }
    if (comFoco) {
      focoPendente.current = { onde: "submenu" };
    }
    setSubmenu(id);
  };

  /** Fecha o submenu; `devolverFoco` põe o foco de volta no item que o abriu. */
  const fecharSubmenu = (devolverFoco: boolean) => {
    const dono = itens.findIndex((item) => item.tipo === "submenu" && item.id === submenu);
    setSubmenu(null);
    if (devolverFoco && dono >= 0) {
      itensPrincipais.current[dono]?.focus();
    }
  };

  const aoTeclarNoBotao = (evento: EventoDeTecladoDoReact<HTMLButtonElement>) => {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      abrir(0);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      abrir(itens.length - 1);
    }
  };

  const aoTeclarNoMenu = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    const alvo = evento.target;
    const dentroDoSubmenu = alvo instanceof Element && alvo.closest("[data-submenu]") !== null;
    const lista = dentroDoSubmenu ? itensDoSubmenu.current : itensPrincipais.current;
    const itensDaLista = lista.filter((item): item is HTMLButtonElement => item !== null);
    const atual = itensDaLista.findIndex((item) => item === alvo);
    const focar = (indice: number) => itensDaLista[indice]?.focus();
    switch (evento.key) {
      case "ArrowDown":
        evento.preventDefault();
        focar((atual + 1) % itensDaLista.length);
        break;
      case "ArrowUp":
        evento.preventDefault();
        focar(atual <= 0 ? itensDaLista.length - 1 : atual - 1);
        break;
      case "Home":
        evento.preventDefault();
        focar(0);
        break;
      case "End":
        evento.preventDefault();
        focar(itensDaLista.length - 1);
        break;
      case "ArrowRight": {
        const item = dentroDoSubmenu ? undefined : itens[atual];
        if (item?.tipo === "submenu") {
          evento.preventDefault();
          abrirSubmenu(item.id, true);
        }
        break;
      }
      case "ArrowLeft":
        if (dentroDoSubmenu) {
          evento.preventDefault();
          fecharSubmenu(true);
        }
        break;
      case "Enter":
      case " ": {
        evento.preventDefault();
        const item = dentroDoSubmenu ? undefined : itens[atual];
        if (item?.tipo === "submenu") {
          abrirSubmenu(item.id, true);
        } else if (alvo instanceof HTMLButtonElement) {
          alvo.click();
        }
        break;
      }
      case "Escape":
        evento.preventDefault();
        evento.stopPropagation();
        if (dentroDoSubmenu) {
          fecharSubmenu(true);
        } else {
          fechar(true);
        }
        break;
      case "Tab":
        // Sem impedir o Tab: o foco volta ao botão e segue dali.
        fechar(true);
        break;
    }
  };

  const conteudoDoSubmenu = (id: IdDoSubmenu): ReactNode => {
    itensDoSubmenu.current = [];
    let indice = 0;
    const refDoItem = () => {
      const meu = indice++;
      return (elemento: HTMLButtonElement | null) => {
        itensDoSubmenu.current[meu] = elemento;
      };
    };
    if (id === "orquestradores") {
      const trabalhando = (orquestradores ?? []).filter((item) => item.situacao === "trabalhando").length;
      return (
        <>
          <div className="titulo-do-submenu">
            {orquestradores === null
              ? "carregando…"
              : `${plural(orquestradores.length, "orquestrador", "orquestradores")}${trabalhando > 0 ? `, ${trabalhando} trabalhando` : ""}`}
          </div>
          {erroDosOrquestradores !== null && (
            <div className="alert alert-error m-1" role="alert">
              {erroDosOrquestradores}
            </div>
          )}
          {orquestradores !== null && orquestradores.length === 0 && (
            <p className="texto-do-submenu">Nenhum orquestrador ainda.</p>
          )}
          {(orquestradores ?? []).map((orquestrador) => {
            const trabalhandoAgora = orquestrador.situacao === "trabalhando";
            const abertoNoCanvas = noCanvas.has(orquestrador.id);
            return (
              <button
                key={orquestrador.id}
                ref={refDoItem()}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="item-de-lista-do-menu"
                data-orquestrador={orquestrador.id}
                aria-label={descreverOrquestrador(orquestrador, abertoNoCanvas)}
                title={abertoNoCanvas ? "Ir até a janela dele" : "Abrir o terminal no canvas"}
                onClick={() => escolherOrquestrador(orquestrador.id)}
              >
                <span className={`selo-do-item ${trabalhandoAgora ? "selo-do-item-ativo" : ""}`} aria-hidden="true">
                  {trabalhandoAgora ? <IconeTrabalhando tamanho={16} /> : <IconeParado tamanho={12} />}
                </span>
                <span className="texto-do-item" aria-hidden="true">
                  <strong>{orquestrador.nome}</strong>
                  <span>
                    {trabalhandoAgora ? "trabalhando" : "parado"}
                    <span className="mono">· {orquestrador.nomeDaPasta}</span>
                  </span>
                </span>
                <span
                  className={`situacao-no-canvas ${abertoNoCanvas ? "situacao-no-canvas-aberto" : ""}`}
                  aria-hidden="true"
                >
                  {abertoNoCanvas ? "no canvas" : "abrir"}
                </span>
              </button>
            );
          })}
          <p className="rodape-do-submenu">Escolher leva até a janela dele no canvas.</p>
        </>
      );
    }
    return (
      <>
        <div className="titulo-do-submenu">
          {subagentes === null ? "carregando…" : plural(subagentes.length, "subagente pronto", "subagentes prontos")}
        </div>
        {subagentes !== null && subagentes.length === 0 && (
          <p className="texto-do-submenu">Nenhum subagente pronto ainda.</p>
        )}
        {(subagentes ?? []).map((subagente) => (
          <button
            key={subagente.nome}
            ref={refDoItem()}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="item-de-lista-do-menu"
            aria-label={`${subagente.nome}: ${subagente.descricao}`}
            title="Abrir o painel de subagentes prontos"
            onClick={abrirSubagentes}
          >
            <span className="selo-do-item" aria-hidden="true">
              <IconePessoas tamanho={16} />
            </span>
            <span className="texto-do-item" aria-hidden="true">
              <strong>{subagente.nome}</strong>
              <span>
                <span className="descricao-do-subagente">{subagente.descricao}</span>
              </span>
            </span>
          </button>
        ))}
        <div className="acoes-do-submenu">
          <button
            ref={refDoItem()}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="item-do-menu-novo"
            onClick={abrirSubagentes}
          >
            <span className="icone-do-menu-novo" aria-hidden="true">
              <IconeMais tamanho={18} />
            </span>
            <span className="rotulo-do-menu-novo">Novo subagente</span>
          </button>
          <button
            ref={refDoItem()}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="item-do-menu-novo"
            onClick={abrirSubagentes}
          >
            <span className="icone-do-menu-novo" aria-hidden="true">
              <IconeEngrenagem tamanho={18} />
            </span>
            <span className="rotulo-do-menu-novo">Gerenciar subagentes</span>
          </button>
        </div>
      </>
    );
  };

  itensPrincipais.current = [];
  let posicao = 0;

  return (
    <div ref={ancora} className="ancora-do-menu-novo no-drag">
      <button
        ref={botao}
        type="button"
        className="botao-novo"
        aria-label="Novo"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        title="Novo orquestrador (Ctrl+N), nota (Ctrl+Shift+N), terminal ou prévia"
        onClick={() => (aberto ? fechar(false) : abrir(0))}
        onKeyDown={aoTeclarNoBotao}
      >
        <IconeMais tamanho={16} className="icone-do-botao-novo" />
        Novo
      </button>
      {aberto && (
        <div
          id={idDoMenu}
          role="menu"
          aria-label="Novo"
          className="menu-novo nodrag nopan nowheel"
          onKeyDown={aoTeclarNoMenu}
        >
          {grupos.map((grupo, indiceDoGrupo) => (
            <div key={indiceDoGrupo} role="none" className="grupo-do-menu-novo">
              {indiceDoGrupo > 0 && <div role="separator" className="divisor-do-menu-novo" />}
              {grupo.map((item) => {
                const meu = posicao++;
                const aoPassarOMouse = () => {
                  if (item.tipo === "submenu") {
                    setSubmenu(item.id);
                  } else if (submenu !== null) {
                    fecharSubmenu(false);
                  }
                };
                if (item.tipo === "acao") {
                  return (
                    <button
                      key={item.id}
                      ref={(elemento) => {
                        itensPrincipais.current[meu] = elemento;
                      }}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className="item-do-menu-novo"
                      aria-keyshortcuts={item.teclas}
                      title={item.dica}
                      onMouseEnter={aoPassarOMouse}
                      onClick={() => executar(item)}
                    >
                      <span className="icone-do-menu-novo" aria-hidden="true">
                        {item.icone}
                      </span>
                      <span className="rotulo-do-menu-novo">{item.rotulo}</span>
                      {item.atalho !== undefined && (
                        <kbd className="atalho-do-menu-novo" aria-hidden="true">
                          {item.atalho}
                        </kbd>
                      )}
                    </button>
                  );
                }
                const submenuAberto = submenu === item.id;
                return (
                  <div key={item.id} className="pai-de-submenu" onMouseEnter={aoPassarOMouse}>
                    <button
                      ref={(elemento) => {
                        itensPrincipais.current[meu] = elemento;
                      }}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className="item-do-menu-novo"
                      aria-haspopup="menu"
                      aria-expanded={submenuAberto}
                      aria-controls={submenuAberto ? idDoSubmenu(item.id) : undefined}
                      title={item.dica}
                      onClick={() => abrirSubmenu(item.id, false)}
                    >
                      <span className="icone-do-menu-novo" aria-hidden="true">
                        {item.icone}
                      </span>
                      <span className="rotulo-do-menu-novo">{item.rotulo}</span>
                      {item.contagem !== null && (
                        <span className="contagem-do-menu-novo" aria-hidden="true">
                          {item.contagem}
                        </span>
                      )}
                      <IconeSetaDireita className="seta-do-menu-novo" />
                    </button>
                    {submenuAberto && (
                      <div
                        id={idDoSubmenu(item.id)}
                        role="menu"
                        aria-label={item.rotulo}
                        data-submenu={item.id}
                        className="submenu-novo custom-scrollbar nodrag nopan nowheel"
                      >
                        {conteudoDoSubmenu(item.id)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
