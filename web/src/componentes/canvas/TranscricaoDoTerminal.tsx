import { useEffect, useState } from "react";

import { api } from "../../shared/api/cliente";
import type { ResumoDoOrquestrador, SinalDeVida } from "../../shared/api/tipos";
import { aparenciaDoBixinho } from "../../shared/canvas/bixinhos";
import type { EstadoDaConversa, LinhaDoLog, TipoDeLinhaDoLog, TurnoNaTela } from "../../shared/estado/aplicarEvento";
import { faseDoTurno } from "../../shared/estado/faseDoTurno";
import { estadoDeVida } from "../../shared/estado/sinalDeVida";
import { descreverConfiguracao, formatarDuracao, formatarHora, formatarTokens, idCurto } from "../../shared/formatacao";
import { useRelogio } from "../../shared/hooks/useRelogio";
import { IconeOrquestrador } from "../Icones";
import { TextoFormatado } from "../TextoFormatado";

const SIMBOLOS: Readonly<Record<TipoDeLinhaDoLog, string>> = {
  sistema: "○",
  spawn: "⚡",
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

function LinhaDoTerminal({ linha }: { linha: LinhaDoLog }) {
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
}

/**
 * O que mostra que o turno está vivo: a fase, o tempo total, o último sinal
 * do Claude (com os tokens de raciocínio, quando ele está pensando) e, se o
 * silêncio passar do normal, o aviso de que pode ter travado.
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
          {vida.preocupante ? "⚠" : "♥"}
        </span>
        <span className="linha-texto col-span-2">
          {vida.preocupante
            ? `sem notícias do Claude há ${formatarDuracao(vida.ultimoSinalHaMs)} — pode ter travado. Se continuar assim, cancele (esc) e reenvie.`
            : `${vida.tokensPensando === null ? "" : `pensando · ~${formatarTokens(vida.tokensPensando)} tokens de raciocínio · `}último sinal há ${formatarDuracao(vida.ultimoSinalHaMs)}`}
        </span>
      </div>
    </>
  );
}

function Turno({
  turno,
  orquestradorId,
  sinal,
  desconectado,
}: {
  turno: TurnoNaTela;
  orquestradorId: string;
  sinal: SinalDeVida | undefined;
  desconectado: boolean;
}) {
  const emAndamento = turno.situacao === "em_andamento";
  // Pedidos já encerrados mostram só os marcos: as centenas de ações dos
  // agentes interessam enquanto acontecem, não no histórico.
  const linhas = emAndamento ? turno.log : turno.log.filter((linha) => linha.tipo !== "ferramenta");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="prompt-registrado">
        <span className="text-active">❯</span>
        <span className="texto-longo">{turno.texto}</span>
      </div>
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
            <span className="linha-simbolo">⚠</span>
            <span className="linha-texto col-span-2">sem conexão com o servidor — aguardando ele voltar</span>
          </div>
        ) : (
          <SinalDoTurno turno={turno} sinal={sinal} />
        ))}
      {turno.resposta !== null && turno.resposta !== "" && (
        <div className="resposta-no-terminal">
          <TextoFormatado texto={turno.resposta} className="markdown-terminal" />
        </div>
      )}
      {turno.situacao === "falhou" && turno.motivoDaFalha !== null && (
        <p className="mono texto-longo text-error">{turno.motivoDaFalha}</p>
      )}
    </div>
  );
}

interface Props {
  orquestrador: ResumoDoOrquestrador;
  conversa: EstadoDaConversa;
  sinal: SinalDeVida | undefined;
  desconectado: boolean;
}

/** O que aparece dentro do terminal: a apresentação e cada pedido com seu log. */
export function TranscricaoDoTerminal({ orquestrador, conversa, sinal, desconectado }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="banner-do-terminal">
        <div className="flex items-center gap-2 text-active">
          <IconeOrquestrador tamanho={15} />
          <span className="font-titulo text-[13px] font-semibold text-primary">{orquestrador.nome}</span>
        </div>
        <p>
          <span className="text-muted">pasta </span>
          {orquestrador.pastaDeTrabalho}
        </p>
        <p>
          <span className="text-muted">config </span>
          {descreverConfiguracao(orquestrador.configuracao).toLowerCase()}
        </p>
        <p className="text-muted">
          {conversa.turnos.length === 0
            ? "digite um pedido e pressione enter — o orquestrador divide o trabalho e instancia os agentes."
            : `${conversa.turnos.length} ${conversa.turnos.length === 1 ? "pedido" : "pedidos"} nesta conversa`}
        </p>
      </div>
      {conversa.turnos.map((turno) => (
        <Turno key={turno.id} turno={turno} orquestradorId={orquestrador.id} sinal={sinal} desconectado={desconectado} />
      ))}
    </div>
  );
}
