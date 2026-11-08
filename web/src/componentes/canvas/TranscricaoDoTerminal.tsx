import { memo, type ReactNode, useEffect, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaConfiguracao, NomeDaPredefinicao, SinalDeVida } from "../../shared/api/tipos";
import { aparenciaDoBixinho } from "../../shared/canvas/bixinhos";
import {
  type AvisosDaConversaNova,
  CAUSAS_LEGIVEIS,
  type LinhaDoLog,
  type RecuperacaoNaTela,
  SEM_AVISOS_DA_CONVERSA_NOVA,
  type TipoDeLinhaDoLog,
  type TurnoNaTela,
} from "../../shared/estado/aplicarEvento";
import { faseDoTurno } from "../../shared/estado/faseDoTurno";
import { type EstadoDeVida, estadoDeVida } from "../../shared/estado/sinalDeVida";
import { useAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import "../../theme/recuperacao-do-turno.css";
import {
  descreverConfiguracao,
  formatarDuracao,
  formatarHora,
  formatarMomento,
  formatarTokens,
  idCurto,
} from "../../shared/formatacao";
import { useRelogio } from "../../shared/hooks/useRelogio";
import { IconeAlerta, IconeCoracao, IconeOrquestrador, IconeRaio } from "../Icones";
import { CartaoDePergunta } from "../chat/CartaoDePergunta";
import { TextoFormatado } from "../TextoFormatado";
import { type AcoesDoPlano, CartaoDoPlano } from "./CartaoDoPlano";
import { CustoDoTurno } from "./CustoDoTurno";

const SIMBOLOS: Readonly<Record<TipoDeLinhaDoLog, ReactNode>> = {
  sistema: "○",
  spawn: <IconeRaio className="inline-block align-[-1px]" />,
  ferramenta: "·",
  texto: "◆",
  fim: "✓",
  erro: "✗",
};

const QUADROS_DO_GIRADOR = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** O "spinner" dos terminais. Só existe enquanto há trabalho em andamento. */
function Girador() {
  const [quadro, setQuadro] = useState(0);
  useEffect(() => {
    const intervalo = setInterval(() => setQuadro((atual) => (atual + 1) % QUADROS_DO_GIRADOR.length), 90);
    return () => clearInterval(intervalo);
  }, []);
  return <span className="text-active">{QUADROS_DO_GIRADOR[quadro]}</span>;
}

/** Memorizada: as linhas do log não mudam depois de criadas, só chegam novas. */
const LinhaDoTerminal = memo(function LinhaDoTerminal({ linha }: { linha: LinhaDoLog }) {
  const doOrquestrador = linha.origem === "orquestrador";
  const origem = doOrquestrador ? "orquestrador" : `${aparenciaDoBixinho(linha.origem).nome}#${idCurto(linha.origem)}`;
  return (
    <div className={`linha-do-terminal linha-${linha.tipo}`}>
      <span className="text-muted">{formatarHora(linha.em)}</span>
      <span className="linha-simbolo">{SIMBOLOS[linha.tipo]}</span>
      <span className={doOrquestrador ? "linha-origem-orquestrador" : "linha-origem-bixinho"}>{origem}</span>
      <span className="linha-texto" title={linha.texto}>
        {linha.texto}
      </span>
    </div>
  );
});

/**
 * O Claude pode ter travado (pelo diagnóstico do servidor ou só pelo tempo de
 * silêncio). Com a autorrecuperação ligada, o app retoma sozinho; desligada,
 * ou quando o servidor não vê os processos (`semRetomada`), vale a orientação
 * de cancelar e reenviar. A preferência só é lida aqui, com o aviso na tela.
 */
function AvisoDeSuspeita({ aviso, semRetomada = false }: { aviso: string; semRetomada?: boolean }) {
  const autorrecuperacao = useAutorrecuperacao();
  const orientacao = autorrecuperacao && !semRetomada
    ? "O app retoma sozinho se travar."
    : "Se continuar assim, cancele (esc) e reenvie.";
  return <>{`${aviso} ${orientacao}`}</>;
}

/** O texto do sinal de vida: o diagnóstico do servidor, quando há, ou o tempo de silêncio. */
function TextoDoSinal({ vida }: { vida: EstadoDeVida }) {
  if (vida.diagnostico?.situacao === "trabalhando") {
    // Calado, mas trabalhando (um comando longo): sem tom de alarme.
    return <>{vida.diagnostico.resumo}</>;
  }
  if (vida.diagnostico?.situacao === "suspeito") {
    return (
      <AvisoDeSuspeita
        aviso={`sem notícias do Claude há ${formatarDuracao(vida.ultimoSinalHaMs)}: ${vida.diagnostico.resumo}.`}
        semRetomada={vida.diagnostico.semRetomadaAutomatica === true}
      />
    );
  }
  if (vida.preocupante) {
    // Sem diagnóstico do servidor: só o tempo de silêncio, com a mesma orientação.
    return <AvisoDeSuspeita aviso={`sem notícias do Claude há ${formatarDuracao(vida.ultimoSinalHaMs)} — pode ter travado.`} />;
  }
  return (
    <>
      {`${vida.tokensPensando === null ? "" : `pensando · ~${formatarTokens(vida.tokensPensando)} tokens de raciocínio · `}último sinal há ${formatarDuracao(vida.ultimoSinalHaMs)}`}
    </>
  );
}

/**
 * O que mostra que o turno está vivo: a fase, o tempo total, o último sinal
 * do Claude (com os tokens de raciocínio, quando ele está pensando) e, se o
 * silêncio passar do normal, o aviso de que pode ter travado. Com o
 * diagnóstico do servidor, a mensagem explica o silêncio.
 */
function SinalDoTurno({ turno, sinal }: { turno: TurnoNaTela; sinal: SinalDeVida | undefined }) {
  const agora = useRelogio(true);
  const vida = estadoDeVida(turno, sinal, agora);

  return (
    <>
      <div className="linha-do-terminal">
        <span />
        <Girador />
        <span className="col-span-2 text-active">
          {faseDoTurno(turno).descricao} <span className="text-muted">· {formatarDuracao(vida.duracaoMs)}</span>
        </span>
      </div>
      <div className={`linha-do-terminal ${vida.preocupante ? "linha-erro" : "linha-sistema"}`}>
        <span />
        {/* A chave muda a cada sinal: o coração pulsa de novo cada vez que o Claude dá notícia. */}
        <span key={sinal?.em ?? turno.ultimaAtividadeEm} className="linha-simbolo batimento">
          {vida.preocupante ? <IconeAlerta tamanho={12} className="inline-block align-[-1px]" /> : <IconeCoracao className="inline-block align-[-1px]" />}
        </span>
        <span className="linha-texto col-span-2">
          <TextoDoSinal vida={vida} />
        </span>
      </div>
    </>
  );
}

/** Ex.: "02:05". */
function formatarContagem(milissegundos: number): string {
  const segundos = Math.max(0, Math.ceil(milissegundos / 1000));
  return `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`;
}

/**
 * O app vai retomar sozinho o pedido que travou ou falhou: a contagem até lá
 * e o botão para cancelar (o mesmo cancelamento do esc).
 */
function CartaoDeRetomada({
  orquestradorId,
  recuperacao,
  desconectado,
}: {
  orquestradorId: string;
  recuperacao: RecuperacaoNaTela;
  desconectado: boolean;
}) {
  const agora = useRelogio(true);
  const [cancelando, setCancelando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const restanteMs = recuperacao.retomaEm === null ? 0 : Date.parse(recuperacao.retomaEm) - agora.getTime();
  const tentativa = `(tentativa ${recuperacao.tentativa} de ${recuperacao.de})`;

  const cancelar = async () => {
    setErro(null);
    setCancelando(true);
    try {
      await api.cancelar(orquestradorId);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setCancelando(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="cartao-de-retomada" role="status" aria-label="Retomada automática">
        <span className="cartao-de-retomada-texto">
          {restanteMs > 0 ? (
            <>
              Retomando em <span className="cartao-de-retomada-contagem">{formatarContagem(restanteMs)}</span>
            </>
          ) : (
            "Retomando agora"
          )}{" "}
          {tentativa} · {recuperacao.resumo}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => void cancelar()}
          disabled={cancelando || desconectado}
          title={`Não retomar sozinho (${CAUSAS_LEGIVEIS[recuperacao.causa]})`}
        >
          {cancelando ? "cancelando…" : "cancelar retomada"}
        </button>
      </div>
      {erro !== null && <p className="hint-error">{erro}</p>}
    </div>
  );
}

/** O app esgotou as tentativas: o diagnóstico e o que o usuário pode fazer. */
function CartaoDeDesistencia({ recuperacao }: { recuperacao: RecuperacaoNaTela }) {
  return (
    <div className="cartao-de-desistencia" role="group" aria-label="Retomada automática sem sucesso">
      <span className="cartao-de-desistencia-titulo">
        <IconeAlerta tamanho={12} />
        Não consegui retomar sozinho ({CAUSAS_LEGIVEIS[recuperacao.causa]}, {recuperacao.tentativa} de {recuperacao.de}{" "}
        tentativas)
      </span>
      <p className="cartao-de-desistencia-diagnostico">{recuperacao.resumo}</p>
      <p className="cartao-de-desistencia-orientacao">
        Você decide o próximo passo: reenvie o pedido (se puder, em partes menores) ou confira o log acima para ver onde
        ele parou.
      </p>
    </div>
  );
}

interface PropsDoTurno {
  turno: TurnoNaTela;
  orquestradorId: string;
  configuracao: DadosDaConfiguracao;
  ultimo: boolean;
  sinal: SinalDeVida | undefined;
  desconectado: boolean;
  /** Algum pedido da conversa está rodando: as perguntas não podem ser respondidas agora. */
  trabalhando: boolean;
  acoesDoPlano: AcoesDoPlano;
  aoResponderPergunta: (texto: string) => Promise<void>;
}

/**
 * Um pedido com seu log e sua resposta. Memorizado: um evento só troca o
 * objeto do turno a que pertence, então os pedidos antigos não re-renderizam
 * (nem re-analisam o Markdown da resposta) a cada novidade do atual.
 */
const Turno = memo(function Turno({
  turno,
  orquestradorId,
  configuracao,
  ultimo,
  sinal,
  desconectado,
  trabalhando,
  acoesDoPlano,
  aoResponderPergunta,
}: PropsDoTurno) {
  const emAndamento = turno.situacao === "em_andamento";
  // Pedidos já encerrados mostram só os marcos: as centenas de ações dos
  // agentes interessam enquanto acontecem, não no histórico.
  const linhas = emAndamento ? turno.log : turno.log.filter((linha) => linha.tipo !== "ferramenta");
  const recuperacao = turno.recuperacao ?? null;
  const retomada = turno.retomada ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      {retomada === null ? (
        <div className="prompt-registrado">
          <span className="text-active">❯</span>
          <span className="texto-longo">{turno.texto}</span>
        </div>
      ) : (
        // O app abriu este turno sozinho: a mensagem de retomada não é um pedido do usuário e fica recolhida.
        <>
          <div className="prompt-registrado prompt-de-retomada">
            <span className="text-active">↻</span>
            <span>{`retomada automática (tentativa ${retomada.tentativa})`}</span>
          </div>
          <details className="mensagem-de-retomada">
            <summary>mensagem enviada ao Claude</summary>
            <p className="texto-longo">{turno.texto}</p>
          </details>
        </>
      )}
      {turno.anexos.length > 0 && (
        <div className="anexos-do-turno">
          {turno.anexos.map((anexo) => (
            <a
              key={anexo.id}
              href={api.enderecoDoAnexo(orquestradorId, anexo.arquivo)}
              target="_blank"
              rel="noreferrer"
              title={`${anexo.nome} — abrir em tamanho real`}
            >
              <img src={api.enderecoDoAnexo(orquestradorId, anexo.arquivo)} alt={anexo.nome} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-col">
        {linhas.map((linha) => (
          <LinhaDoTerminal key={linha.sequencia} linha={linha} />
        ))}
      </div>
      {emAndamento &&
        (desconectado ? (
          // Sem servidor não há notícia dos agentes: o spinner daria a
          // impressão de que o trabalho segue normalmente.
          <div className="linha-do-terminal linha-erro">
            <span />
            <span className="linha-simbolo">
              <IconeAlerta tamanho={12} className="inline-block align-[-1px]" />
            </span>
            <span className="linha-texto col-span-2">sem conexão com o servidor — aguardando ele voltar</span>
          </div>
        ) : (
          <SinalDoTurno turno={turno} sinal={sinal} />
        ))}
      {turno.resposta !== null &&
        turno.resposta !== "" &&
        // Plano também sai de um pedido de execução, quando o Orquestrador o propõe antes de uma mudança grande.
        (turno.modo === "planejamento" || turno.decisaoDoPlano !== null ? (
          <CartaoDoPlano
            turno={turno}
            configuracao={configuracao}
            ultimo={ultimo}
            desconectado={desconectado}
            acoes={acoesDoPlano}
          />
        ) : (
          <div className="resposta-no-terminal">
            <TextoFormatado texto={turno.resposta} className="markdown-terminal" />
          </div>
        ))}
      {/* Respondida quando já há um pedido depois deste: a escolha (ou outra mensagem) já foi enviada. */}
      {turno.situacao === "concluido" && turno.perguntas !== undefined && turno.perguntas.length > 0 && (
        <CartaoDePergunta
          perguntas={turno.perguntas}
          respondida={!ultimo}
          desabilitado={desconectado || trabalhando}
          aoResponder={aoResponderPergunta}
        />
      )}
      {turno.situacao === "falhou" && turno.motivoDaFalha !== null && (
        <p className="mono texto-longo text-error">{turno.motivoDaFalha}</p>
      )}
      {/* Só no último pedido: com um pedido depois, a espera já acabou (retomou ou o usuário seguiu). */}
      {ultimo && recuperacao?.etapa === "aguardando" && (
        <CartaoDeRetomada orquestradorId={orquestradorId} recuperacao={recuperacao} desconectado={desconectado} />
      )}
      {recuperacao?.etapa === "desistiu" && <CartaoDeDesistencia recuperacao={recuperacao} />}
      {/* O consumo é medido depois do fim do pedido; até lá, nada aparece. */}
      {turno.consumo !== undefined && turno.consumo !== null && <CustoDoTurno consumo={turno.consumo} />}
    </div>
  );
});

interface Props {
  orquestradorId: string;
  nome: string;
  pastaDeTrabalho: string;
  /** Configuração atual do Orquestrador; a mesma referência enquanto o conteúdo não muda. */
  configuracao: DadosDaConfiguracao;
  /** A predefinição que a configuração atual reproduz (ex.: modo econômico), se houver. */
  predefinicao?: NomeDaPredefinicao | null;
  /** Os pedidos da conversa deste Orquestrador (`EstadoDaConversa.turnos`). */
  turnos: readonly TurnoNaTela[];
  /** Quando a conversa atual começou (/clear); nulo enquanto é a primeira. */
  conversaIniciadaEm: string | null;
  /** O que o /clear deixou para trás (worktree alterada, plano descartado), junto do separador. */
  avisosDaConversaNova?: AvisosDaConversaNova;
  sinal: SinalDeVida | undefined;
  desconectado: boolean;
  /** Aprovar, ajustar ou descartar o plano pendente do último pedido (Plan Mode). */
  acoesDoPlano: AcoesDoPlano;
  /** Envia a resposta às perguntas do último pedido como um pedido novo, pelo envio do prompt; lança se recusar. */
  aoResponderPergunta: (texto: string) => Promise<void>;
}

/**
 * O que aparece dentro do terminal: a apresentação e cada pedido com seu log.
 *
 * Memorizada e com props primitivas ou de identidade estável: só re-renderiza
 * quando a conversa, o sinal de vida ou os dados deste Orquestrador mudam —
 * não no arraste do terminal nem com eventos de outros Orquestradores.
 */
export const TranscricaoDoTerminal = memo(function TranscricaoDoTerminal({
  orquestradorId,
  nome,
  pastaDeTrabalho,
  configuracao,
  predefinicao = null,
  turnos,
  conversaIniciadaEm,
  avisosDaConversaNova = SEM_AVISOS_DA_CONVERSA_NOVA,
  sinal,
  desconectado,
  acoesDoPlano,
  aoResponderPergunta,
}: Props) {
  const trabalhando = turnos.some((turno) => turno.situacao === "em_andamento");
  const avisos = [
    avisosDaConversaNova.worktreeComAlteracoes ? "a worktree tem alterações da conversa anterior" : null,
    avisosDaConversaNova.planoDescartado ? "o plano pendente foi descartado" : null,
  ].filter((aviso) => aviso !== null);
  return (
    <div className="flex flex-col gap-5">
      <div className="banner-do-terminal">
        <div className="flex items-center gap-2 text-active">
          <IconeOrquestrador tamanho={15} />
          <span className="font-titulo text-[13px] font-semibold text-primary">{nome}</span>
        </div>
        <p>
          <span className="text-muted">pasta </span>
          {pastaDeTrabalho}
        </p>
        <p>
          <span className="text-muted">config </span>
          {descreverConfiguracao(configuracao).toLowerCase()}
          {predefinicao === "economico" && (
            <span className="chip ml-1.5" title="A configuração atual é a do modo econômico.">
              econômico
            </span>
          )}
        </p>
        <p className="text-muted">
          {turnos.length === 0
            ? "digite um pedido e pressione enter — o orquestrador divide o trabalho e instancia os agentes."
            : `${turnos.length} ${turnos.length === 1 ? "pedido" : "pedidos"} nesta conversa · /clear começa uma nova`}
        </p>
      </div>
      {conversaIniciadaEm !== null && (
        <div className="flex flex-col gap-0.5">
          <p className="mono hint text-center">{`— conversa nova iniciada às ${formatarMomento(conversaIniciadaEm)} —`}</p>
          {/* A conversa nova parte da worktree como ela está: sem o aviso, ninguém saberia de onde vieram as alterações. */}
          {avisos.length > 0 && (
            <p className="mono hint-warning text-center" role="note" aria-label="Avisos da conversa nova">
              {avisos.join(" · ")}
            </p>
          )}
        </div>
      )}
      {turnos.map((turno, indice) => (
        <Turno
          key={turno.id}
          turno={turno}
          orquestradorId={orquestradorId}
          configuracao={configuracao}
          ultimo={indice === turnos.length - 1}
          // Só o pedido em andamento mostra o sinal de vida: os outros não
          // precisam re-renderizar a cada sinal que chega.
          sinal={turno.situacao === "em_andamento" ? sinal : undefined}
          desconectado={desconectado}
          trabalhando={trabalhando}
          acoesDoPlano={acoesDoPlano}
          aoResponderPergunta={aoResponderPergunta}
        />
      ))}
    </div>
  );
});
