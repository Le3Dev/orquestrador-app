import { memo, type ReactNode, useEffect, useState } from "react";

import { ehAnexoDeImagem } from "../../shared/anexos";
import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaConfiguracao, NomeDaPredefinicao, SinalDeVida } from "../../shared/api/tipos";
import { nomeDoBixinho } from "../../shared/canvas/bixinhos";
import {
  type AvisosDaConversaNova,
  CAUSAS_LEGIVEIS,
  type LinhaDoLog,
  type RecuperacaoNaTela,
  SEM_AVISOS_DA_CONVERSA_NOVA,
  textoDaTrocaDeMotor,
  type TipoDeLinhaDoLog,
  type TrocaDeMotorNaTela,
  type TurnoNaTela,
} from "../../shared/estado/aplicarEvento";
import { faseDoTurno } from "../../shared/estado/faseDoTurno";
import { type EstadoDeVida, estadoDeVida } from "../../shared/estado/sinalDeVida";
import { useAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import "../../theme/recuperacao-do-turno.css";
import "../../theme/motores.css";
import { nomeCurtoDoMotor, rotuloDoMotor } from "../../shared/modelos";
import {
  descreverConfiguracao,
  formatarDuracao,
  formatarHora,
  formatarMomento,
  formatarTokens,
  idCurto,
} from "../../shared/formatacao";
import { useRelogio } from "../../shared/hooks/useRelogio";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeTranscricao } from "../../shared/idioma/textos/transcricao";
import { ChipDeAnexo } from "../ChipDeAnexo";
import { IconeAlerta, IconeCoracao, IconeOrquestrador, IconeRaio } from "../Icones";
import { CartaoDePergunta } from "../chat/CartaoDePergunta";
import { TextoFormatado } from "../TextoFormatado";
import { type AcoesDoPlano, CartaoDoPlano } from "./CartaoDoPlano";
import { CustoDoTurno } from "./CustoDoTurno";
import { ProgressoDasTarefas } from "./ProgressoDasTarefas";

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

/**
 * Memorizada: as linhas do log não mudam depois de criadas, só chegam novas.
 * `papel` é o do Subagente da linha: um subagente pronto aparece pelo nome
 * dele, como o bixinho no canvas; os outros, pelo nome do bicho.
 */
const LinhaDoTerminal = memo(function LinhaDoTerminal({ linha, papel }: { linha: LinhaDoLog; papel: string | null }) {
  const t = useTextos(textosDeTranscricao);
  const doOrquestrador = linha.origem === "orquestrador";
  const origem = doOrquestrador ? t.origemOrquestrador : `${nomeDoBixinho(linha.origem, papel)}#${idCurto(linha.origem)}`;
  return (
    <div className={`linha-do-terminal linha-${linha.tipo}`}>
      <span className="text-muted">{formatarHora(linha.em)}</span>
      <span className="linha-simbolo">{SIMBOLOS[linha.tipo]}</span>
      <span
        className={doOrquestrador ? "linha-origem-orquestrador" : "linha-origem-bixinho"}
        title={doOrquestrador ? undefined : origem}
      >
        {origem}
      </span>
      <span className="linha-texto" title={linha.texto}>
        {linha.texto}
      </span>
    </div>
  );
});

/**
 * O motor do turno pode ter travado (pelo diagnóstico do servidor ou só pelo
 * tempo de silêncio). Com a autorrecuperação ligada, o app retoma sozinho; desligada,
 * ou quando o servidor não vê os processos (`semRetomada`), vale a orientação
 * de cancelar e reenviar. A preferência só é lida aqui, com o aviso na tela.
 */
function AvisoDeSuspeita({ aviso, semRetomada = false }: { aviso: string; semRetomada?: boolean }) {
  const t = useTextos(textosDeTranscricao);
  const autorrecuperacao = useAutorrecuperacao();
  const orientacao = autorrecuperacao && !semRetomada ? t.orientacaoRetoma : t.orientacaoCancelar;
  return <>{`${aviso} ${orientacao}`}</>;
}

/**
 * O texto do sinal de vida: o diagnóstico do servidor, quando há, ou o tempo de
 * silêncio. `motor` é o nome curto de quem executa o turno ("Claude", "Codex" ou "Copilot").
 */
function TextoDoSinal({ vida, motor }: { vida: EstadoDeVida; motor: string }) {
  const t = useTextos(textosDeTranscricao);
  if (vida.diagnostico?.situacao === "trabalhando") {
    // Calado, mas trabalhando (um comando longo): sem tom de alarme.
    return <>{vida.diagnostico.resumo}</>;
  }
  if (vida.diagnostico?.situacao === "suspeito") {
    return (
      <AvisoDeSuspeita
        aviso={t.semNoticias(motor, formatarDuracao(vida.ultimoSinalHaMs), vida.diagnostico.resumo)}
        semRetomada={vida.diagnostico.semRetomadaAutomatica === true}
      />
    );
  }
  if (vida.preocupante) {
    // Sem diagnóstico do servidor: só o tempo de silêncio, com a mesma orientação.
    return <AvisoDeSuspeita aviso={t.semNoticiasTempo(motor, formatarDuracao(vida.ultimoSinalHaMs))} />;
  }
  return (
    <>
      {t.sinalDeVida(vida.tokensPensando === null ? null : formatarTokens(vida.tokensPensando), formatarDuracao(vida.ultimoSinalHaMs))}
    </>
  );
}

/**
 * O que mostra que o turno está vivo: a fase, o tempo total, o último sinal
 * do motor (com os tokens de raciocínio, quando ele está pensando) e, se o
 * silêncio passar do normal, o aviso de que pode ter travado. Com o
 * diagnóstico do servidor, a mensagem explica o silêncio. O aviso cita o
 * motor do turno quando ele não é o Claude Code ("sem notícias do Codex…").
 */
function SinalDoTurno({ turno, sinal }: { turno: TurnoNaTela; sinal: SinalDeVida | undefined }) {
  const agora = useRelogio(true);
  const vida = estadoDeVida(turno, sinal, agora);
  // Os turnos gravados antes dos outros motores não trazem o motor: rodaram no Claude Code.
  const motor = nomeCurtoDoMotor(turno.motor ?? "claude-code");

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
        {/* A chave muda a cada sinal: o coração pulsa de novo cada vez que o motor dá notícia. */}
        <span key={sinal?.em ?? turno.ultimaAtividadeEm} className="linha-simbolo batimento">
          {vida.preocupante ? <IconeAlerta tamanho={12} className="inline-block align-[-1px]" /> : <IconeCoracao className="inline-block align-[-1px]" />}
        </span>
        <span className="linha-texto col-span-2">
          <TextoDoSinal vida={vida} motor={motor} />
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
  const t = useTextos(textosDeTranscricao);
  const agora = useRelogio(true);
  const [cancelando, setCancelando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const restanteMs = recuperacao.retomaEm === null ? 0 : Date.parse(recuperacao.retomaEm) - agora.getTime();
  const tentativa = t.retomada.tentativa(recuperacao.tentativa, recuperacao.de);

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
      <div className="cartao-de-retomada" role="status" aria-label={t.retomada.aria}>
        <span className="cartao-de-retomada-texto">
          {restanteMs > 0 ? (
            <>
              {t.retomada.retomandoEm}
              <span className="cartao-de-retomada-contagem">{formatarContagem(restanteMs)}</span>
            </>
          ) : (
            t.retomada.retomandoAgora
          )}{" "}
          {tentativa} · {recuperacao.resumo}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => void cancelar()}
          disabled={cancelando || desconectado}
          title={t.retomada.naoRetomarSozinho(CAUSAS_LEGIVEIS[recuperacao.causa])}
        >
          {cancelando ? t.retomada.cancelando : t.retomada.cancelar}
        </button>
      </div>
      {erro !== null && <p className="hint-error">{erro}</p>}
    </div>
  );
}

/**
 * O pedido passou para outro motor porque o limite de uso (ou a sobrecarga) do principal o impediu de seguir:
 * quem assumiu e por quê. Ex.: "Trocou para Codex: limite do Claude atingido (libera às 14:30)".
 */
function AvisoDeTrocaDeMotor({ troca }: { troca: TrocaDeMotorNaTela }) {
  const t = useTextos(textosDeTranscricao);
  return (
    <div className="aviso-de-troca-de-motor" role="status" aria-label={t.trocaDeMotor}>
      <IconeAlerta tamanho={13} />
      <span className="min-w-0 texto-longo">{textoDaTrocaDeMotor(troca)}</span>
    </div>
  );
}

/** O app esgotou as tentativas: o diagnóstico e o que o usuário pode fazer. */
function CartaoDeDesistencia({ recuperacao }: { recuperacao: RecuperacaoNaTela }) {
  const t = useTextos(textosDeTranscricao);
  return (
    <div className="cartao-de-desistencia" role="group" aria-label={t.desistencia.aria}>
      <span className="cartao-de-desistencia-titulo">
        <IconeAlerta tamanho={12} />
        {t.desistencia.titulo(CAUSAS_LEGIVEIS[recuperacao.causa], recuperacao.tentativa, recuperacao.de)}
      </span>
      <p className="cartao-de-desistencia-diagnostico">{recuperacao.resumo}</p>
      <p className="cartao-de-desistencia-orientacao">
        {t.desistencia.orientacao}
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
  const t = useTextos(textosDeTranscricao);
  const emAndamento = turno.situacao === "em_andamento";
  // Pedidos já encerrados mostram só os marcos: as centenas de ações dos
  // agentes interessam enquanto acontecem, não no histórico.
  const linhas = emAndamento ? turno.log : turno.log.filter((linha) => linha.tipo !== "ferramenta");
  const recuperacao = turno.recuperacao ?? null;
  const retomada = turno.retomada ?? null;
  const motor = turno.motor ?? "claude-code";
  // Como o sinal de vida, o progresso só interessa enquanto o pedido roda.
  const tarefas = emAndamento ? (turno.tarefas ?? []) : [];
  // O papel de cada Subagente do pedido, para o nome na origem das linhas.
  const papeis = new Map(turno.subagentes.map((subagente) => [subagente.id, subagente.papel]));

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
            <span>{t.retomada.automatica(retomada.tentativa)}</span>
          </div>
          <details className="mensagem-de-retomada">
            <summary>{t.retomada.mensagemEnviada}</summary>
            <p className="texto-longo">{turno.texto}</p>
          </details>
        </>
      )}
      {turno.anexos.length > 0 && (
        <div className="anexos-do-turno">
          {turno.anexos.map((anexo) =>
            ehAnexoDeImagem(anexo) ? (
              <a
                key={anexo.id}
                href={api.enderecoDoAnexo(orquestradorId, anexo.arquivo)}
                target="_blank"
                rel="noreferrer"
                title={t.abrirEmTamanhoReal(anexo.nome)}
              >
                <img src={api.enderecoDoAnexo(orquestradorId, anexo.arquivo)} alt={anexo.nome} loading="lazy" />
              </a>
            ) : (
              // Documento: o servidor o entrega como download; o `download` do link devolve o nome original.
              <ChipDeAnexo
                key={anexo.id}
                nome={anexo.nome}
                tamanhoEmBytes={anexo.tamanhoEmBytes}
                href={api.enderecoDoAnexo(orquestradorId, anexo.arquivo)}
              />
            ),
          )}
        </div>
      )}
      {/* O motor só aparece quando não é o Claude Code (o padrão): quem executou o pedido. */}
      {motor !== "claude-code" && (
        <div className="linha-do-motor-do-turno">
          <span
            className="chip selo-do-motor-do-turno"
            data-testid="selo-do-motor"
            title={t.pedidoRodouNo(rotuloDoMotor(motor))}
          >
            {rotuloDoMotor(motor)}
          </span>
        </div>
      )}
      {turno.trocaDeMotor != null && <AvisoDeTrocaDeMotor troca={turno.trocaDeMotor} />}
      <div className="flex flex-col">
        {linhas.map((linha) => (
          <LinhaDoTerminal key={linha.sequencia} linha={linha} papel={papeis.get(linha.origem) ?? null} />
        ))}
      </div>
      {tarefas.length > 0 && <ProgressoDasTarefas tarefas={tarefas} />}
      {emAndamento &&
        (desconectado ? (
          // Sem servidor não há notícia dos agentes: o spinner daria a
          // impressão de que o trabalho segue normalmente.
          <div className="linha-do-terminal linha-erro">
            <span />
            <span className="linha-simbolo">
              <IconeAlerta tamanho={12} className="inline-block align-[-1px]" />
            </span>
            <span className="linha-texto col-span-2">{t.semConexao}</span>
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
/** Quantos pedidos a transcrição desenha de uma vez; "Mostrar anteriores" revela mais esse tanto. */
const TURNOS_POR_PAGINA = 20;

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
  const t = useTextos(textosDeTranscricao);
  const [quantosTurnos, setQuantosTurnos] = useState(TURNOS_POR_PAGINA);
  // Só os últimos turnos são desenhados (poupa memória); os demais continuam no estado.
  const primeiroVisivel = Math.max(0, turnos.length - quantosTurnos);
  const trabalhando = turnos.some((turno) => turno.situacao === "em_andamento");
  const avisos = [
    avisosDaConversaNova.worktreeComAlteracoes ? t.worktreeComAlteracoes : null,
    avisosDaConversaNova.planoDescartado ? t.planoDescartado : null,
  ].filter((aviso) => aviso !== null);
  return (
    <div className="flex flex-col gap-5">
      <div className="banner-do-terminal">
        <div className="flex items-center gap-2 text-active">
          <IconeOrquestrador tamanho={15} />
          <span className="font-titulo text-[13px] font-semibold text-primary">{nome}</span>
        </div>
        <p>
          <span className="text-muted">{t.banner.pasta}</span>
          {pastaDeTrabalho}
        </p>
        <p>
          <span className="text-muted">{t.banner.config}</span>
          {descreverConfiguracao(configuracao).toLowerCase()}
          {predefinicao === "economico" && (
            <span className="chip ml-1.5" title={t.banner.economicoDica}>
              {t.banner.economico}
            </span>
          )}
        </p>
        <p className="text-muted">
          {turnos.length === 0
            ? t.banner.vazio
            : t.banner.pedidos(turnos.length)}
        </p>
      </div>
      {conversaIniciadaEm !== null && (
        <div className="flex flex-col gap-0.5">
          <p className="mono hint text-center">{t.conversaNova(formatarMomento(conversaIniciadaEm))}</p>
          {/* A conversa nova parte da worktree como ela está: sem o aviso, ninguém saberia de onde vieram as alterações. */}
          {avisos.length > 0 && (
            <p className="mono hint-warning text-center" role="note" aria-label={t.avisosDaConversaNova}>
              {avisos.join(" · ")}
            </p>
          )}
        </div>
      )}
      {primeiroVisivel > 0 && (
        <button
          type="button"
          className="btn btn-sm btn-outline self-center"
          onClick={() => setQuantosTurnos((atual) => atual + TURNOS_POR_PAGINA)}
        >
          {t.mostrarAnteriores(Math.min(primeiroVisivel, TURNOS_POR_PAGINA))}
        </button>
      )}
      {turnos.slice(primeiroVisivel).map((turno, posicao) => {
        const indice = primeiroVisivel + posicao;
        return (
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
        );
      })}
    </div>
  );
});
