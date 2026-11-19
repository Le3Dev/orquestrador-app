import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type { IdiomaDaEscuta, PrioridadeDoMotor } from "../../shared/escuta/preferenciasDaEscuta";
import type { EscutaNaTela, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";
import { type TextosDe, useTextos } from "../../shared/idioma/idioma";
import { textosDeChat } from "../../shared/idioma/textos/chat";
import {
  type DownloadDoModelo,
  explicacaoDoMotor,
  nomeCurtoDoModelo,
  rotuloDoMotor,
  textoDoDownload,
  tipoDoDispositivo,
} from "./motorDaEscuta";

type Props = Pick<
  EscutaNaTela,
  | "situacao"
  | "progressoDoDownload"
  | "download"
  | "motor"
  | "erro"
  | "pausar"
  | "retomar"
  | "automatico"
  | "alternarAutomatico"
  | "preferenciasDaTela"
  | "mudarIdioma"
  | "mudarPrioridadeDoMotor"
>;

type TextosDoIndicador = TextosDe<typeof textosDeChat>["indicador"];

/** Situações em que não há escuta para indicar (fora do modo, recusada ou com o aviso na tela). */
const SEM_INDICADOR: ReadonlySet<SituacaoDaEscuta> = new Set(["indisponivel", "desligada", "aguardando-aviso"]);

interface OpcaoDoMenu<V> {
  readonly valor: V;
  readonly rotulo: string;
  readonly explicacao: string;
}

function idiomasDaEscuta(t: TextosDoIndicador): readonly OpcaoDoMenu<IdiomaDaEscuta>[] {
  return [
    { valor: "portuguese", rotulo: t.idiomaPortugues, explicacao: t.idiomaPortuguesDica },
    { valor: "automatico", rotulo: t.idiomaAutomatico, explicacao: t.idiomaAutomaticoDica },
  ];
}

function prioridadesDoMotor(t: TextosDoIndicador): readonly OpcaoDoMenu<PrioridadeDoMotor>[] {
  return [
    { valor: "velocidade", rotulo: t.velocidade, explicacao: t.velocidadeDica },
    { valor: "precisao", rotulo: t.precisao, explicacao: t.precisaoDica },
  ];
}

/** O download com o total, quando a sessão o informa; sem ele, só a porcentagem. */
function downloadDe({ download, progressoDoDownload }: Pick<Props, "download" | "progressoDoDownload">): DownloadDoModelo | null {
  if (download !== null) {
    return download;
  }
  return progressoDoDownload === null ? null : { progresso: progressoDoDownload, totalMb: null };
}

/** Os ícones do botão do indicador: pausar (duas barras), retomar (triângulo) e tentar de novo (seta circular). */
function IconeDoIndicador({ tipo }: { tipo: "pausar" | "retomar" | "repetir" }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill={tipo === "repetir" ? "none" : "currentColor"}
      stroke="currentColor"
      strokeWidth={tipo === "repetir" ? 2 : 0}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {tipo === "pausar" && (
        <>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </>
      )}
      {tipo === "retomar" && <path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10-6.5a.8.8 0 0 0 0-1.4l-10-6.5A.8.8 0 0 0 8 5.5Z" />}
      {tipo === "repetir" && <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" />}
    </svg>
  );
}

/** O rótulo curto ao lado do ponto. */
function rotuloDa(situacao: SituacaoDaEscuta, download: DownloadDoModelo | null, t: TextosDoIndicador): string {
  switch (situacao) {
    case "escutando":
      return t.escutando;
    case "pausada":
      return t.pausada;
    case "baixando-modelo":
      return download === null ? t.baixandoOModelo : textoDoDownload(download);
    case "iniciando":
      return t.iniciando;
    case "erro":
      return t.comErro;
    default:
      return "";
  }
}

/** A explicação no balão (title) do indicador. */
function explicacaoDa(
  situacao: SituacaoDaEscuta,
  erro: string | null,
  download: DownloadDoModelo | null,
  t: TextosDoIndicador,
): string {
  switch (situacao) {
    case "escutando":
      return t.dicaEscutando;
    case "pausada":
      return t.dicaPausada;
    case "baixando-modelo": {
      const totalMb = download?.totalMb ?? null;
      return t.dicaBaixando(totalMb !== null && Number.isFinite(totalMb) && totalMb > 0 ? Math.round(totalMb) : null);
    }
    case "iniciando":
      return t.dicaIniciando;
    case "erro":
      return erro === null ? t.dicaErro : t.dicaErroComMotivo(erro);
    default:
      return "";
  }
}

/** O menu pequeno da escuta: a chave Automático, o idioma da transcrição e o que pesa na escolha do motor. */
function MenuDaEscuta({
  id,
  automatico,
  alternarAutomatico,
  preferenciasDaTela,
  mudarIdioma,
  mudarPrioridadeDoMotor,
}: Pick<Props, "automatico" | "alternarAutomatico" | "preferenciasDaTela" | "mudarIdioma" | "mudarPrioridadeDoMotor"> & {
  readonly id: string;
}) {
  const t = useTextos(textosDeChat).indicador;
  const nomeDoGrupo = useId();
  return (
    <div id={id} className="menu-da-escuta" role="group" aria-label={t.controles}>
      <button
        type="button"
        role="switch"
        className="interruptor interruptor-da-escuta"
        aria-checked={automatico}
        title={automatico ? t.automaticoLigadoDica : t.automaticoDesligadoDica}
        onClick={alternarAutomatico}
      >
        <span className="interruptor-trilho" aria-hidden="true" />
        {t.automatico}
      </button>
      <fieldset className="grupo-do-menu-da-escuta">
        <legend className="rotulo-tecnico">{t.idioma}</legend>
        {idiomasDaEscuta(t).map(({ valor, rotulo, explicacao }) => (
          <label key={valor} className="opcao-do-menu-da-escuta" title={explicacao}>
            <input
              type="radio"
              name={`${nomeDoGrupo}-idioma`}
              value={valor}
              checked={preferenciasDaTela.idioma === valor}
              onChange={() => mudarIdioma(valor)}
            />
            {rotulo}
          </label>
        ))}
      </fieldset>
      <fieldset className="grupo-do-menu-da-escuta">
        <legend className="rotulo-tecnico">{t.prioridadeDoMotor}</legend>
        {prioridadesDoMotor(t).map(({ valor, rotulo, explicacao }) => (
          <label key={valor} className="opcao-do-menu-da-escuta" title={explicacao}>
            <input
              type="radio"
              name={`${nomeDoGrupo}-prioridade`}
              value={valor}
              checked={preferenciasDaTela.prioridadeDoMotor === valor}
              onChange={() => mudarPrioridadeDoMotor(valor)}
            />
            {rotulo}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * Ao lado do olho, com a escuta ligada: uma pílula pequena em que o ponto
 * pulsa enquanto o áudio do computador é escutado e fica parado na pausa; ao
 * lado, o selo do motor ("GPU · base · q4"). O rótulo ("escutando"…) fica só
 * para leitor de tela (a barra do chat é estreita), menos baixando, quando
 * mostra o progresso com o total ("baixando o modelo 45% de 199 MB"). Clicar
 * no selo abre o menu da escuta (Automático, idioma e prioridade do motor),
 * que fecha no Esc, ao clicar fora ou no próprio selo. O botão ao lado alterna
 * pausar e retomar (aria-pressed = pausada); com erro, ele tenta de novo.
 */
export function IndicadorDaEscuta({
  situacao,
  progressoDoDownload,
  download,
  motor,
  erro,
  pausar,
  retomar,
  automatico,
  alternarAutomatico,
  preferenciasDaTela,
  mudarIdioma,
  mudarPrioridadeDoMotor,
}: Props) {
  const t = useTextos(textosDeChat).indicador;
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const idDoMenu = useId();
  const visivel = !SEM_INDICADOR.has(situacao);

  useEffect(() => {
    if (!aberto) {
      return undefined;
    }
    const aoApertarFora = (evento: PointerEvent) => {
      if (evento.target instanceof Node && raiz.current?.contains(evento.target) !== true) {
        setAberto(false);
      }
    };
    document.addEventListener("pointerdown", aoApertarFora);
    return () => document.removeEventListener("pointerdown", aoApertarFora);
  }, [aberto]);

  if (!visivel) {
    return null;
  }

  const aoTeclar = (evento: KeyboardEvent<HTMLSpanElement>) => {
    if (aberto && evento.key === "Escape") {
      // Só fecha o menu: o Esc não chega ao chat (que ocultaria a conversa).
      evento.stopPropagation();
      setAberto(false);
      botao.current?.focus();
    }
  };

  const baixando = downloadDe({ download, progressoDoDownload });
  const pausada = situacao === "pausada";
  const comBotao = situacao === "escutando" || pausada;
  return (
    <span
      ref={raiz}
      className={`indicador-da-escuta indicador-da-escuta-${situacao}`}
      data-testid="indicador-da-escuta"
      onKeyDown={aoTeclar}
    >
      <button
        ref={botao}
        type="button"
        className="abrir-menu-da-escuta"
        title={explicacaoDa(situacao, erro, baixando, t)}
        aria-label={t.controles}
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        onClick={() => setAberto((atual) => !atual)}
      >
        <span className="ponto-da-escuta" aria-hidden="true" />
        <span className="rotulo-da-escuta" aria-live="polite">
          {rotuloDa(situacao, baixando, t)}
        </span>
        {motor !== null && (
          <span
            className={`selo-do-motor-no-indicador selo-do-motor-no-indicador-${tipoDoDispositivo(motor.dispositivo).toLowerCase()}`}
            title={explicacaoDoMotor(motor)}
            data-testid="selo-do-motor"
          >
            {rotuloDoMotor(motor)}
          </span>
        )}
        {motor !== null && nomeCurtoDoModelo(motor.modelo) === "base" && (
          <span
            className="aviso-de-precisao-baixa"
            style={{ color: "var(--warning)" }}
            title={t.precisaoBaixa}
            aria-label={t.precisaoBaixa}
            role="img"
            data-testid="aviso-de-precisao-baixa"
          >
            !
          </span>
        )}
      </button>
      {comBotao && (
        <button
          type="button"
          className="botao-da-escuta"
          aria-label={t.pausarEscuta}
          aria-pressed={pausada}
          title={pausada ? t.retomarEscuta : t.pausarEscuta}
          onClick={pausada ? retomar : pausar}
        >
          <IconeDoIndicador tipo={pausada ? "retomar" : "pausar"} />
        </button>
      )}
      {situacao === "erro" && (
        <button
          type="button"
          className="botao-da-escuta"
          aria-label={t.tentarDeNovo}
          title={t.tentarDeNovo}
          onClick={retomar}
        >
          <IconeDoIndicador tipo="repetir" />
        </button>
      )}
      {aberto && (
        <MenuDaEscuta
          id={idDoMenu}
          automatico={automatico}
          alternarAutomatico={alternarAutomatico}
          preferenciasDaTela={preferenciasDaTela}
          mudarIdioma={mudarIdioma}
          mudarPrioridadeDoMotor={mudarPrioridadeDoMotor}
        />
      )}
    </span>
  );
}
