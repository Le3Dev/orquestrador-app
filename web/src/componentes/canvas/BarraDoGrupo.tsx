import { memo, type ReactNode } from "react";

import type { Alinhamento, EixoDaDistribuicao } from "../../shared/canvas/layout";
import type { ResumoDoGrupo } from "../../shared/canvas/nos";
import { IconeFechar, IconeGrade, IconeMinimizar, IconeRestaurar } from "../Icones";

/** Um ícone de 24 × 24 em traço, na cor do botão. */
function Quadro({ children }: { children: ReactNode }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Uma linha-guia e duas janelas encostadas nela, uma para cada alinhamento. */
const ICONES_DO_ALINHAMENTO: Readonly<Record<Alinhamento, ReactNode>> = {
  esquerda: (
    <Quadro>
      <path d="M4 3v18" />
      <rect x="7" y="6" width="12" height="4" rx="1.2" />
      <rect x="7" y="14" width="7" height="4" rx="1.2" />
    </Quadro>
  ),
  centro: (
    <Quadro>
      <path d="M12 3v18" />
      <rect x="5" y="6" width="14" height="4" rx="1.2" />
      <rect x="8" y="14" width="8" height="4" rx="1.2" />
    </Quadro>
  ),
  direita: (
    <Quadro>
      <path d="M20 3v18" />
      <rect x="5" y="6" width="12" height="4" rx="1.2" />
      <rect x="10" y="14" width="7" height="4" rx="1.2" />
    </Quadro>
  ),
  topo: (
    <Quadro>
      <path d="M3 4h18" />
      <rect x="6" y="7" width="4" height="12" rx="1.2" />
      <rect x="14" y="7" width="4" height="7" rx="1.2" />
    </Quadro>
  ),
  meio: (
    <Quadro>
      <path d="M3 12h18" />
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="8" width="4" height="8" rx="1.2" />
    </Quadro>
  ),
  base: (
    <Quadro>
      <path d="M3 20h18" />
      <rect x="6" y="5" width="4" height="12" rx="1.2" />
      <rect x="14" y="10" width="4" height="7" rx="1.2" />
    </Quadro>
  ),
};

const ICONES_DA_DISTRIBUICAO: Readonly<Record<EixoDaDistribuicao, ReactNode>> = {
  horizontal: (
    <Quadro>
      <path d="M3 4v16M21 4v16" />
      <rect x="9" y="6" width="6" height="12" rx="1.2" />
    </Quadro>
  ),
  vertical: (
    <Quadro>
      <path d="M4 3h16M4 21h16" />
      <rect x="6" y="9" width="12" height="6" rx="1.2" />
    </Quadro>
  ),
};

const ROTULOS_DO_ALINHAMENTO: Readonly<Record<Alinhamento, string>> = {
  esquerda: "Alinhar à esquerda",
  centro: "Alinhar ao centro",
  direita: "Alinhar à direita",
  topo: "Alinhar ao topo",
  meio: "Alinhar ao meio",
  base: "Alinhar à base",
};

const ROTULOS_DA_DISTRIBUICAO: Readonly<Record<EixoDaDistribuicao, string>> = {
  horizontal: "Distribuir na horizontal",
  vertical: "Distribuir na vertical",
};

const ALINHAMENTOS_NA_HORIZONTAL: readonly Alinhamento[] = ["esquerda", "centro", "direita"];
const ALINHAMENTOS_NA_VERTICAL: readonly Alinhamento[] = ["topo", "meio", "base"];

function plural(quantidade: number, singular: string, varias: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : varias}`;
}

/**
 * A pergunta do "Fechar" do grupo: quantas telas saem, que os orquestradores
 * continuam salvos, que os shells são encerrados e o que fica no canvas.
 */
function textoParaFecharOGrupo(resumo: ResumoDoGrupo): string {
  const partes = [
    `Fechar ${plural(resumo.fechaveis, "tela", "telas")}? Os orquestradores continuam salvos e voltam pela Doca.`,
  ];
  if (resumo.shells > 0) {
    partes.push(
      resumo.shells === 1 ? "O terminal de shell é encerrado." : `Os ${resumo.shells} terminais de shell são encerrados.`,
    );
  }
  if (resumo.fechaveis < resumo.ids.length) {
    partes.push("Notas e rascunhos ficam no canvas.");
  }
  return partes.join(" ");
}

interface PropsDaBarraDoGrupo {
  resumo: ResumoDoGrupo;
  aoAlinhar: (como: Alinhamento) => void;
  aoDistribuir: (eixo: EixoDaDistribuicao) => void;
  aoPorLadoALado: () => void;
  aoMinimizar: () => void;
  aoFechar: () => void;
}

function BotaoDoGrupo({
  rotulo,
  dica = rotulo,
  desabilitado = false,
  perigo = false,
  aoClicar,
  children,
}: {
  rotulo: string;
  dica?: string;
  desabilitado?: boolean;
  perigo?: boolean;
  aoClicar: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`botao-icone${perigo ? " botao-icone-perigo" : ""}`}
      aria-label={rotulo}
      title={dica}
      disabled={desabilitado}
      onClick={aoClicar}
    >
      {children}
    </button>
  );
}

/**
 * A barra das ações sobre as telas selecionadas, centralizada no alto do
 * canvas, logo abaixo da barra do canvas (o canvas só a mostra com duas ou
 * mais telas selecionadas): alinhar, distribuir, lado a lado, minimizar
 * e fechar. Os bixinhos não contam: seguem o terminal deles.
 */
export const BarraDoGrupo = memo(function BarraDoGrupo({
  resumo,
  aoAlinhar,
  aoDistribuir,
  aoPorLadoALado,
  aoMinimizar,
  aoFechar,
}: PropsDaBarraDoGrupo) {
  const quantidade = resumo.ids.length;
  const fechar = () => {
    if (!window.confirm(textoParaFecharOGrupo(resumo))) {
      return;
    }
    aoFechar();
  };
  const rotuloDoMinimizar = resumo.todasMinimizadas ? "Restaurar" : "Minimizar";

  return (
    <div
      role="toolbar"
      aria-label="Ações do grupo"
      className="barra-do-grupo painel-flutuante nodrag nopan nowheel"
    >
      <span className="contagem-do-grupo mono">{plural(quantidade, "tela", "telas")}</span>
      <span className="separador-da-barra" aria-hidden="true" />
      {ALINHAMENTOS_NA_HORIZONTAL.map((como) => (
        <BotaoDoGrupo key={como} rotulo={ROTULOS_DO_ALINHAMENTO[como]} aoClicar={() => aoAlinhar(como)}>
          {ICONES_DO_ALINHAMENTO[como]}
        </BotaoDoGrupo>
      ))}
      {ALINHAMENTOS_NA_VERTICAL.map((como) => (
        <BotaoDoGrupo key={como} rotulo={ROTULOS_DO_ALINHAMENTO[como]} aoClicar={() => aoAlinhar(como)}>
          {ICONES_DO_ALINHAMENTO[como]}
        </BotaoDoGrupo>
      ))}
      <span className="separador-da-barra" aria-hidden="true" />
      {(["horizontal", "vertical"] as const).map((eixo) => (
        <BotaoDoGrupo
          key={eixo}
          rotulo={ROTULOS_DA_DISTRIBUICAO[eixo]}
          dica={quantidade < 3 ? `${ROTULOS_DA_DISTRIBUICAO[eixo]}: selecione 3 ou mais telas` : undefined}
          desabilitado={quantidade < 3}
          aoClicar={() => aoDistribuir(eixo)}
        >
          {ICONES_DA_DISTRIBUICAO[eixo]}
        </BotaoDoGrupo>
      ))}
      <BotaoDoGrupo rotulo="Lado a lado" dica="Lado a lado: as telas numa grade, com margem" aoClicar={aoPorLadoALado}>
        <IconeGrade tamanho={13} />
      </BotaoDoGrupo>
      <span className="separador-da-barra" aria-hidden="true" />
      <BotaoDoGrupo
        rotulo={rotuloDoMinimizar}
        dica={
          resumo.minimizaveis === 0
            ? "Minimizar: só notas, prévias e terminais se minimizam"
            : `${rotuloDoMinimizar} ${plural(resumo.minimizaveis, "tela", "telas")} (notas, prévias e terminais)`
        }
        desabilitado={resumo.minimizaveis === 0}
        aoClicar={aoMinimizar}
      >
        {resumo.todasMinimizadas ? <IconeRestaurar tamanho={13} /> : <IconeMinimizar tamanho={14} />}
      </BotaoDoGrupo>
      <BotaoDoGrupo
        rotulo="Fechar"
        dica={
          resumo.fechaveis === 0
            ? "Fechar: notas e rascunhos não fecham em grupo"
            : `Fechar ${plural(resumo.fechaveis, "tela", "telas")} (notas e rascunhos ficam)`
        }
        desabilitado={resumo.fechaveis === 0}
        perigo
        aoClicar={fechar}
      >
        <IconeFechar tamanho={15} />
      </BotaoDoGrupo>
    </div>
  );
});
