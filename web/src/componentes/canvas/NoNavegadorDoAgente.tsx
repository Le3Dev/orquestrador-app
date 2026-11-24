import { Handle, type NodeProps, NodeResizer, Position, useStoreApi } from "@xyflow/react";
import { memo, type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import { useAcoesDoCanvas, useSeletorDoCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DO_NAVEGADOR } from "../../shared/canvas/layout";
import { acompanharCorpo } from "../../shared/canvas/medirCorpo";
import { ALCA_DO_NAVEGADOR, type Ancora, type NoNavegadorDoAgente as TipoDoNo } from "../../shared/canvas/nos";
import {
  type ApiDoNavegadorDoAgente,
  apiDoNavegadorDoAgente,
  type EstadoDoNavegadorDoAgente,
} from "../../shared/canvas/ponteDoNavegador";
import { mesmoRetangulo, type RetanguloDaVista } from "../../shared/previaNativa";
import { IconeNavegador, IconeRecarregar } from "../Icones";
import { BotoesDeNavegacao } from "./BotoesDeNavegacao";
import { ControlesDoNo } from "./ControlesDoNo";
import "../../theme/navegador-do-agente.css";

export const MENSAGEM_SEM_O_APP_DESKTOP =
  "O navegador do agente só funciona no aplicativo desktop. Abra o Orquestrador de Agentes pelo aplicativo para ver e controlar o navegador.";
export const MENSAGEM_SEM_NAVEGADOR_ABERTO =
  "O navegador ainda não foi aberto. O agente o abre sozinho quando precisar de um site.";

/** Espera depois de uma mudança na página até tirar a foto (só com a vista nativa por baixo). */
export const ESPERA_DA_FOTO_MS = 200;
/** Depois de recusada, quanto esperar até pedir para mostrar a vista de novo. */
const ESPERA_APOS_RECUSA_MS = 1500;

/** As alças de redimensionar. Memorizadas: o arraste não as re-renderiza a cada quadro. */
const RedimensionadorDoNavegador = memo(function RedimensionadorDoNavegador({ visivel }: { visivel: boolean }) {
  return (
    <NodeResizer
      isVisible={visivel}
      minWidth={TAMANHO_MINIMO_DO_NAVEGADOR.largura}
      minHeight={TAMANHO_MINIMO_DO_NAVEGADOR.altura}
      lineClassName="redimensionador-linha"
      handleClassName="redimensionador-alca"
    />
  );
});

/** Onde chega a linha do terminal de que o navegador saiu: o meio de cada lado (`ladoDaPrevia`). */
const ANCORAS_DO_NAVEGADOR: readonly { id: Ancora; posicao: Position }[] = [
  { id: "cima", posicao: Position.Top },
  { id: "baixo", posicao: Position.Bottom },
  { id: "esquerda", posicao: Position.Left },
  { id: "direita", posicao: Position.Right },
];

const AncorasDoNavegador = memo(function AncorasDoNavegador() {
  return (
    <>
      {ANCORAS_DO_NAVEGADOR.map(({ id, posicao }) => (
        <Handle key={id} id={id} type="target" position={posicao} className="ancora" isConnectable={false} />
      ))}
    </>
  );
});

/**
 * O navegador do agente de um Orquestrador no canvas: o Chromium que os agentes controlam (no app desktop),
 * com o título e o endereço da página (só leitura: quem navega é o agente), voltar, avançar e recarregar, o
 * botão de assumir o controle (que pausa o agente) e de devolvê-lo, a faixa de quem está no controle e a última
 * ação do agente. Arrasta pela barra de título e redimensiona pelas bordas quando selecionado.
 *
 * Aqui fica só a moldura (o React Flow re-renderiza o nó a cada quadro do arraste); a janela é memorizada. `dragging`
 * só muda no começo e no fim do arraste: enquanto o nó é arrastado, a vista nativa desce e o corpo mostra a foto.
 */
export const NoNavegadorDoAgente = memo(function NoNavegadorDoAgente({ data, selected, dragging }: NodeProps<TipoDoNo>) {
  return (
    <>
      <RedimensionadorDoNavegador visivel={selected} />
      <AncorasDoNavegador />
      <JanelaDoNavegador orquestradorId={data.orquestradorId} arrastando={dragging === true} />
    </>
  );
});

/**
 * O estado do navegador de um Orquestrador: o que o app já tem aberto (`estados`) e cada mudança (`aoMudar`).
 * Nulo sem a ponte, ou enquanto o navegador não foi aberto (o agente ainda não o usou).
 */
function useEstadoDoNavegador(
  api: ApiDoNavegadorDoAgente | null,
  orquestradorId: string,
): EstadoDoNavegadorDoAgente | null {
  const [estado, setEstado] = useState<EstadoDoNavegadorDoAgente | null>(null);
  useEffect(() => {
    if (api === null) {
      return undefined;
    }
    let ativo = true;
    const cancelar = api.aoMudar((novo) => {
      if (ativo && novo.orquestradorId === orquestradorId) {
        setEstado(novo);
      }
    });
    // O que já estava aberto antes de o nó existir; uma mudança que chegou antes da resposta vale mais.
    api
      .estados()
      .then((abertos) => {
        const meu = abertos.find((aberto) => aberto.orquestradorId === orquestradorId);
        if (ativo && meu !== undefined) {
          setEstado((atual) => atual ?? meu);
        }
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
      cancelar();
    };
  }, [api, orquestradorId]);
  return estado;
}

/** Uma chamada à ponte cujo resultado não importa: se o app falhar, a tela segue (a vista só fica onde estava). */
function semFalhar(chamada: Promise<unknown>): void {
  void Promise.resolve(chamada).catch(() => undefined);
}

/**
 * Mantém a vista nativa do app sobre o corpo do nó: mostra com o retângulo do corpo e o acompanha a cada quadro
 * enquanto algo se mexe (zoom e pan do canvas, redimensionar); parado, confere de tempos em tempos
 * (`acompanharCorpo`). Ela desce (e o corpo passa a mostrar a foto) quando o nó
 * é arrastado, o corpo sai da tela ou algo (painel, menu, outra janela) cobre o corpo. Ao desmontar (o nó fecha),
 * a vista desce e o agente segue usando. Devolve se a vista está por cima agora.
 */
function useVistaNativaDoNavegador(
  api: ApiDoNavegadorDoAgente | null,
  orquestradorId: string,
  corpo: RefObject<HTMLDivElement | null>,
  ligada: boolean,
): boolean {
  const [mostrando, setMostrando] = useState(false);
  const loja = useStoreApi();
  useEffect(() => {
    const elemento = corpo.current;
    if (api === null || elemento === null || !ligada) {
      return undefined;
    }
    let ativo = true;
    let naTela = false;
    let ultimo: RetanguloDaVista | null = null;
    let recusadaAte = 0;

    const descer = (): void => {
      naTela = false;
      ultimo = null;
      setMostrando(false);
    };
    const pararDeAcompanhar = acompanharCorpo(elemento, loja, (medida) => {
      if (!ativo) {
        return;
      }
      if (medida === null || medida.coberta) {
        if (naTela) {
          descer();
          semFalhar(api.ocultar(orquestradorId));
        }
      } else if (!naTela) {
        if (Date.now() >= recusadaAte) {
          naTela = true;
          ultimo = medida.retangulo;
          setMostrando(true);
          const recusar = (): void => {
            if (ativo && naTela) {
              recusadaAte = Date.now() + ESPERA_APOS_RECUSA_MS;
              descer();
            }
          };
          // O app recusou (sem navegador aberto, modo invisível) ou falhou: fica a foto, e tenta de novo depois.
          void Promise.resolve(api.mostrar(orquestradorId, medida.retangulo))
            .then((aceita) => {
              if (!aceita) {
                recusar();
              }
            })
            .catch(recusar);
        }
      } else if (!mesmoRetangulo(ultimo, medida.retangulo)) {
        ultimo = medida.retangulo;
        api.posicionar(orquestradorId, medida.retangulo);
      }
    });

    return () => {
      ativo = false;
      pararDeAcompanhar();
      if (naTela) {
        semFalhar(api.ocultar(orquestradorId));
      }
      setMostrando(false);
    };
  }, [api, loja, orquestradorId, corpo, ligada]);
  return mostrando;
}

/**
 * A foto da página (data URI), para o corpo mostrar enquanto a vista nativa está por baixo. É refeita quando a
 * página muda (endereço, carregamento, última ação do agente), só com a vista por baixo.
 */
function useFotoDoNavegador(
  api: ApiDoNavegadorDoAgente | null,
  orquestradorId: string,
  aberto: boolean,
  mostrando: boolean,
  versaoDaPagina: string,
): string | null {
  const [foto, setFoto] = useState<string | null>(null);
  useEffect(() => {
    if (api === null || !aberto || mostrando) {
      return undefined;
    }
    let ativo = true;
    const espera = setTimeout(() => {
      api
        .foto(orquestradorId)
        .then((nova) => {
          if (ativo && nova !== null) {
            setFoto(nova);
          }
        })
        .catch(() => undefined);
    }, ESPERA_DA_FOTO_MS);
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [api, orquestradorId, aberto, mostrando, versaoDaPagina]);
  return foto;
}

interface PropsDaJanela {
  orquestradorId: string;
  /** O nó está sendo arrastado: a vista nativa desce até soltar. */
  arrastando: boolean;
}

const JanelaDoNavegador = memo(function JanelaDoNavegador({ orquestradorId, arrastando }: PropsDaJanela) {
  const acoes = useAcoesDoCanvas();
  const nomeDoOrquestrador = useSeletorDoCanvas((canvas) => canvas.orquestradores.get(orquestradorId)?.nome);
  const [api] = useState(apiDoNavegadorDoAgente);
  const estado = useEstadoDoNavegador(api, orquestradorId);
  const corpo = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [trocandoDeMao, setTrocandoDeMao] = useState(false);
  const aberto = estado !== null;
  const pausado = estado?.pausado === true;
  const emUso = estado?.emUsoPeloAgente === true;

  const mostrando = useVistaNativaDoNavegador(api, orquestradorId, corpo, aberto && !arrastando);
  const foto = useFotoDoNavegador(
    api,
    orquestradorId,
    aberto,
    mostrando,
    estado === null ? "" : `${estado.url}|${estado.carregando}|${estado.ultimaAcao ?? ""}`,
  );

  const fechar = useCallback(() => acoes.fecharNavegador?.(orquestradorId), [acoes, orquestradorId]);

  /** Assumir pausa o agente (os comandos dele são recusados); devolver o retoma. O estado novo chega por `aoMudar`. */
  async function trocarDeMao(): Promise<void> {
    if (api === null) {
      return;
    }
    setErro(null);
    setTrocandoDeMao(true);
    try {
      if (pausado) {
        await api.retomar(orquestradorId);
      } else {
        await api.pausar(orquestradorId);
      }
    } catch (falha) {
      setErro(
        `${pausado ? "Não foi possível devolver o navegador ao agente" : "Não foi possível assumir o navegador"}: ${mensagemDeErro(falha)}`,
      );
    } finally {
      setTrocandoDeMao(false);
    }
  }

  /** Voltar, avançar e recarregar são do usuário: só com o agente pausado, e só se o app os oferece. */
  async function comandar(comando: ((id: string) => Promise<boolean>) | undefined): Promise<void> {
    if (comando === undefined) {
      return;
    }
    setErro(null);
    try {
      await comando(orquestradorId);
    } catch (falha) {
      setErro(`Não foi possível navegar: ${mensagemDeErro(falha)}`);
    }
  }

  const titulo = estado?.titulo ?? "";
  const url = estado?.url ?? "";
  const podeNavegar = pausado && api !== null;
  const podeVoltar = podeNavegar && estado?.podeVoltar === true && api.voltar !== undefined;
  const podeAvancar = podeNavegar && estado?.podeAvancar === true && api.avancar !== undefined;
  const podeRecarregar = podeNavegar && url !== "" && api.recarregar !== undefined;

  const controlesDaJanela = {
    objeto: "o navegador do agente",
    aoFechar: fechar,
    dicaDoFechar: "Fechar o navegador no canvas (o agente continua podendo usá-lo)",
  };

  const faixa = pausado ? (
    <div className="faixa-do-navegador faixa-do-navegador-voce" role="status">
      Você assumiu o controle · o agente está pausado
    </div>
  ) : emUso ? (
    <div className="faixa-do-navegador faixa-do-navegador-agente" role="status">
      <span className="pulso-do-agente" aria-hidden="true" />
      Agente no controle
      {estado?.carregando === true && <span className="font-normal text-secondary">· carregando a página…</span>}
    </div>
  ) : (
    <div className="faixa-do-navegador" role="status">
      {api === null
        ? "Indisponível fora do aplicativo desktop"
        : aberto
          ? `Agente em espera${estado.carregando ? " · carregando a página…" : ""}`
          : "Aguardando o agente"}
    </div>
  );

  return (
    <div
      className={`janela-navegador ${emUso && !pausado ? "janela-navegador-em-uso" : ""} ${pausado ? "janela-navegador-pausada" : ""}`}
      role="group"
      aria-label={`Navegador do agente${nomeDoOrquestrador === undefined ? "" : ` de ${nomeDoOrquestrador}`}`}
    >
      <div className={`barra-do-navegador ${ALCA_DO_NAVEGADOR}`}>
        <ControlesDoNo lado="inicio" {...controlesDaJanela} />
        <IconeNavegador className="shrink-0 text-info" />
        <strong className="titulo-do-navegador truncate" title={titulo === "" ? undefined : titulo}>
          {titulo === "" ? "Navegador do agente" : titulo}
        </strong>
        <input
          readOnly
          className="endereco-do-navegador nodrag"
          aria-label="Endereço da página"
          title={url === "" ? "Quem navega é o agente" : `${url} · quem navega é o agente`}
          placeholder="sem página aberta"
          spellCheck={false}
          value={url}
        />
        <BotoesDeNavegacao
          podeVoltar={podeVoltar}
          podeAvancar={podeAvancar}
          aoVoltar={() => void comandar(api?.voltar)}
          aoAvancar={() => void comandar(api?.avancar)}
        />
        <button
          type="button"
          className="botao-icone nodrag"
          title={pausado ? "Recarregar a página" : "Assuma o controle para recarregar a página"}
          aria-label="Recarregar a página"
          disabled={!podeRecarregar}
          onClick={() => void comandar(api?.recarregar)}
        >
          <IconeRecarregar />
        </button>
        <button
          type="button"
          className={`btn btn-sm nodrag botao-de-assumir ${pausado ? "btn-cta" : "btn-outline"}`}
          title={
            pausado
              ? "O agente volta a poder usar o navegador"
              : "Pausa o agente e deixa o navegador com você: ele recusa os comandos até você devolver"
          }
          disabled={!aberto || trocandoDeMao}
          aria-busy={trocandoDeMao}
          onClick={() => void trocarDeMao()}
        >
          {pausado ? "Devolver ao agente" : "Assumir"}
        </button>
        <ControlesDoNo lado="fim" {...controlesDaJanela} />
      </div>

      {faixa}

      {/* Aqui a vista nativa se encaixa; a foto (ou a mensagem) fica por baixo dela. */}
      <div ref={corpo} className="corpo-do-navegador">
        {api === null ? (
          <p className="mensagem-da-previa">{MENSAGEM_SEM_O_APP_DESKTOP}</p>
        ) : !aberto ? (
          <p className="mensagem-da-previa">{MENSAGEM_SEM_NAVEGADOR_ABERTO}</p>
        ) : foto !== null ? (
          <img className="foto-do-navegador" src={foto} alt={`Foto da página ${titulo === "" ? url : titulo}`} draggable={false} />
        ) : (
          <p className="mensagem-da-previa">{estado.carregando ? "Carregando a página…" : "Sem página aberta."}</p>
        )}
      </div>

      <div className="rodape-do-navegador">
        {erro !== null ? (
          <span role="alert" className="texto-da-acao text-error">
            {erro}
          </span>
        ) : (
          <>
            <span className="shrink-0">última ação</span>
            <span className="texto-da-acao" title={estado?.ultimaAcao ?? undefined}>
              {estado?.ultimaAcao ?? "nenhuma ainda"}
            </span>
          </>
        )}
      </div>
    </div>
  );
});
