import { type ReactNode } from "react";

import type { FerramentaDeDesenho } from "../../shared/canvas/desenho";
import {
  CORES_DO_DESENHO,
  type CorDoDesenho,
  ESPESSURAS_DO_DESENHO,
  type EspessuraDoDesenho,
} from "../../shared/canvas/layout";
import {
  IconeBorracha,
  IconeCaneta,
  IconeDesfazer,
  IconeFechar,
  IconeLinha,
  IconeMarcaTexto,
  IconeRetangulo,
  IconeSelecionar,
  IconeSeta,
  IconeTexto,
} from "../Icones";

/** As ferramentas, na ordem da barra: o nome (leitor de tela), a dica e o ícone. */
const FERRAMENTAS: readonly { ferramenta: FerramentaDeDesenho; nome: string; dica: string; icone: ReactNode }[] = [
  {
    ferramenta: "selecionar",
    nome: "Selecionar",
    dica: "Selecionar: o canvas volta a funcionar como sempre (Esc)",
    icone: <IconeSelecionar />,
  },
  { ferramenta: "caneta", nome: "Caneta", dica: "Caneta: desenho à mão livre", icone: <IconeCaneta /> },
  {
    ferramenta: "marca-texto",
    nome: "Marca-texto",
    dica: "Marca-texto: traço largo e translúcido",
    icone: <IconeMarcaTexto />,
  },
  { ferramenta: "linha", nome: "Linha", dica: "Linha reta: arraste do começo ao fim", icone: <IconeLinha /> },
  { ferramenta: "seta", nome: "Seta", dica: "Seta: arraste do começo até onde ela aponta", icone: <IconeSeta /> },
  {
    ferramenta: "retangulo",
    nome: "Retângulo",
    dica: "Retângulo: arraste de um canto ao canto oposto",
    icone: <IconeRetangulo />,
  },
  {
    ferramenta: "texto",
    nome: "Texto",
    dica: "Texto solto: clique onde ele começa, digite e tecle Enter",
    icone: <IconeTexto />,
  },
  {
    ferramenta: "borracha",
    nome: "Borracha",
    dica: "Borracha: apaga o traço inteiro que tocar",
    icone: <IconeBorracha />,
  },
];

/** O nome de cada cor, para a dica e o leitor de tela. */
const NOMES_DAS_CORES: Readonly<Record<CorDoDesenho, string>> = {
  laranja: "Laranja",
  claro: "Branco",
  azul: "Azul",
  verde: "Verde",
  kraft: "Areia",
  vermelho: "Vermelho",
};

const NOMES_DAS_ESPESSURAS: Readonly<Record<EspessuraDoDesenho, string>> = {
  2: "Fina",
  3: "Média",
  6: "Grossa",
};

const FECHAR_DO_CANVAS = {
  nome: "Fechar a barra de desenho",
  dica: "Fechar a barra de desenho (o desenho continua no canvas)",
};

interface Props {
  ferramenta: FerramentaDeDesenho;
  cor: CorDoDesenho;
  espessura: EspessuraDoDesenho;
  podeDesfazer: boolean;
  aoEscolherFerramenta: (ferramenta: FerramentaDeDesenho) => void;
  aoEscolherCor: (cor: CorDoDesenho) => void;
  aoEscolherEspessura: (espessura: EspessuraDoDesenho) => void;
  aoDesfazer: () => void;
  aoFechar: () => void;
  /** Só estas ferramentas, na ordem da barra (a tela cheia do artefato usa uma barra compacta). Sem isso, todas. */
  ferramentas?: readonly FerramentaDeDesenho[];
  /** Mostra o grupo da espessura (padrão). */
  comEspessura?: boolean;
  /** O nome e a dica do botão de fechar, quando a barra não é a do canvas. */
  fechar?: { nome: string; dica: string };
}

/**
 * A barra de desenho, no alto do canvas: as ferramentas, a cor, a espessura,
 * o desfazer e o fechar. Só mostra e avisa; o estado é da `CamadaDeDesenho`.
 */
export function BarraDeDesenho({
  ferramenta,
  cor,
  espessura,
  podeDesfazer,
  aoEscolherFerramenta,
  aoEscolherCor,
  aoEscolherEspessura,
  aoDesfazer,
  aoFechar,
  ferramentas,
  comEspessura = true,
  fechar = FECHAR_DO_CANVAS,
}: Props) {
  const itens = ferramentas === undefined ? FERRAMENTAS : FERRAMENTAS.filter((item) => ferramentas.includes(item.ferramenta));
  return (
    <div className="barra-de-desenho painel-flutuante" role="toolbar" aria-label="Desenho">
      <div className="grupo-da-barra-de-desenho" role="group" aria-label="Ferramenta">
        {itens.map((item) => (
          <button
            key={item.ferramenta}
            type="button"
            className="botao-icone"
            aria-label={item.nome}
            aria-pressed={ferramenta === item.ferramenta}
            title={item.dica}
            onClick={() => aoEscolherFerramenta(item.ferramenta)}
          >
            {item.icone}
          </button>
        ))}
      </div>
      <span className="separador-da-barra" aria-hidden="true" />
      <div className="grupo-da-barra-de-desenho" role="group" aria-label="Cor">
        {CORES_DO_DESENHO.map((opcao) => (
          <button
            key={opcao}
            type="button"
            className="botao-icone botao-de-cor"
            aria-label={`Cor ${NOMES_DAS_CORES[opcao].toLowerCase()}`}
            aria-pressed={cor === opcao}
            title={NOMES_DAS_CORES[opcao]}
            onClick={() => aoEscolherCor(opcao)}
          >
            <span className={`amostra-de-cor traco-cor-${opcao}`} aria-hidden="true" />
          </button>
        ))}
      </div>
      {comEspessura && (
        <>
          <span className="separador-da-barra" aria-hidden="true" />
          <div className="grupo-da-barra-de-desenho" role="group" aria-label="Espessura">
            {ESPESSURAS_DO_DESENHO.map((opcao) => (
              <button
                key={opcao}
                type="button"
                className="botao-icone"
                aria-label={`Espessura ${NOMES_DAS_ESPESSURAS[opcao].toLowerCase()} (${opcao} pt)`}
                aria-pressed={espessura === opcao}
                title={`${NOMES_DAS_ESPESSURAS[opcao]} (${opcao} pt)`}
                onClick={() => aoEscolherEspessura(opcao)}
              >
                <span className="amostra-de-espessura" style={{ height: opcao }} aria-hidden="true" />
              </button>
            ))}
          </div>
        </>
      )}
      <span className="separador-da-barra" aria-hidden="true" />
      <button
        type="button"
        className="botao-icone"
        aria-label="Desfazer"
        aria-keyshortcuts="Control+Z Meta+Z"
        title="Desfazer o último traço (Ctrl+Z ou ⌘Z)"
        disabled={!podeDesfazer}
        onClick={aoDesfazer}
      >
        <IconeDesfazer />
      </button>
      <button
        type="button"
        className="botao-icone"
        aria-label={fechar.nome}
        title={fechar.dica}
        onClick={aoFechar}
      >
        <IconeFechar tamanho={14} />
      </button>
    </div>
  );
}
