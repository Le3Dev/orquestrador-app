import { type KeyboardEvent as EventoDeTeclado, type ReactNode, useId, useRef } from "react";

/**
 * Peças das abas de Configurações: a linha (título, descrição e o controle à
 * direita), o interruptor e o controle segmentado de opções exclusivas.
 */

interface PropsDaLinha {
  titulo: string;
  descricao?: ReactNode;
  /** Id do título, para o controle da linha se nomear por ele. */
  idDoTitulo?: string;
  idDaDescricao?: string;
  /** O controle, à direita. */
  children?: ReactNode;
}

export function LinhaDaConfiguracao({ titulo, descricao, idDoTitulo, idDaDescricao, children }: PropsDaLinha) {
  return (
    <div className="cfgapp-linha">
      <div className="cfgapp-linha-texto">
        <b id={idDoTitulo}>{titulo}</b>
        {descricao !== undefined && <span id={idDaDescricao}>{descricao}</span>}
      </div>
      {children}
    </div>
  );
}

interface PropsDoInterruptor {
  titulo: string;
  descricao: ReactNode;
  ligado: boolean;
  aoAlternar: () => void;
  /** aria-disabled, não disabled: lendo ou gravando, o botão continua na navegação por teclado. */
  indisponivel?: boolean;
  ocupado?: boolean;
  /** A descrição vira erro (vermelha). */
  comErro?: boolean;
}

export function InterruptorDaConfiguracao({
  titulo,
  descricao,
  ligado,
  aoAlternar,
  indisponivel = false,
  ocupado = false,
  comErro = false,
}: PropsDoInterruptor) {
  const id = useId();
  const idDoTitulo = `${id}-titulo`;
  const idDaDescricao = `${id}-descricao`;
  return (
    <div className="cfgapp-linha">
      <div className="cfgapp-linha-texto">
        <b id={idDoTitulo}>{titulo}</b>
        <span id={idDaDescricao} className={comErro ? "cfgapp-erro" : undefined}>
          {descricao}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        className="interruptor"
        aria-checked={ligado}
        aria-labelledby={idDoTitulo}
        aria-describedby={idDaDescricao}
        aria-disabled={indisponivel}
        aria-busy={ocupado}
        onClick={() => {
          if (!indisponivel) {
            aoAlternar();
          }
        }}
      >
        <span className="interruptor-trilho" aria-hidden="true" />
      </button>
    </div>
  );
}

export interface OpcaoDoSegmentado<V extends string> {
  valor: V;
  rotulo: string;
  dica?: string;
}

interface PropsDoSegmentado<V extends string> {
  titulo: string;
  descricao: ReactNode;
  opcoes: readonly OpcaoDoSegmentado<V>[];
  valor: V;
  aoEscolher: (valor: V) => void;
}

/**
 * Opções exclusivas lado a lado (role="radiogroup"). Um Tab entra no grupo, na
 * opção escolhida; as setas movem e escolhem (Home e End vão às pontas).
 */
export function SegmentadoDaConfiguracao<V extends string>({
  titulo,
  descricao,
  opcoes,
  valor,
  aoEscolher,
}: PropsDoSegmentado<V>) {
  const id = useId();
  const idDoTitulo = `${id}-titulo`;
  const idDaDescricao = `${id}-descricao`;
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);

  const aoTeclar = (evento: EventoDeTeclado<HTMLButtonElement>, indice: number) => {
    let destino: number;
    switch (evento.key) {
      case "ArrowRight":
      case "ArrowDown":
        destino = (indice + 1) % opcoes.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        destino = (indice - 1 + opcoes.length) % opcoes.length;
        break;
      case "Home":
        destino = 0;
        break;
      case "End":
        destino = opcoes.length - 1;
        break;
      default:
        return;
    }
    evento.preventDefault();
    const nova = opcoes[destino];
    if (nova === undefined) {
      return;
    }
    aoEscolher(nova.valor);
    botoes.current[destino]?.focus();
  };

  return (
    <div className="cfgapp-linha cfgapp-linha-segmentada">
      <div className="cfgapp-linha-texto">
        <b id={idDoTitulo}>{titulo}</b>
        <span id={idDaDescricao}>{descricao}</span>
      </div>
      <div className="cfgapp-segmentado" role="radiogroup" aria-labelledby={idDoTitulo} aria-describedby={idDaDescricao}>
        {opcoes.map((opcao, indice) => (
          <button
            key={opcao.valor}
            ref={(elemento) => {
              botoes.current[indice] = elemento;
            }}
            type="button"
            role="radio"
            aria-checked={opcao.valor === valor}
            tabIndex={opcao.valor === valor ? 0 : -1}
            title={opcao.dica}
            onKeyDown={(evento) => aoTeclar(evento, indice)}
            onClick={() => aoEscolher(opcao.valor)}
          >
            {opcao.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
