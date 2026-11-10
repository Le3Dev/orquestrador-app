import { type KeyboardEvent as EventoDeTeclado, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import { avisoDosPedidosEmAndamento, percentualDoDownload } from "../../shared/atualizacao";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { useAtualizacao } from "../../shared/hooks/useAtualizacao";
import { definirAutorrecuperacao, useValorDaAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import {
  type EstiloDosControlesDasJanelas,
  usePreferenciasDaTela,
} from "../../shared/hooks/usePreferenciasDaTela";
import "../../theme/configuracoes-do-app.css";
import { IconeFechar } from "../Icones";
import { AbaDePadroesDasConfiguracoes } from "./AbaDePadroesDasConfiguracoes";
import {
  InterruptorDaConfiguracao,
  LinhaDaConfiguracao,
  type OpcaoDoSegmentado,
  SegmentadoDaConfiguracao,
} from "./ControlesDasConfiguracoes";

export type AbaDasConfiguracoes = "padroes" | "sistema" | "conta" | "atualizacao" | "aparencia";

/**
 * As abas que existem, na ordem. "conta" está no tipo (o contrato das ilhas),
 * mas o app não tem dado real de conta (e-mail, plano, cota por conta): sem
 * dado, a aba não aparece. Quando houver, entra aqui.
 */
const ABAS: readonly { aba: AbaDasConfiguracoes; rotulo: string }[] = [
  { aba: "padroes", rotulo: "Padrões" },
  { aba: "sistema", rotulo: "Sistema" },
  { aba: "atualizacao", rotulo: "Atualização" },
  { aba: "aparencia", rotulo: "Aparência" },
];

/** O topo do painel por padrão: logo abaixo da ilha da direita (topo 16 + altura 48 + respiro). */
const TOPO_PADRAO = 72;

interface Props {
  /** Os Ajustes do app desktop (pastas e Claude Code). */
  ajustes: AjustesDoAplicativo;
  aberto: boolean;
  aoFechar: () => void;
  /** A aba que abre selecionada; "conta" (sem dado) e o que não existe valem Padrões. */
  abaInicial?: AbaDasConfiguracoes;
  /** O status de memória, cota e bixinhos que a aba Sistema mostra no topo. */
  sistema?: ReactNode;
  /** Pedidos rodando agora: reiniciar para instalar a atualização os cancela. */
  pedidosEmAndamento?: number;
  /** Depois de salvar as instruções gerais: a página recarrega o que depende delas. */
  aoSalvarInstrucoes?: () => void;
  /** Distância do topo do contêiner, em px (há notificações empilhadas no canto). */
  topo?: number;
}

/**
 * Configurações do app como painel com abas (Padrões, Sistema, Atualização e
 * Aparência), à direita da área do canvas: o contêiner é `relative` e o painel
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
  pedidosEmAndamento = 0,
  aoSalvarInstrucoes,
  topo = TOPO_PADRAO,
}: Props) {
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
      aria-label="Configurações"
      className="configuracoes-do-app painel-flutuante surgir no-drag"
      style={{ top: topo, maxHeight: `calc(100% - ${topo + 16}px)` }}
    >
      <header className="configuracoes-do-app-cabecalho">
        <div className="min-w-0">
          <span className="text-support">Computador e app</span>
          <h2 className="text-[16px]">Configurações</h2>
        </div>
        <button type="button" className="botao-icone shrink-0" aria-label="Fechar Configurações" title="Fechar (Esc)" onClick={aoFechar}>
          <IconeFechar tamanho={16} />
        </button>
      </header>

      <div className="configuracoes-do-app-abas" role="tablist" aria-label="Seções de Configurações">
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
            {item.rotulo}
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
            <AbaDeSistema ajustes={ajustes} sistema={sistema} />
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

// ---------------- Sistema ----------------

const DICA_DA_AUTORRECUPERACAO = "Retoma sozinho quando o Claude trava ou a API falha.";

function AbaDeSistema({ ajustes, sistema }: { ajustes: AjustesDoAplicativo; sistema?: ReactNode }) {
  // A autorrecuperação vale para todos os orquestradores: fica no servidor, não no navegador.
  const autorrecuperacao = useValorDaAutorrecuperacao();
  const [lendo, setLendo] = useState(true);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Uma gravação começada depois da leitura vence a resposta dela.
  const gravacoes = useRef(0);

  // Relê a cada vez que a aba abre: outra janela pode ter mudado.
  useEffect(() => {
    let vivo = true;
    const gravacoesAntes = gravacoes.current;
    api
      .lerPreferencias()
      .then((lidas) => {
        if (vivo && gravacoes.current === gravacoesAntes) {
          definirAutorrecuperacao(lidas.autorrecuperacao);
        }
      })
      .catch((falha: unknown) => {
        if (vivo) {
          setErro(mensagemDeErro(falha));
        }
      })
      .finally(() => {
        if (vivo) {
          setLendo(false);
        }
      });
    return () => {
      vivo = false;
    };
  }, []);

  const alternarAutorrecuperacao = () => {
    if (autorrecuperacao === null || gravando) {
      return;
    }
    const nova = !autorrecuperacao;
    gravacoes.current += 1;
    setErro(null);
    setGravando(true);
    definirAutorrecuperacao(nova);
    api
      .alterarPreferencias({ autorrecuperacao: nova })
      .then((gravadas) => definirAutorrecuperacao(gravadas.autorrecuperacao ?? nova))
      .catch((falha: unknown) => {
        definirAutorrecuperacao(!nova);
        setErro(mensagemDeErro(falha));
      })
      .finally(() => setGravando(false));
  };

  const situacao =
    erro ?? (autorrecuperacao === null ? (lendo ? "Carregando…" : "Não deu para ler.") : DICA_DA_AUTORRECUPERACAO);

  return (
    <>
      {sistema}
      <h3 className="cfgapp-titulo">Orquestradores</h3>
      <div className="cfgapp-cartao">
        <InterruptorDaConfiguracao
          titulo="Autorrecuperação"
          descricao={situacao}
          comErro={erro !== null}
          ligado={autorrecuperacao ?? false}
          indisponivel={autorrecuperacao === null || gravando}
          ocupado={lendo || gravando}
          aoAlternar={alternarAutorrecuperacao}
        />
        {ajustes.disponivel && (
          <LinhaDaConfiguracao titulo="Pastas e Claude Code" descricao="Pasta dos projetos e o executável do Claude Code.">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => void ajustes.abrir()}>
              Pastas e Claude Code…
            </button>
          </LinhaDaConfiguracao>
        )}
      </div>
    </>
  );
}

// ---------------- Atualização ----------------

/** "0.2.1" (sem o "v" que algumas versões trazem). */
function semPrefixo(versao: string): string {
  return versao.trim().replace(/^v/i, "");
}

function AbaDeAtualizacao({ pedidosEmAndamento }: { pedidosEmAndamento: number }) {
  const { estado, erroAoInstalar, verificar, instalarAgora } = useAtualizacao();
  const [confirmando, setConfirmando] = useState(false);
  // Se os pedidos terminam com a confirmação na tela, ela some e reiniciar fica direto.
  const pedirConfirmacao = confirmando && pedidosEmAndamento > 0;

  if (estado === null) {
    return (
      <div className="cfgapp-cartao">
        <LinhaDaConfiguracao
          titulo="Atualizações automáticas"
          descricao="Funcionam só no app instalado. Aqui, no navegador, não há o que verificar."
        />
      </div>
    );
  }

  const versaoAtual = semPrefixo(estado.versaoAtual);
  const titulo = versaoAtual === "" ? "Versão do app" : `Versão ${versaoAtual}`;
  const versaoNova = estado.versaoNova === null ? "A nova versão" : `A versão ${semPrefixo(estado.versaoNova)}`;
  const percentual = percentualDoDownload(estado.progresso);
  const podeVerificar = estado.situacao === "em-dia" || estado.situacao === "erro";

  let descricao: ReactNode;
  switch (estado.situacao) {
    case "indisponivel":
      descricao = "As atualizações só funcionam no app instalado.";
      break;
    case "verificando":
      descricao = "Procurando atualizações…";
      break;
    case "em-dia":
      descricao = "Você está na versão mais recente.";
      break;
    case "baixando":
      descricao = `${versaoNova} está sendo baixada${percentual === null ? "" : ` (${percentual}%)`} e será instalada quando você fechar o app.`;
      break;
    case "pronta":
      descricao = `${versaoNova} foi baixada. Ela será instalada quando você fechar o app, ou reinicie agora.`;
      break;
    case "erro":
      descricao =
        estado.mensagemDeErro === null || estado.mensagemDeErro.trim() === ""
          ? "Não foi possível verificar."
          : `Não foi possível verificar: ${estado.mensagemDeErro.trim()}`;
      break;
  }

  return (
    <div className="cfgapp-cartao">
      <LinhaDaConfiguracao titulo={titulo} descricao={descricao}>
        {podeVerificar && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => void verificar()}>
            {estado.situacao === "erro" ? "Tentar de novo" : "Procurar agora"}
          </button>
        )}
        {estado.situacao === "pronta" && !pedirConfirmacao && (
          <button
            type="button"
            className="btn btn-sm btn-cta"
            onClick={() => (pedidosEmAndamento > 0 ? setConfirmando(true) : void instalarAgora())}
          >
            Reiniciar agora
          </button>
        )}
      </LinhaDaConfiguracao>
      {estado.situacao === "baixando" && percentual !== null && (
        <div className="cfgapp-progresso">
          <span className="medidor medidor-largo" role="progressbar" aria-label="Download da atualização" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentual}>
            <span style={{ width: `${percentual}%` }} />
          </span>
        </div>
      )}
      {estado.situacao === "pronta" && pedirConfirmacao && (
        <div className="cfgapp-confirmacao">
          <p role="alert">{avisoDosPedidosEmAndamento(pedidosEmAndamento)}</p>
          <div className="cfgapp-confirmacao-botoes">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmando(false)}>
              Voltar
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void instalarAgora()}>
              Reiniciar mesmo assim
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

const POSICOES_DO_CHAT: readonly OpcaoDoSegmentado<PosicaoDoChat>[] = [
  { valor: "embaixo", rotulo: "Embaixo", dica: "O chat rápido flutua no pé do canvas" },
  { valor: "esquerda", rotulo: "Esquerda", dica: "O chat rápido vira uma coluna fixa à esquerda do canvas" },
  { valor: "direita", rotulo: "Direita", dica: "O chat rápido vira uma coluna fixa à direita do canvas" },
];

const ESTILOS_DOS_CONTROLES: readonly OpcaoDoSegmentado<EstiloDosControlesDasJanelas>[] = [
  { valor: "automatico", rotulo: "Automático", dica: "Os controles das janelas seguem o sistema" },
  { valor: "mac", rotulo: "Estilo Mac", dica: "Bolinhas à esquerda do cabeçalho das janelas" },
  { valor: "windows", rotulo: "Estilo Windows", dica: "Botões à direita do cabeçalho das janelas" },
];

function AbaDeAparencia() {
  const { preferencias, mudarPreferencias } = usePreferenciasDaTela();
  const posicao: PosicaoDoChat = preferencias.chatFixoNaEsquerda ? preferencias.ladoDoChatFixo : "embaixo";

  // "Embaixo" solta o chat e guarda o último lado: voltar a fixar lembra de onde estava.
  const escolherPosicao = (nova: PosicaoDoChat) =>
    mudarPreferencias(
      nova === "embaixo" ? { chatFixoNaEsquerda: false } : { chatFixoNaEsquerda: true, ladoDoChatFixo: nova },
    );

  return (
    <div className="cfgapp-cartao">
      <SegmentadoDaConfiguracao
        titulo="Posição do chat"
        descricao="Barra no pé do canvas ou coluna fixa ao lado."
        opcoes={POSICOES_DO_CHAT}
        valor={posicao}
        aoEscolher={escolherPosicao}
      />
      <InterruptorDaConfiguracao
        titulo="Visualizador de código"
        descricao="Mostra o botão Arquivos nos terminais."
        ligado={preferencias.visualizadorDeCodigo}
        aoAlternar={() => mudarPreferencias({ visualizadorDeCodigo: !preferencias.visualizadorDeCodigo })}
      />
      <InterruptorDaConfiguracao
        titulo="Manter bixinhos até limpar à mão"
        descricao="Desligado, os que terminam saem sozinhos do canvas."
        ligado={preferencias.manterBixinhosAteLimpar}
        aoAlternar={() => mudarPreferencias({ manterBixinhosAteLimpar: !preferencias.manterBixinhosAteLimpar })}
      />
      <SegmentadoDaConfiguracao
        titulo="Controles das janelas"
        descricao="Como as janelas do canvas desenham fechar, minimizar e ampliar."
        opcoes={ESTILOS_DOS_CONTROLES}
        valor={preferencias.controlesDasJanelas}
        aoEscolher={(estilo) => mudarPreferencias({ controlesDasJanelas: estilo })}
      />
    </div>
  );
}
