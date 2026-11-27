import { Handle, type NodeProps, NodeResizer, Position, useStoreApi } from "@xyflow/react";
import { memo, type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import { useAcoesDoCanvas, useSeletorDoCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DO_NAVEGADOR } from "../../shared/canvas/layout";
import { medirCorpo } from "../../shared/canvas/medirCorpo";
import { ALCA_DO_NAVEGADOR, type Ancora, type NoNavegadorDoAgente as TipoDoNo } from "../../shared/canvas/nos";
import {
  type ApiDoNavegadorDoAgente,
  apiDoNavegadorDoAgente,
  type EstadoDoNavegadorDoAgente,
} from "../../shared/canvas/ponteDoNavegador";
import { mesmoRetangulo, mesmoTamanho, type RetanguloDaVista } from "../../shared/previaNativa";
import { IconeNavegador, IconeRecarregar } from "../Icones";
import { BotoesDeNavegacao } from "./BotoesDeNavegacao";
import { ControlesDoNo } from "./ControlesDoNo";
import "../../theme/navegador-do-agente.css";

export const MENSAGEM_SEM_O_APP_DESKTOP =
  "O navegador do agente só funciona no aplicativo desktop. Abra o Orquestrador de Agentes pelo aplicativo para ver e controlar o navegador.";
export const MENSAGEM_SEM_NAVEGADOR_ABERTO =
  "O navegador ainda não foi aberto. O agente o abre sozinho quando precisar de um site.";

/** Espera depois de uma mudança na página (ou de a vista descer) até tirar a foto. */
export const ESPERA_DA_FOTO_MS = 200;
/** De quanto em quanto tempo a foto é renovada enquanto a vista nativa está por cima (ela precisa estar atual quando a vista descer). */
export const INTERVALO_DA_FOTO_MS = 2000;
/** Depois de recusada, quanto esperar até pedir para mostrar a vista de novo. */
const ESPERA_APOS_RECUSA_MS = 1500;
/** De quanto em quanto tempo, com o corpo parado, confere se algo da tela está por cima da vista. */
export const INTERVALO_DA_COBERTURA_MS = 120;
/**
 * Depois do último movimento do canvas (pan, zoom) ou da mudança de tamanho do corpo, quanto esperar até a vista
 * nativa subir de novo: enquanto o canvas se mexe, a vista fica embaixo e o corpo mostra a foto.
 */
export const ESPERA_APOS_MOVER_MS = 150;
/** Depois de descer por cobertura, quanto o corpo precisa ficar livre, sem interrupção, até a vista subir de novo. */
export const ESPERA_DA_COBERTURA_LIVRE_MS = 300;

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
 * A mesma foto cobre o pan, o zoom e o redimensionar do canvas e qualquer coisa que cubra o corpo (veja
 * `useVistaNativaDoNavegador`); o app mantém a página no tamanho de layout do corpo, então a foto tem a mesma
 * proporção dele.
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
 * Mantém a vista nativa do app sobre o corpo do nó: mostra com o retângulo INTEIRO do corpo (sem corte: x e y
 * podem ser negativos e a caixa pode passar da borda da janela, que corta; a página nunca é espremida) e o acompanha
 * a cada quadro. Ela desce (e o corpo passa a mostrar a foto) quando:
 * - o nó é arrastado (`ligada` falso);
 * - o canvas faz pan ou zoom, ou o corpo muda de tamanho (redimensionar, janela): o IPC de posição chega um quadro
 *   atrás e a vista se descolaria do nó, e redimensionar a cada quadro faria o site refazer o layout a cada quadro.
 *   Ela só volta `ESPERA_APOS_MOVER_MS` depois do último movimento;
 * - o corpo sai da tela, passa de uma borda do canvas que não é a da janela ou algo (painel, menu, ilha flutuante,
 *   outra janela) cobre o corpo. Depois de descer por cobertura, só sobe quando o corpo fica livre por
 *   `ESPERA_DA_COBERTURA_LIVRE_MS` seguidos (histerese: sem isso a vista sobe e desce sem parar).
 *
 * O pan e o zoom são detectados na hora, sem re-renderizar o nó: a escuta do `transform` do canvas
 * (`useStoreApi().subscribe`, uma por nó, sem ocupar o `onViewportChangeStart/End` do React Flow, que tem uma vaga
 * só por canvas) desce a vista antes do quadro seguinte. A mudança de tamanho do retângulo, medido a cada quadro,
 * cobre o zoom por outros caminhos e o redimensionar. Só a posição mudar (sem pan) segue sendo acompanhada.
 *
 * Ao desmontar (o nó fecha), a vista desce e o agente segue usando. Devolve se a vista está por cima agora.
 */
function useVistaNativaDoNavegador(
  api: ApiDoNavegadorDoAgente | null,
  orquestradorId: string,
  corpo: RefObject<HTMLDivElement | null>,
  ligada: boolean,
): boolean {
  const store = useStoreApi();
  const [mostrando, setMostrando] = useState(false);
  useEffect(() => {
    const elemento = corpo.current;
    if (api === null || elemento === null || !ligada) {
      return undefined;
    }
    let ativo = true;
    let quadro = 0;
    let naTela = false;
    let ultimo: RetanguloDaVista | null = null;
    let recusadaAte = 0;
    // Qual pedido de `mostrar` está valendo: a recusa tardia de um pedido antigo não derruba o atual.
    let pedido = 0;
    // O que o último teste de cobertura achou, e quando; o retângulo medido no quadro anterior.
    let coberta = false;
    let conferidaEm = Number.NEGATIVE_INFINITY;
    let anterior: RetanguloDaVista | null = null;
    // A vista só sobe depois destes instantes: o canvas parou de se mexer / o corpo ficou livre.
    let paradaAte = 0;
    let livreAPartirDe = 0;

    const descer = (): void => {
      naTela = false;
      ultimo = null;
      setMostrando(false);
    };
    const esconder = (): void => {
      if (naTela) {
        descer();
        semFalhar(api.ocultar(orquestradorId));
      }
    };
    const moveu = (): void => {
      paradaAte = Date.now() + ESPERA_APOS_MOVER_MS;
      esconder();
    };

    // Pan e zoom do canvas: o `transform` do React Flow muda. Escuta o store (não renderiza nada) e desce a vista
    // na hora, antes de o quadro seguinte ser desenhado.
    let transformAnterior = store.getState().transform;
    const cancelarEscuta = store.subscribe(({ transform }) => {
      if (
        transform[0] !== transformAnterior[0] ||
        transform[1] !== transformAnterior[1] ||
        transform[2] !== transformAnterior[2]
      ) {
        transformAnterior = transform;
        moveu();
      }
    });

    const passo = (): void => {
      if (!ativo) {
        return;
      }
      const agora = Date.now();
      // O retângulo é medido a cada quadro (barato); o teste de cobertura (nove pontos na tela, mais caro) roda
      // quando o corpo se mexe e, parado, de tempos em tempos: um menu ou painel por cima aparece parado.
      const medida = medirCorpo(elemento, { conferirCobertura: false, semCorte: true });
      if (medida === null) {
        anterior = null;
      } else {
        if (anterior !== null && !mesmoTamanho(anterior, medida.retangulo)) {
          moveu();
        }
        if (!mesmoRetangulo(anterior, medida.retangulo) || agora - conferidaEm >= INTERVALO_DA_COBERTURA_MS) {
          coberta = medirCorpo(elemento, { semCorte: true })?.coberta ?? false;
          conferidaEm = agora;
        }
        anterior = medida.retangulo;
      }
      if (medida === null || medida.coberta || coberta) {
        if (medida !== null) {
          // Coberta agora: a espera de corpo livre recomeça.
          livreAPartirDe = agora + ESPERA_DA_COBERTURA_LIVRE_MS;
        }
        esconder();
      } else if (!naTela) {
        if (agora >= recusadaAte && agora >= paradaAte && agora >= livreAPartirDe) {
          naTela = true;
          ultimo = medida.retangulo;
          setMostrando(true);
          const meuPedido = ++pedido;
          const recusar = (): void => {
            if (ativo && naTela && meuPedido === pedido) {
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
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);

    return () => {
      ativo = false;
      cancelAnimationFrame(quadro);
      cancelarEscuta();
      if (naTela) {
        semFalhar(api.ocultar(orquestradorId));
      }
      setMostrando(false);
    };
  }, [api, orquestradorId, corpo, ligada, store]);
  return mostrando;
}

/** Pede a foto à ponte uma de cada vez: um pedido que chega com outro em andamento é refeito quando o outro termina. */
interface CapturadorDeFoto {
  pedir: () => void;
  parar: () => void;
}

function criarCapturadorDeFoto(
  api: ApiDoNavegadorDoAgente,
  orquestradorId: string,
  aoReceber: (foto: string) => void,
): CapturadorDeFoto {
  let ativo = true;
  let emAndamento = false;
  let repetir = false;
  const pedir = (): void => {
    if (!ativo) {
      return;
    }
    if (emAndamento) {
      repetir = true;
      return;
    }
    emAndamento = true;
    // Uma captura que falha não apaga a foto que já estava.
    new Promise<string | null>((resolver) => resolver(api.foto(orquestradorId)))
      .then((nova) => {
        if (ativo && nova !== null) {
          aoReceber(nova);
        }
      })
      .catch(() => undefined)
      .then(() => {
        emAndamento = false;
        if (repetir) {
          repetir = false;
          pedir();
        }
      });
  };
  return {
    pedir,
    parar: () => {
      ativo = false;
    },
  };
}

/**
 * A foto da página (data URI), para o corpo mostrar enquanto a vista nativa está por baixo (pan, zoom, arrasto,
 * cobertura). Ela precisa estar atual no instante em que a vista desce, então é renovada nos dois estados:
 * - com a vista por baixo: `ESPERA_DA_FOTO_MS` depois de a vista descer ou de a página mudar (endereço,
 *   carregamento, última ação do agente);
 * - com a vista por cima: depois de a página mudar e, além disso, a cada `INTERVALO_DA_FOTO_MS` (pausa com a
 *   aba escondida). Subir a vista de novo não tira outra foto se a página não mudou.
 * Há no máximo uma captura em andamento. O app mantém a página no tamanho de layout do corpo, então a foto tem a
 * mesma proporção do corpo (o CSS a estica sem cortar).
 */
function useFotoDoNavegador(
  api: ApiDoNavegadorDoAgente | null,
  orquestradorId: string,
  aberto: boolean,
  mostrando: boolean,
  versaoDaPagina: string,
): string | null {
  const [foto, setFoto] = useState<string | null>(null);
  const capturador = useRef<CapturadorDeFoto | null>(null);
  // A versão da página na última foto pedida: com a vista por cima, só uma página nova pede foto na hora.
  const versaoFotografada = useRef<string | null>(null);

  useEffect(() => {
    if (api === null || !aberto) {
      return undefined;
    }
    const meu = criarCapturadorDeFoto(api, orquestradorId, setFoto);
    capturador.current = meu;
    return () => {
      meu.parar();
      capturador.current = null;
      versaoFotografada.current = null;
    };
  }, [api, orquestradorId, aberto]);

  useEffect(() => {
    const atual = capturador.current;
    if (atual === null) {
      return undefined;
    }
    const pedir = (): void => {
      versaoFotografada.current = versaoDaPagina;
      atual.pedir();
    };
    const espera =
      !mostrando || versaoFotografada.current !== versaoDaPagina ? setTimeout(pedir, ESPERA_DA_FOTO_MS) : undefined;
    const periodica = mostrando
      ? setInterval(() => {
          if (!document.hidden) {
            pedir();
          }
        }, INTERVALO_DA_FOTO_MS)
      : undefined;
    return () => {
      clearTimeout(espera);
      clearInterval(periodica);
    };
    // `api`, `orquestradorId` e `aberto` recriam o capturador (primeiro efeito): este precisa rodar de novo.
  }, [api, orquestradorId, aberto, mostrando, versaoDaPagina]);
  return foto;
}

interface PropsDaJanela {
  orquestradorId: string;
  /** O nó está sendo arrastado: a vista nativa desce (e fica a foto) até soltar. */
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

      {/* Aqui a vista nativa se encaixa (com o retângulo inteiro); a foto (ou a mensagem) fica por baixo dela. */}
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
