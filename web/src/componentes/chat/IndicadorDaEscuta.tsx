import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type { IdiomaDaEscuta, PrioridadeDoMotor } from "../../shared/escuta/preferenciasDaEscuta";
import type { EscutaNaTela, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";
import {
  type DownloadDoModelo,
  explicacaoDoMotor,
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

/** Situações em que não há escuta para indicar (fora do modo, recusada ou com o aviso na tela). */
const SEM_INDICADOR: ReadonlySet<SituacaoDaEscuta> = new Set(["indisponivel", "desligada", "aguardando-aviso"]);

const IDIOMAS: readonly { readonly valor: IdiomaDaEscuta; readonly rotulo: string; readonly explicacao: string }[] = [
  { valor: "portuguese", rotulo: "Português", explicacao: "Transcreve sempre em português (acerta mais nas falas em português)" },
  { valor: "automatico", rotulo: "Automático", explicacao: "Detecta o idioma de cada fala" },
];

const PRIORIDADES: readonly { readonly valor: PrioridadeDoMotor; readonly rotulo: string; readonly explicacao: string }[] = [
  { valor: "velocidade", rotulo: "Velocidade", explicacao: "Modelo mais leve: a transcrição chega mais rápido" },
  { valor: "precisao", rotulo: "Precisão", explicacao: "Modelo maior: acerta mais, com um pouco mais de atraso" },
];

/** O download com o total, quando a sessão o informa; sem ele, só a porcentagem. */
function downloadDe({ download, progressoDoDownload }: Pick<Props, "download" | "progressoDoDownload">): DownloadDoModelo | null {
  if (download !== null) {
    return download;
  }
  return progressoDoDownload === null ? null : { progresso: progressoDoDownload, totalMb: null };
}

/** O rótulo curto ao lado do ponto. */
function rotuloDa(situacao: SituacaoDaEscuta, download: DownloadDoModelo | null): string {
  switch (situacao) {
    case "escutando":
      return "escutando";
    case "pausada":
      return "pausada";
    case "baixando-modelo":
      return download === null ? "baixando o modelo…" : textoDoDownload(download);
    case "iniciando":
      return "iniciando…";
    case "erro":
      return "escuta com erro";
    default:
      return "";
  }
}

/** A explicação no balão (title) do indicador. */
function explicacaoDa(situacao: SituacaoDaEscuta, erro: string | null, download: DownloadDoModelo | null): string {
  switch (situacao) {
    case "escutando":
      return "Escutando o áudio do computador: a transcrição fica só neste computador";
    case "pausada":
      return "Escuta pausada: nada do áudio é transcrito até retomar";
    case "baixando-modelo": {
      const totalMb = download?.totalMb ?? null;
      const total = totalMb !== null && Number.isFinite(totalMb) && totalMb > 0 ? `, ${Math.round(totalMb)} MB` : "";
      return `Baixando o modelo de transcrição (só na primeira vez${total})`;
    }
    case "iniciando":
      return "Começando a escutar o áudio do computador";
    case "erro":
      return erro === null ? "A escuta parou com erro" : `A escuta parou: ${erro}`;
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
  const nomeDoGrupo = useId();
  return (
    <div id={id} className="menu-da-escuta" role="group" aria-label="Controles da escuta">
      <button
        type="button"
        role="switch"
        className="interruptor interruptor-da-escuta"
        aria-checked={automatico}
        title={
          automatico
            ? "Automático: a pergunta detectada vai sozinha ao chat"
            : "Automático desligado: a escuta só transcreve, nada é enviado"
        }
        onClick={alternarAutomatico}
      >
        <span className="interruptor-trilho" aria-hidden="true" />
        Automático
      </button>
      <fieldset className="grupo-do-menu-da-escuta">
        <legend className="rotulo-tecnico">idioma</legend>
        {IDIOMAS.map(({ valor, rotulo, explicacao }) => (
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
        <legend className="rotulo-tecnico">prioridade do motor</legend>
        {PRIORIDADES.map(({ valor, rotulo, explicacao }) => (
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
 * No composer, com a escuta ligada: o ponto pulsa enquanto o áudio do
 * computador é escutado e fica parado na pausa; ao lado, o selo do motor
 * ("GPU · base · q4") e, baixando, o progresso com o total ("baixando o
 * modelo 45% de 199 MB"). Clicar no selo abre o menu da escuta (Automático,
 * idioma e prioridade do motor), que fecha no Esc, ao clicar fora ou no
 * próprio selo. O botão ao lado alterna pausar e retomar (aria-pressed =
 * pausada); com erro, ele tenta de novo.
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
        title={explicacaoDa(situacao, erro, baixando)}
        aria-label="Controles da escuta"
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        onClick={() => setAberto((atual) => !atual)}
      >
        <span className="ponto-da-escuta" aria-hidden="true" />
        <span className="rotulo-da-escuta" aria-live="polite">
          {rotuloDa(situacao, baixando)}
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
      </button>
      {comBotao && (
        <button
          type="button"
          className="botao-da-escuta"
          aria-label="Pausar a escuta"
          aria-pressed={pausada}
          title={pausada ? "Retomar a escuta" : "Pausar a escuta"}
          onClick={pausada ? retomar : pausar}
        >
          <span aria-hidden="true">{pausada ? "▶" : "❚❚"}</span>
        </button>
      )}
      {situacao === "erro" && (
        <button
          type="button"
          className="botao-da-escuta"
          aria-label="Tentar escutar de novo"
          title="Tentar escutar de novo"
          onClick={retomar}
        >
          <span aria-hidden="true">↻</span>
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
