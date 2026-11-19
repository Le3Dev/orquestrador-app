import { type ReactNode } from "react";

import type { FerramentaDeDesenho } from "../../shared/canvas/desenho";
import {
  CORES_DO_DESENHO,
  type CorDoDesenho,
  ESPESSURAS_DO_DESENHO,
  type EspessuraDoDesenho,
} from "../../shared/canvas/layout";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDePaineisDoCanvas } from "../../shared/idioma/textos/canvasPaineis";
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

/** As ferramentas, na ordem da barra: o ícone (o nome e a dica vêm do dicionário). */
const FERRAMENTAS: readonly { ferramenta: FerramentaDeDesenho; icone: ReactNode }[] = [
  { ferramenta: "selecionar", icone: <IconeSelecionar /> },
  { ferramenta: "caneta", icone: <IconeCaneta /> },
  { ferramenta: "marca-texto", icone: <IconeMarcaTexto /> },
  { ferramenta: "linha", icone: <IconeLinha /> },
  { ferramenta: "seta", icone: <IconeSeta /> },
  { ferramenta: "retangulo", icone: <IconeRetangulo /> },
  { ferramenta: "texto", icone: <IconeTexto /> },
  { ferramenta: "borracha", icone: <IconeBorracha /> },
];

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
  fechar,
}: Props) {
  const t = useTextos(textosDePaineisDoCanvas);
  const fecharDaBarra = fechar ?? { nome: t.fecharDoCanvasNome, dica: t.fecharDoCanvasDica };
  const itens = ferramentas === undefined ? FERRAMENTAS : FERRAMENTAS.filter((item) => ferramentas.includes(item.ferramenta));
  return (
    <div className="barra-de-desenho painel-flutuante" role="toolbar" aria-label={t.desenho}>
      <div className="grupo-da-barra-de-desenho" role="group" aria-label={t.grupoFerramenta}>
        {itens.map((item) => (
          <button
            key={item.ferramenta}
            type="button"
            className="botao-icone"
            aria-label={t.ferramentas[item.ferramenta].nome}
            aria-pressed={ferramenta === item.ferramenta}
            title={t.ferramentas[item.ferramenta].dica}
            onClick={() => aoEscolherFerramenta(item.ferramenta)}
          >
            {item.icone}
          </button>
        ))}
      </div>
      <span className="separador-da-barra" aria-hidden="true" />
      <div className="grupo-da-barra-de-desenho" role="group" aria-label={t.grupoCor}>
        {CORES_DO_DESENHO.map((opcao) => (
          <button
            key={opcao}
            type="button"
            className="botao-icone botao-de-cor"
            aria-label={t.corRotulo(t.cores[opcao])}
            aria-pressed={cor === opcao}
            title={t.cores[opcao]}
            onClick={() => aoEscolherCor(opcao)}
          >
            <span className={`amostra-de-cor traco-cor-${opcao}`} aria-hidden="true" />
          </button>
        ))}
      </div>
      {comEspessura && (
        <>
          <span className="separador-da-barra" aria-hidden="true" />
          <div className="grupo-da-barra-de-desenho" role="group" aria-label={t.grupoEspessura}>
            {ESPESSURAS_DO_DESENHO.map((opcao) => (
              <button
                key={opcao}
                type="button"
                className="botao-icone"
                aria-label={t.espessuraRotulo(t.espessuras[opcao], opcao)}
                aria-pressed={espessura === opcao}
                title={t.espessuraTitulo(t.espessuras[opcao], opcao)}
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
        aria-label={t.desfazer}
        aria-keyshortcuts="Control+Z Meta+Z"
        title={t.desfazerDica}
        disabled={!podeDesfazer}
        onClick={aoDesfazer}
      >
        <IconeDesfazer />
      </button>
      <button
        type="button"
        className="botao-icone"
        aria-label={fecharDaBarra.nome}
        title={fecharDaBarra.dica}
        onClick={aoFechar}
      >
        <IconeFechar tamanho={14} />
      </button>
    </div>
  );
}
