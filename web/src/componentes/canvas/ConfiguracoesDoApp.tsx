import { type KeyboardEvent as EventoDeTeclado, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { avisoDosPedidosEmAndamento, percentualDoDownload } from "../../shared/atualizacao";
import type { JanelaDaCota, LeituraDeMemoria, SituacaoDoOrquestrador } from "../../shared/api/tipos";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { useAtualizacao } from "../../shared/hooks/useAtualizacao";
import {
  type EstiloDosControlesDasJanelas,
  usePreferenciasDaTela,
} from "../../shared/hooks/usePreferenciasDaTela";
import { OPCOES_DE_IDIOMA, definirIdioma, useIdioma, useTextos } from "../../shared/idioma/idioma";
import { textosDeConfiguracoes } from "../../shared/idioma/textos/configuracoes";
import "../../theme/configuracoes-do-app.css";
import { IconeFechar } from "../Icones";
import { AbaDaConta } from "./AbaDaConta";
import { AbaDePadroesDasConfiguracoes } from "./AbaDePadroesDasConfiguracoes";
import { AbaDoSistema } from "./AbaDoSistema";
import {
  InterruptorDaConfiguracao,
  LinhaDaConfiguracao,
  type OpcaoDoSegmentado,
  SegmentadoDaConfiguracao,
} from "./ControlesDasConfiguracoes";

export type AbaDasConfiguracoes = "padroes" | "sistema" | "conta" | "atualizacao" | "aparencia";

/** As abas, na ordem do protótipo (o rótulo vem dos textos, pela chave). */
const ABAS: readonly { aba: AbaDasConfiguracoes }[] = [
  { aba: "padroes" },
  { aba: "sistema" },
  { aba: "conta" },
  { aba: "atualizacao" },
  { aba: "aparencia" },
];

/** O topo do painel por padrão: logo abaixo da ilha da direita (topo 16 + altura 42 + respiro de 8). */
const TOPO_PADRAO = 66;

interface Props {
  /** Os Ajustes do app desktop (pastas e Claude Code). */
  ajustes: AjustesDoAplicativo;
  aberto: boolean;
  aoFechar: () => void;
  /** A aba que abre selecionada; o que não existe vale Padrões. */
  abaInicial?: AbaDasConfiguracoes;
  /** Fallback da aba Sistema: o status antigo, mostrado no topo quando não há `memoria`. */
  sistema?: ReactNode;
  /** A leitura de memória do servidor (anel, nível e barra da aba Sistema). */
  memoria?: LeituraDeMemoria | null;
  /** As janelas da cota do Claude (aba Conta); nulo até o primeiro pedido. */
  cota?: JanelaDaCota[] | null;
  /** Os orquestradores da tabela de uso da aba Sistema. */
  orquestradores?: { id: string; nome: string; situacao: SituacaoDoOrquestrador }[];
  /** Pedidos rodando agora: reiniciar para instalar a atualização os cancela. */
  pedidosEmAndamento?: number;
  /** Depois de salvar as instruções gerais: a página recarrega o que depende delas. */
  aoSalvarInstrucoes?: () => void;
  /** Distância do topo do contêiner, em px (há notificações empilhadas no canto). */
  topo?: number;
}

/**
 * Configurações do app como painel com abas (Padrões, Sistema, Conta,
 * Atualização e Aparência), à direita da área do canvas: o contêiner é `relative` e o painel
 * se posiciona sozinho, com 540 px, abaixo da ilha da direita. Esc e o botão
 * fechar chamam `aoFechar`; o foco vai para a aba ao abrir e volta para quem
 * abriu ao fechar. Fechado, não renderiza nada.
 */
export function ConfiguracoesDoApp(props: Props) {
  return props.aberto ? <PainelAberto {...props} /> : null;
}

function PainelAberto({
  ajustes,
  aoFechar,
  abaInicial,
  sistema,
  memoria = null,
  cota = null,
  orquestradores,
  pedidosEmAndamento = 0,
  aoSalvarInstrucoes,
  topo = TOPO_PADRAO,
}: Props) {
  const t = useTextos(textosDeConfiguracoes);
  const [aba, setAba] = useState<AbaDasConfiguracoes>(() =>
    ABAS.some((item) => item.aba === abaInicial) ? (abaInicial as AbaDasConfiguracoes) : "padroes",
  );
  const id = useId();
  const painel = useRef<HTMLElement>(null);
  const botoesDasAbas = useRef(new Map<AbaDasConfiguracoes, HTMLButtonElement>());
  const idDaAba = (item: AbaDasConfiguracoes) => `${id}-aba-${item}`;
  const idDoPainelDaAba = (item: AbaDasConfiguracoes) => `${id}-painel-${item}`;

  // O foco vai para a aba ativa ao abrir e volta para quem abriu ao fechar.
  useEffect(() => {
    const quemAbriu = document.activeElement;
    (botoesDasAbas.current.get(aba) ?? painel.current)?.focus({ preventScroll: true });
    return () => {
      if (quemAbriu instanceof HTMLElement && quemAbriu !== document.body && quemAbriu.isConnected) {
        quemAbriu.focus({ preventScroll: true });
      }
    };
    // Só na abertura e no fechamento: trocar de aba não rouba o foco de volta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc fecha. Só o Esc dado no painel (ou sem nada focado): o painel não é
  // modal, e um Esc num terminal ou num menu aberto não pode fechá-lo.
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.key === "Escape" && !evento.defaultPrevented && noPainel) {
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const aoTeclarNasAbas = (evento: EventoDeTeclado<HTMLButtonElement>, indice: number) => {
    let destino: number;
    switch (evento.key) {
      case "ArrowRight":
        destino = (indice + 1) % ABAS.length;
        break;
      case "ArrowLeft":
        destino = (indice - 1 + ABAS.length) % ABAS.length;
        break;
      case "Home":
        destino = 0;
        break;
      case "End":
        destino = ABAS.length - 1;
        break;
      default:
        return;
    }
    evento.preventDefault();
    const proxima = ABAS[destino]?.aba;
    if (proxima === undefined) {
      return;
    }
    setAba(proxima);
    botoesDasAbas.current.get(proxima)?.focus();
  };

  return (
    <section
      ref={painel}
      tabIndex={-1}
      aria-label={t.painel.titulo}
      className="configuracoes-do-app painel-flutuante surgir no-drag"
      style={{ top: topo, maxHeight: `calc(100% - ${topo + 16}px)` }}
    >
      <header className="configuracoes-do-app-cabecalho">
        <div className="min-w-0">
          <span className="text-support">{t.painel.sobretitulo}</span>
          <h2 className="text-[16px]">{t.painel.titulo}</h2>
        </div>
        <button type="button" className="botao-icone shrink-0" aria-label={t.painel.fechar} title={t.painel.fecharDica} onClick={aoFechar}>
          <IconeFechar tamanho={16} />
        </button>
      </header>

      <div className="configuracoes-do-app-abas" role="tablist" aria-label={t.painel.secoes}>
        {ABAS.map((item, indice) => (
          <button
            key={item.aba}
            ref={(elemento) => {
              if (elemento === null) {
                botoesDasAbas.current.delete(item.aba);
              } else {
                botoesDasAbas.current.set(item.aba, elemento);
              }
            }}
            id={idDaAba(item.aba)}
            type="button"
            role="tab"
            aria-selected={aba === item.aba}
            aria-controls={idDoPainelDaAba(item.aba)}
            tabIndex={aba === item.aba ? 0 : -1}
            onClick={() => setAba(item.aba)}
            onKeyDown={(evento) => aoTeclarNasAbas(evento, indice)}
          >
            {t.abas[item.aba]}
          </button>
        ))}
      </div>

      <div className="configuracoes-do-app-corpo custom-scrollbar">
        {/* Padrões fica montada mesmo em outra aba: trocar de aba não perde o que está sendo editado. */}
        <div
          role="tabpanel"
          id={idDoPainelDaAba("padroes")}
          aria-labelledby={idDaAba("padroes")}
          hidden={aba !== "padroes"}
          className="configuracoes-do-app-aba"
        >
          <AbaDePadroesDasConfiguracoes aoSalvar={aoSalvarInstrucoes} />
        </div>
        {aba === "sistema" && (
          <div
            role="tabpanel"
            id={idDoPainelDaAba("sistema")}
            aria-labelledby={idDaAba("sistema")}
            className="configuracoes-do-app-aba"
          >
            <AbaDoSistema ajustes={ajustes} sistema={sistema} memoria={memoria} orquestradores={orquestradores} />
          </div>
        )}
        {aba === "conta" && (
          <div
            role="tabpanel"
            id={idDoPainelDaAba("conta")}
            aria-labelledby={idDaAba("conta")}
            className="configuracoes-do-app-aba"
          >
            <AbaDaConta cota={cota} />
          </div>
        )}
        {aba === "atualizacao" && (
          <div
            role="tabpanel"
            id={idDoPainelDaAba("atualizacao")}
            aria-labelledby={idDaAba("atualizacao")}
            className="configuracoes-do-app-aba"
          >
            <AbaDeAtualizacao pedidosEmAndamento={pedidosEmAndamento} />
          </div>
        )}
        {aba === "aparencia" && (
          <div
            role="tabpanel"
            id={idDoPainelDaAba("aparencia")}
            aria-labelledby={idDaAba("aparencia")}
            className="configuracoes-do-app-aba"
          >
            <AbaDeAparencia />
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------- Atualização ----------------

/** "0.2.1" (sem o "v" que algumas versões trazem). */
function semPrefixo(versao: string): string {
  return versao.trim().replace(/^v/i, "");
}

function AbaDeAtualizacao({ pedidosEmAndamento }: { pedidosEmAndamento: number }) {
  const t = useTextos(textosDeConfiguracoes).atualizacao;
  const { estado, erroAoInstalar, verificar, instalarAgora } = useAtualizacao();
  const [confirmando, setConfirmando] = useState(false);
  // Se os pedidos terminam com a confirmação na tela, ela some e reiniciar fica direto.
  const pedirConfirmacao = confirmando && pedidosEmAndamento > 0;

  if (estado === null) {
    return (
      <div className="cfgapp-cartao">
        <LinhaDaConfiguracao
          titulo={t.automaticas}
          descricao={t.soNoInstalado}
        />
      </div>
    );
  }

  const versaoAtual = semPrefixo(estado.versaoAtual);
  const titulo = versaoAtual === "" ? t.versaoDoApp : t.versao(versaoAtual);
  const versaoNova = estado.versaoNova === null ? null : semPrefixo(estado.versaoNova);
  const percentual = percentualDoDownload(estado.progresso);
  const podeVerificar = estado.situacao === "em-dia" || estado.situacao === "erro";

  let descricao: ReactNode;
  switch (estado.situacao) {
    case "indisponivel":
      descricao = t.indisponivel;
      break;
    case "verificando":
      descricao = t.verificando;
      break;
    case "em-dia":
      descricao = t.emDia;
      break;
    case "baixando":
      descricao = t.baixando(versaoNova, percentual);
      break;
    case "pronta":
      descricao = t.pronta(versaoNova);
      break;
    case "erro":
      descricao = t.erro(estado.mensagemDeErro?.trim() ?? "");
      break;
  }

  return (
    <div className="cfgapp-cartao">
      <LinhaDaConfiguracao titulo={titulo} descricao={descricao}>
        {podeVerificar && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => void verificar()}>
            {estado.situacao === "erro" ? t.tentarDeNovo : t.procurarAgora}
          </button>
        )}
        {estado.situacao === "pronta" && !pedirConfirmacao && (
          <button
            type="button"
            className="btn btn-sm btn-cta"
            onClick={() => (pedidosEmAndamento > 0 ? setConfirmando(true) : void instalarAgora())}
          >
            {t.reiniciarAgora}
          </button>
        )}
      </LinhaDaConfiguracao>
      {estado.situacao === "baixando" && percentual !== null && (
        <div className="cfgapp-progresso">
          <span className="medidor medidor-largo" role="progressbar" aria-label={t.downloadAria} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentual}>
            <span style={{ width: `${percentual}%` }} />
          </span>
        </div>
      )}
      {estado.situacao === "pronta" && pedirConfirmacao && (
        <div className="cfgapp-confirmacao">
          <p role="alert">{avisoDosPedidosEmAndamento(pedidosEmAndamento)}</p>
          <div className="cfgapp-confirmacao-botoes">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmando(false)}>
              {t.voltar}
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void instalarAgora()}>
              {t.reiniciarMesmoAssim}
            </button>
          </div>
        </div>
      )}
      {erroAoInstalar !== null && (
        <p className="hint-error cfgapp-erro-solto" role="alert">
          {erroAoInstalar}
        </p>
      )}
    </div>
  );
}

// ---------------- Aparência ----------------

/** Onde o chat rápido fica: no pé do canvas ou como coluna fixa de um dos lados. */
type PosicaoDoChat = "embaixo" | "esquerda" | "direita";

const ESTILOS_DOS_CONTROLES: readonly EstiloDosControlesDasJanelas[] = ["automatico", "mac", "windows"];

function AbaDeAparencia() {
  const t = useTextos(textosDeConfiguracoes);
  const a = t.aparencia;
  const idioma = useIdioma();
  const { preferencias, mudarPreferencias } = usePreferenciasDaTela();
  const posicoes: readonly OpcaoDoSegmentado<PosicaoDoChat>[] = [
    { valor: "embaixo", rotulo: a.embaixo, dica: a.embaixoDica },
    { valor: "esquerda", rotulo: a.esquerda, dica: a.esquerdaDica },
    { valor: "direita", rotulo: a.direita, dica: a.direitaDica },
  ];
  const estilos: readonly OpcaoDoSegmentado<EstiloDosControlesDasJanelas>[] = ESTILOS_DOS_CONTROLES.map((estilo) => ({
    valor: estilo,
    rotulo: t.estilosDosControles[estilo].rotulo,
    dica: t.estilosDosControles[estilo].dica,
  }));
  const posicao: PosicaoDoChat = preferencias.chatFixoNaEsquerda ? preferencias.ladoDoChatFixo : "embaixo";

  // "Embaixo" solta o chat e guarda o último lado: voltar a fixar lembra de onde estava.
  const escolherPosicao = (nova: PosicaoDoChat) =>
    mudarPreferencias(
      nova === "embaixo" ? { chatFixoNaEsquerda: false } : { chatFixoNaEsquerda: true, ladoDoChatFixo: nova },
    );

  return (
    <div className="cfgapp-cartao">
      <SegmentadoDaConfiguracao
        titulo={a.idiomaTitulo}
        descricao={a.idiomaDescricao}
        opcoes={OPCOES_DE_IDIOMA}
        valor={idioma}
        aoEscolher={definirIdioma}
      />
      <SegmentadoDaConfiguracao
        titulo={a.posicaoTitulo}
        descricao={a.posicaoDescricao}
        opcoes={posicoes}
        valor={posicao}
        aoEscolher={escolherPosicao}
      />
      <InterruptorDaConfiguracao
        titulo={a.visualizadorTitulo}
        descricao={a.visualizadorDescricao}
        ligado={preferencias.visualizadorDeCodigo}
        aoAlternar={() => mudarPreferencias({ visualizadorDeCodigo: !preferencias.visualizadorDeCodigo })}
      />
      <InterruptorDaConfiguracao
        titulo={a.bixinhosTitulo}
        descricao={a.bixinhosDescricao}
        ligado={preferencias.manterBixinhosAteLimpar}
        aoAlternar={() => mudarPreferencias({ manterBixinhosAteLimpar: !preferencias.manterBixinhosAteLimpar })}
      />
      <SegmentadoDaConfiguracao
        titulo={a.controlesTitulo}
        descricao={a.controlesDescricao}
        opcoes={estilos}
        valor={preferencias.controlesDasJanelas}
        aoEscolher={(estilo) => mudarPreferencias({ controlesDasJanelas: estilo })}
      />
    </div>
  );
}
