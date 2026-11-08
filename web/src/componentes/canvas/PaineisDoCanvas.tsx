import { type MouseEvent as EventoDeMouseDoReact, type ReactNode, useCallback, useEffect, useId, useState } from "react";

import type { JanelaDaCota, LeituraDeMemoria, ResumoDoOrquestrador } from "../../shared/api/tipos";
import {
  descreverQuantidade,
  formatarBytes,
  formatarDuracao,
  formatarMomento,
  formatarPercentual,
  ROTULOS_DOS_MODELOS,
  rotuloCurtoDaCota,
} from "../../shared/formatacao";
import { useAjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { useMenuDaBarra } from "../../shared/hooks/useMenuDaBarra";
import { useRelogio } from "../../shared/hooks/useRelogio";
import type { EstadoDoServidor } from "../../shared/hooks/useServidor";
import { nivelDaMemoria, type NivelDaMemoria } from "../../shared/memoria";
import { EtiquetaDeWorktree } from "../EtiquetaDeWorktree";
import {
  IconeAlerta,
  IconeFechar,
  IconeNavegador,
  IconeOrquestrador,
  IconePasta,
  IconePessoas,
  IconeShell,
} from "../Icones";
import { rodandoNoDesktop } from "../../shared/ponteDoDesktop";
import { PainelDeConfiguracoesDoApp } from "./PainelDeConfiguracoesDoApp";
import { ATRIBUTO_DO_GATILHO, COTA_ALTA, PopoverDoUso } from "./PopoverDoUso";
import "../../theme/topo-do-canvas.css";

/** Por quanto tempo o aviso de "reconectado" fica na tela. */
const DURACAO_DO_AVISO_DE_VOLTA_MS = 10_000;

/**
 * Faixa no topo do canvas quando o servidor cai — e, por alguns segundos,
 * quando ele volta. Sem ela, a tela congelada parece um sistema travado.
 */
export function AvisoDeConexao({ servidor }: { servidor: EstadoDoServidor }) {
  const agora = useRelogio(!servidor.conectado);
  const [mostrarVolta, setMostrarVolta] = useState(false);

  useEffect(() => {
    if (servidor.voltouEm === null) {
      return;
    }
    setMostrarVolta(true);
    const espera = setTimeout(() => setMostrarVolta(false), DURACAO_DO_AVISO_DE_VOLTA_MS);
    return () => clearTimeout(espera);
  }, [servidor.voltouEm]);

  if (!servidor.conectado) {
    const foraHa = servidor.caiuEm === null ? 0 : agora.getTime() - servidor.caiuEm.getTime();
    return (
      <div className="aviso-de-conexao aviso-desconectado" role="alert">
        <span className="ponto-de-status ponto-de-status-erro" />
        <div className="flex flex-col gap-0.5">
          <strong className="font-titulo text-[13px]">
            Servidor desconectado · há {formatarDuracao(foraHa)}
          </strong>
          <span>
            Os orquestradores pararam de responder. A tela reconecta sozinha assim que o servidor voltar.
          </span>
          <span className="mono text-muted">
            o aplicativo religa o servidor sozinho; se não voltar, feche e abra o Orquestrador de novo
          </span>
        </div>
      </div>
    );
  }

  if (mostrarVolta) {
    return (
      <div className="aviso-de-conexao aviso-reconectado" role="status">
        <span className="ponto-de-status ponto-de-status-ok" />
        <div className="flex flex-col gap-0.5">
          <strong className="font-titulo text-[13px]">Servidor reconectado</strong>
          {servidor.reiniciou && (
            <span>
              Ele foi reiniciado: pedidos que estavam rodando aparecem como interrompidos. Reenvie se precisar — os
              orquestradores lembram da conversa.
            </span>
          )}
        </div>
        <button type="button" className="botao-icone" title="Fechar aviso" onClick={() => setMostrarVolta(false)}>
          <IconeFechar tamanho={14} />
        </button>
      </div>
    );
  }

  return null;
}

interface PropsDaBarra {
  aoCriar: () => void;
  aoCriarNota: () => void;
  /**
   * Abre a paleta de comandos (o mesmo do Ctrl+K). Só no navegador: no
   * desktop, a busca fica na barra de título. Sem ela, "Buscar" não aparece.
   */
  aoBuscar?: () => void;
  /** Abre uma prévia ao vivo vazia no centro da tela, com o campo de endereço focado ("Prévia" do `+ Novo ▾`). */
  aoCriarPrevia: () => void;
  /** Pede a pasta e abre um terminal (shell) nela. Sem ela, "Terminal" não aparece no `+ Novo ▾`. */
  aoCriarShell?: () => void;
  /** Abre um dos painéis da barra (ou fecha, se já estava aberto). Só um fica aberto por vez. */
  aoAlternarPainel: (painel: PainelDaBarra) => void;
  painelAberto: PainelDaBarra | null;
  /** Quantos subagentes prontos existem; nulo enquanto não se sabe (ex.: servidor fora). */
  quantidadeDeSubagentes: number | null;
}

/** Os painéis que abrem logo abaixo da barra do canvas. */
export type PainelDaBarra = "subagentes" | "instrucoes";

interface PropsDoRotulo {
  /** Texto inteiro (≥ 1280 px). */
  completo: ReactNode;
  /** Entre 1100 e 1280 px. */
  curto: ReactNode;
  /** Abaixo de 1100 px: o botão fica só com o ícone e a dica (`title`). */
  icone: ReactNode;
}

/**
 * O rótulo de um botão em três tamanhos; o CSS (`.rotulo-*`, pela largura da
 * janela) mostra um só. O nome acessível vem do `aria-label` do botão.
 */
function RotuloResponsivo({ completo, curto, icone }: PropsDoRotulo) {
  return (
    <>
      <span className="rotulo-completo" aria-hidden="true">
        {completo}
      </span>
      <span className="rotulo-curto" aria-hidden="true">
        {curto}
      </span>
      <span className="rotulo-icone" aria-hidden="true">
        {icone}
      </span>
    </>
  );
}

type EscolhaDoNovo = "orquestrador" | "nota" | "terminal" | "previa";

/**
 * Os itens do `+ Novo ▾`, com o atalho de teclado de cada um (o mesmo do
 * canvas); sem atalho, `atalho` e `teclas` ficam vazios.
 */
const ITENS_DO_NOVO: readonly {
  escolha: EscolhaDoNovo;
  rotulo: string;
  atalho: string;
  teclas: string;
  dica: string;
}[] = [
  {
    escolha: "orquestrador",
    rotulo: "Orquestrador",
    atalho: "Ctrl+N",
    teclas: "Control+N",
    dica: "Abre o formulário de um terminal novo",
  },
  {
    escolha: "nota",
    rotulo: "Nota",
    atalho: "Ctrl+Shift+N",
    teclas: "Control+Shift+N",
    dica: "Cria uma nota no centro da tela (bloco de notas, salvo automaticamente)",
  },
  {
    escolha: "terminal",
    rotulo: "Terminal",
    atalho: "",
    teclas: "",
    dica: "Abre um terminal de verdade (o shell do computador) numa pasta escolhida",
  },
  {
    escolha: "previa",
    rotulo: "Prévia",
    atalho: "",
    teclas: "",
    dica: "Abre uma prévia ao vivo: um navegador no canvas para ver o site que os agentes estão fazendo",
  },
];

/** O ícone de cada item do `+ Novo ▾`. */
function IconeDoNovo({ escolha }: { escolha: EscolhaDoNovo }) {
  switch (escolha) {
    case "orquestrador":
      return <IconeOrquestrador tamanho={14} />;
    case "nota":
      return "✎";
    case "terminal":
      return <IconeShell />;
    case "previa":
      return <IconeNavegador />;
  }
}

interface PropsDoMenuDoNovo {
  aoCriar: () => void;
  aoCriarNota: () => void;
  aoCriarPrevia: () => void;
  /** Sem ela, o item "Terminal" não aparece. */
  aoCriarShell?: () => void;
}

/** O botão `+ Novo ▾` e o menu dele (Orquestrador · Nota · Terminal · Prévia). */
function MenuDoNovo({ aoCriar, aoCriarNota, aoCriarPrevia, aoCriarShell }: PropsDoMenuDoNovo) {
  const itensDoMenu = ITENS_DO_NOVO.filter((item) => item.escolha !== "terminal" || aoCriarShell !== undefined);

  const escolher = (escolha: EscolhaDoNovo) => {
    menu.fechar(true);
    switch (escolha) {
      case "orquestrador":
        aoCriar();
        break;
      case "nota":
        aoCriarNota();
        break;
      case "terminal":
        aoCriarShell?.();
        break;
      case "previa":
        aoCriarPrevia();
        break;
    }
  };

  const menu = useMenuDaBarra(itensDoMenu.length, (indice) => {
    const item = itensDoMenu[indice];
    if (item !== undefined) {
      escolher(item.escolha);
    }
  });

  return (
    <div ref={menu.ancora} className="ancora-do-menu">
      <button
        {...menu.propsDoBotao}
        type="button"
        className="btn btn-sm btn-cta"
        aria-label="Novo"
        title="Novo orquestrador (Ctrl+N), nota (Ctrl+Shift+N), terminal ou prévia"
      >
        <RotuloResponsivo completo="+ Novo ▾" curto="+ Novo ▾" icone="+" />
      </button>
      {menu.aberto && (
        <div
          id={menu.idDoMenu}
          role="menu"
          aria-label="Novo"
          className="menu-do-novo painel-flutuante"
          onKeyDown={menu.aoTeclarNoMenu}
        >
          {itensDoMenu.map((item, indice) => (
            <button
              key={item.escolha}
              ref={menu.refDoItem(indice)}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="item-do-menu"
              aria-keyshortcuts={item.teclas === "" ? undefined : item.teclas}
              title={item.dica}
              onClick={() => escolher(item.escolha)}
            >
              <span className="item-com-icone">
                <span
                  className={`icone-do-item ${item.escolha === "orquestrador" ? "icone-do-item-ativo" : ""}`}
                  aria-hidden="true"
                >
                  <IconeDoNovo escolha={item.escolha} />
                </span>
                {item.rotulo}
              </span>
              {item.atalho !== "" && (
                <kbd className="atalho-do-item" aria-hidden="true">
                  {item.atalho}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Canto superior esquerdo: o `+ Novo ▾` (Orquestrador, nota, terminal ou
 * prévia). No desktop, a busca e o ⚙ Configurações ficam na barra de título,
 * que também tem a identidade do app. No navegador (sem barra de título
 * própria), a barra também mostra a identidade, o "Buscar" e o ⚙
 * Configurações, para nada ficar inacessível. O "Organizar" fica nos controles
 * do canto inferior esquerdo. Nos dois, os Subagentes e as Instruções gerais
 * seguem à vista como botões.
 */
export function BarraDoCanvas({
  aoCriar,
  aoCriarNota,
  aoBuscar,
  aoCriarPrevia,
  aoCriarShell,
  aoAlternarPainel,
  painelAberto,
  quantidadeDeSubagentes,
}: PropsDaBarra) {
  const [desktop] = useState(rodandoNoDesktop);
  const ajustes = useAjustesDoAplicativo();
  const contagem =
    quantidadeDeSubagentes === null ? null : <span className="mono text-muted"> {quantidadeDeSubagentes}</span>;

  return (
    <div className="barra-do-canvas painel-flutuante flex items-center gap-2 px-2.5 py-2">
      {!desktop && (
        <>
          <div className="no-orquestrador-icone h-8 w-8 shrink-0">
            <IconeOrquestrador tamanho={18} />
          </div>
          <div className="identidade-da-barra flex flex-col leading-tight">
            <h1 className="text-[14px] whitespace-nowrap">Orquestrador de agentes</h1>
            <span className="subtitulo-da-barra mono text-muted whitespace-nowrap">claude code · canvas · local</span>
          </div>
          <span className="mx-1 h-8 w-px shrink-0 bg-border" />
        </>
      )}
      <MenuDoNovo
        aoCriar={aoCriar}
        aoCriarNota={aoCriarNota}
        aoCriarPrevia={aoCriarPrevia}
        aoCriarShell={aoCriarShell}
      />
      {!desktop && aoBuscar !== undefined && (
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={aoBuscar}
          aria-label="Buscar (Ctrl+K)"
          aria-keyshortcuts="Control+K"
          title="Paleta de comandos: ações, orquestradores, notas e pedidos (Ctrl+K)"
        >
          <RotuloResponsivo completo="Buscar (Ctrl+K)" curto="Buscar" icone="⌕" />
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-outline botao-de-painel"
        onClick={() => aoAlternarPainel("subagentes")}
        aria-expanded={painelAberto === "subagentes"}
        aria-label={quantidadeDeSubagentes === null ? "Subagentes" : `Subagentes (${quantidadeDeSubagentes})`}
        title="Ajudantes prontos que todo orquestrador pode chamar"
      >
        <RotuloResponsivo
          completo={<>Subagentes{contagem}</>}
          curto={<>Subagentes{contagem}</>}
          icone={<IconePessoas />}
        />
      </button>
      <button
        type="button"
        className="btn btn-sm btn-outline botao-de-painel"
        onClick={() => aoAlternarPainel("instrucoes")}
        aria-expanded={painelAberto === "instrucoes"}
        aria-label="Instruções gerais"
        title="Instruções que valem para todo orquestrador sem instruções próprias"
      >
        <RotuloResponsivo completo="Instruções gerais" curto="Instruções" icone="¶" />
      </button>
      {!desktop && (
        <PainelDeConfiguracoesDoApp
          ajustes={ajustes}
          alinhamento="esquerda"
          classeDoBotao="btn btn-sm btn-outline"
          conteudoDoBotao={<RotuloResponsivo completo="⚙ Configurações" curto="⚙" icone="⚙" />}
        />
      )}
      {!desktop && ajustes.erro !== null && (
        <span className="mono text-error max-w-64" role="alert">
          {ajustes.erro}
        </span>
      )}
    </div>
  );
}

interface PropsDoErroDoCanvas {
  erro: string;
  aoFechar: () => void;
  /** "aviso" para recusas esperadas (ex.: limite de terminais abertos); padrão, erro. */
  nivel?: "erro" | "aviso";
}

/** Falha ou recusa numa ação do canvas (ex.: criar uma nota), logo abaixo da barra. */
export function ErroDoCanvas({ erro, aoFechar, nivel = "erro" }: PropsDoErroDoCanvas) {
  return (
    <div
      className={`alert ${nivel === "aviso" ? "alert-warning" : "alert-error"} mt-2 flex max-w-md items-start gap-2`}
      role="alert"
    >
      <span className="flex-1">{erro}</span>
      <button type="button" className="botao-icone shrink-0" title="Fechar aviso" onClick={aoFechar}>
        <IconeFechar tamanho={14} />
      </button>
    </div>
  );
}

interface PropsDaDoca {
  orquestradores: ResumoDoOrquestrador[] | null;
  noCanvas: ReadonlySet<string>;
  erro: string | null;
  aoAbrir: (id: string) => void;
}

/** Lista de todos os Orquestradores: clicar abre (ou encontra) o terminal no canvas. */
export function Doca({ orquestradores, noCanvas, erro, aoAbrir }: PropsDaDoca) {
  const [recolhida, setRecolhida] = useState(false);

  return (
    <div className="painel-flutuante mt-2 flex w-72 flex-col">
      <button
        type="button"
        className="flex cursor-pointer items-center justify-between px-3 py-2"
        aria-expanded={!recolhida}
        onClick={() => setRecolhida((atual) => !atual)}
      >
        <span className="rotulo-tecnico">orquestradores · {orquestradores?.length ?? 0}</span>
        <span className="mono text-muted">{recolhida ? "▸" : "▾"}</span>
      </button>
      {!recolhida && (
        <div className="custom-scrollbar max-h-[50vh] overflow-y-auto border-t border-border p-1.5">
          {erro !== null && <div className="alert alert-error m-1">{erro}</div>}
          {orquestradores === null ? (
            <p className="mono text-muted px-2 py-1.5">carregando…</p>
          ) : orquestradores.length === 0 ? (
            <p className="text-support px-2 py-1.5">Nenhum orquestrador ainda.</p>
          ) : (
            orquestradores.map((orquestrador) => {
              const trabalhando = orquestrador.situacao === "trabalhando";
              const aberto = noCanvas.has(orquestrador.id);
              return (
                <button
                  key={orquestrador.id}
                  type="button"
                  className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
                  onClick={() => aoAbrir(orquestrador.id)}
                  title={aberto ? "Ir até o terminal" : "Abrir o terminal no canvas"}
                >
                  <span className="flex items-center gap-2">
                    <span className={`ponto-de-status ${trabalhando ? "ponto-de-status-ativo" : ""}`} />
                    <strong className="truncate font-titulo text-[12px] font-medium">{orquestrador.nome}</strong>
                    {!aberto && <span className="mono ml-auto text-muted">abrir</span>}
                  </span>
                  <span className="flex items-center gap-1 pl-4 mono text-muted">
                    <IconePasta className="shrink-0" />
                    <span className="truncate">{orquestrador.nomeDaPasta}</span>
                    <span className="shrink-0">
                      · {ROTULOS_DOS_MODELOS[orquestrador.configuracao.modeloDoOrquestrador].nome.toLowerCase()} ·{" "}
                      {descreverQuantidade(orquestrador.configuracao.quantidadeDeSubagentes)}
                    </span>
                  </span>
                  {orquestrador.worktree !== null && (
                    <span className="flex min-w-0 items-center pl-4">
                      <EtiquetaDeWorktree worktree={orquestrador.worktree} className="max-w-full" />
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}


interface PropsDoStatus {
  trabalhando: number;
  bixinhosAtivos: number;
  cota: JanelaDaCota[] | null;
  memoria: LeituraDeMemoria | null;
}

const AVISO_DA_MEMORIA = {
  baixa: "Memória baixa: novos pedidos (sobretudo com Opus nos subagentes) podem deixar o computador lento.",
  critica:
    "Memória quase esgotada: espere os pedidos em andamento terminarem, feche programas ou use Haiku/Sonnet nos subagentes.",
} as const;

function descreverMemoria(memoria: LeituraDeMemoria): string {
  return `Livre: ${formatarBytes(memoria.livreBytes)} de ${formatarBytes(memoria.totalBytes)}. Agentes: ${formatarBytes(memoria.agentesBytes)}. Servidor: ${formatarBytes(memoria.servidorBytes)}.`;
}

/** RAM livre do computador e quanto os agentes estão usando, com alerta quando aperta. */
function MedidorDeMemoria({ memoria }: { memoria: LeituraDeMemoria }) {
  const nivel = nivelDaMemoria(memoria);
  const usada = 1 - memoria.livreBytes / memoria.totalBytes;
  return (
    <span
      className={`status-detalhe flex items-center gap-1.5 mono whitespace-nowrap ${nivel === "normal" ? "text-muted" : nivel === "baixa" ? "text-warning" : "text-error"}`}
      title={descreverMemoria(memoria)}
    >
      RAM
      <span className={`medidor ${nivel === "normal" ? "" : "medidor-alto"}`}>
        <span style={{ width: `${Math.round(usada * 100)}%` }} />
      </span>
      {formatarBytes(memoria.livreBytes)} livres
      {memoria.agentesBytes > 0 && (
        <span className="status-extra text-muted">· agentes {formatarBytes(memoria.agentesBytes)}</span>
      )}
    </span>
  );
}

interface LeituraDoResumo {
  rotulo: string;
  uso: number;
  alto: boolean;
  linha: string;
}

/** O que liga um botão do status ao popover do uso: abre, fecha e diz se está aberto. */
interface GatilhoDoUso {
  aberto: boolean;
  idDoPopover: string;
  aoAlternar: (evento: EventoDeMouseDoReact<HTMLElement>) => void;
}

/** Atributos comuns dos botões que abrem o popover do uso. */
function propsDoGatilho({ aberto, idDoPopover, aoAlternar }: GatilhoDoUso) {
  return {
    type: "button" as const,
    "aria-haspopup": "dialog" as const,
    "aria-expanded": aberto,
    "aria-controls": aberto ? idDoPopover : undefined,
    [ATRIBUTO_DO_GATILHO]: "",
    onClick: aoAlternar,
  };
}

/**
 * Abaixo de 1100 px: um só medidor (o uso mais alto entre as cotas e a RAM),
 * com o resto no balão ao passar o mouse. O clique abre o popover do uso.
 */
function ResumoDoStatus({
  bixinhosAtivos,
  cota,
  memoria,
  gatilho,
}: Omit<PropsDoStatus, "trabalhando"> & { gatilho: GatilhoDoUso }) {
  const leituras: LeituraDoResumo[] = (cota ?? []).map((janela) => ({
    rotulo: rotuloCurtoDaCota(janela.nome),
    uso: janela.utilizacao,
    alto: janela.utilizacao >= COTA_ALTA,
    linha: `${janela.nome}: ${formatarPercentual(janela.utilizacao)}${janela.renovaEm ? ` (renova ${formatarMomento(janela.renovaEm)})` : ""}`,
  }));
  if (memoria !== null) {
    leituras.push({
      rotulo: "RAM",
      uso: 1 - memoria.livreBytes / memoria.totalBytes,
      alto: nivelDaMemoria(memoria) !== "normal",
      linha: `RAM: ${descreverMemoria(memoria)}`,
    });
  }
  if (leituras.length === 0 && bixinhosAtivos === 0) {
    return null;
  }
  const principal = leituras.reduce<LeituraDoResumo | null>(
    (maior, leitura) => (maior === null || leitura.uso > maior.uso ? leitura : maior),
    null,
  );
  const dica = [
    ...(bixinhosAtivos > 0 ? [`${bixinhosAtivos} ${bixinhosAtivos === 1 ? "agente ativo" : "agentes ativos"}`] : []),
    ...leituras.map((leitura) => leitura.linha),
  ].join("\n");
  return (
    <button
      {...propsDoGatilho(gatilho)}
      className={`status-resumo items-center gap-1.5 mono whitespace-nowrap ${leituras.some((leitura) => leitura.alto) ? "text-error" : "text-muted"}`}
      title={`${dica}\nClique para ver o uso`}
      aria-label={dica}
      data-testid="resumo-do-status"
    >
      {bixinhosAtivos > 0 && <span className="text-active">{bixinhosAtivos} ativos ·</span>}
      {principal !== null && (
        <>
          {principal.rotulo}
          <span className={`medidor medidor-curto ${principal.alto ? "medidor-alto" : ""}`}>
            <span style={{ width: `${Math.min(100, Math.round(principal.uso * 100))}%` }} />
          </span>
          {formatarPercentual(principal.uso)}
        </>
      )}
    </button>
  );
}

/**
 * Situação, agentes ativos, cotas e RAM: o conteúdo do status, em linha. Cada
 * medidor da cota (e o resumo, na janela estreita) abre o popover do uso; sem
 * cota ainda, um "cota —" faz o mesmo papel.
 */
function ConteudoDoStatus({ trabalhando, bixinhosAtivos, cota, memoria }: PropsDoStatus) {
  // O botão que abriu o popover; nulo com ele fechado. Um clique em qualquer gatilho fecha.
  const [gatilhoAberto, setGatilhoAberto] = useState<HTMLElement | null>(null);
  const idDoPopover = `${useId()}-uso`;
  const fecharUso = useCallback(() => setGatilhoAberto(null), []);
  const gatilho: GatilhoDoUso = {
    aberto: gatilhoAberto !== null,
    idDoPopover,
    aoAlternar: (evento) => {
      const alvo = evento.currentTarget;
      setGatilhoAberto((atual) => (atual === null ? alvo : null));
    },
  };

  return (
    <>
      <span className={`etiqueta shrink-0 ${trabalhando > 0 ? "etiqueta-ativa etiqueta-pulso" : ""}`}>
        {trabalhando > 0 ? `${trabalhando} trabalhando` : "todos ociosos"}
      </span>
      {bixinhosAtivos > 0 && (
        <span className="status-detalhe mono text-active whitespace-nowrap">
          {bixinhosAtivos} {bixinhosAtivos === 1 ? "agente ativo" : "agentes ativos"}
        </span>
      )}
      {cota !== null && cota.length > 0 ? (
        cota.map((janela) => (
          <button
            key={janela.nome}
            {...propsDoGatilho(gatilho)}
            className="status-detalhe status-da-cota flex items-center gap-1.5 mono text-muted whitespace-nowrap"
            aria-label={`Cota de ${janela.nome}: ${formatarPercentual(janela.utilizacao)}`}
            title={`${janela.renovaEm ? `Renova ${formatarMomento(janela.renovaEm)} · ` : ""}Clique para ver o uso`}
          >
            <span className="rotulo-completo">{janela.nome}</span>
            <span className="rotulo-curto">{rotuloCurtoDaCota(janela.nome)}</span>
            <span className={`medidor ${janela.utilizacao >= COTA_ALTA ? "medidor-alto" : ""}`}>
              <span style={{ width: `${Math.min(100, Math.round(janela.utilizacao * 100))}%` }} />
            </span>
            {formatarPercentual(janela.utilizacao)}
          </button>
        ))
      ) : (
        <button
          {...propsDoGatilho(gatilho)}
          className="status-detalhe status-da-cota flex items-center gap-1.5 mono text-muted whitespace-nowrap"
          aria-label="Cota: ainda sem dados"
          title="A cota aparece depois do primeiro pedido · Clique para ver o uso"
        >
          cota —
        </button>
      )}
      {memoria !== null && <MedidorDeMemoria memoria={memoria} />}
      <ResumoDoStatus bixinhosAtivos={bixinhosAtivos} cota={cota} memoria={memoria} gatilho={gatilho} />
      {gatilhoAberto !== null && (
        <PopoverDoUso id={idDoPopover} cota={cota} gatilho={gatilhoAberto} aoFechar={fecharUso} />
      )}
    </>
  );
}

/** Alerta de memória baixa/crítica: abaixo do status (navegador) ou no canto direito do canvas (desktop). */
export function AvisoDeMemoria({ memoria }: { memoria: LeituraDeMemoria | null }) {
  const nivel = memoria === null ? "normal" : nivelDaMemoria(memoria);
  // Fechar esconde o aviso daquele nível. Ele volta se a memória piorar
  // (baixa → crítica) ou se normalizar e apertar de novo; o medidor fica.
  const [dispensado, setDispensado] = useState<NivelDaMemoria | null>(null);
  if (nivel === "normal" && dispensado !== null) {
    setDispensado(null);
  }
  const aviso = nivel === "normal" || dispensado === "critica" || dispensado === nivel ? null : nivel;
  if (aviso === null) {
    return null;
  }
  return (
    <div
      className={`aviso-de-memoria flex items-start gap-2 ${aviso === "critica" ? "aviso-de-memoria-critica" : ""}`}
      role="status"
    >
      <IconeAlerta className="mt-0.5 shrink-0" />
      <span className="flex-1">{AVISO_DA_MEMORIA[aviso]}</span>
      <button
        type="button"
        className="botao-icone shrink-0"
        title="Fechar aviso"
        aria-label="Fechar aviso de memória"
        onClick={() => setDispensado(aviso)}
      >
        <IconeFechar tamanho={14} />
      </button>
    </div>
  );
}

interface PropsDoStatusDoCanvas extends PropsDoStatus {
  /** No desktop, o status vai na barra de título: sem moldura e sem o alerta de memória. */
  naBarraDeTitulo?: boolean;
}

/**
 * Quem está trabalhando agora, a cota da assinatura e a RAM. No navegador, é
 * o painel do canto superior direito; no desktop, fica na barra de título. A
 * largura da janela decide o detalhe (CSS): rótulos curtos abaixo de 1280 px
 * e só a situação com um medidor resumido abaixo de 1100 px. Na barra de
 * título, que divide a largura com a busca, cada passo vem antes: 1440 px e
 * 1280 px. No painel, a largura do canvas também conta (`topo-do-canvas.css`):
 * com o chat fixo à esquerda, ele compacta antes e nunca quebra linha.
 */
export function StatusDoCanvas({ naBarraDeTitulo = false, ...status }: PropsDoStatusDoCanvas) {
  if (naBarraDeTitulo) {
    return (
      <div className="status-do-canvas status-na-barra-de-titulo no-drag" data-testid="status-do-canvas">
        <ConteudoDoStatus {...status} />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <div className="status-do-canvas painel-flutuante px-3 py-2" data-testid="status-do-canvas">
        <ConteudoDoStatus {...status} />
      </div>
      <AvisoDeMemoria memoria={status.memoria} />
    </div>
  );
}
