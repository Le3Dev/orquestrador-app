import { usePreferenciasDaTela } from "../../shared/hooks/usePreferenciasDaTela";
import { rodandoNoMac } from "../../shared/ponteDoDesktop";
import "../../theme/controles-de-janela.css";

/*
 * Os controles de janela de um nó do canvas (artefato, nota, terminal e
 * prévia): minimizar, ampliar (tela cheia) e fechar, iguais nos quatro. Cada
 * ação é opcional: só aparece o botão de quem recebe a função.
 *
 * O visual segue o sistema por padrão, como a barra de título do app (a
 * preferência "Controles das janelas" troca para um dos dois estilos, na hora,
 * em todas as janelas; a barra de título do app não muda): no Mac, as bolinhas
 * (vermelha fecha, amarela minimiza, verde amplia) no começo do cabeçalho, com o
 * símbolo no hover do grupo; no Windows, no Linux e no navegador, os botões
 * minimizar, maximizar e fechar no fim do cabeçalho, com ícones finos e o fechar
 * vermelho no hover. Por isso o cabeçalho põe o componente nos dois lugares
 * (`lado="inicio"` e `lado="fim"`) e só um deles desenha algo.
 */

export interface PropsDosControlesDoNo {
  /** Onde o cabeçalho põe este uso do componente: o Mac desenha no início, os demais no fim. */
  lado: "inicio" | "fim";
  /** O que a janela é, já com o artigo: "o terminal", "a nota". Entra nos rótulos ("Fechar o terminal"). */
  objeto: string;
  /** Sem a função, o botão não aparece. */
  aoFechar?: () => void;
  /** Complementa o `title` do fechar (o rótulo continua "Fechar …"). */
  dicaDoFechar?: string;
  aoMinimizar?: () => void;
  /** Minimizada: o botão vira "Restaurar". */
  minimizada?: boolean;
  aoAmpliar?: () => void;
  /** Em tela cheia: o botão vira "Sair da tela cheia". */
  ampliada?: boolean;
  ampliarDesabilitado?: boolean;
}

type Controle = "fechar" | "minimizar" | "ampliar";

/** Os glifos das bolinhas do Mac, no hover do grupo: ×, − e as setas. */
const GLIFOS_DAS_BOLINHAS: Readonly<Record<Controle, string>> = {
  fechar: "M3.2 3.2l3.6 3.6M6.8 3.2l-3.6 3.6",
  minimizar: "M2.6 5h4.8",
  ampliar: "M2.6 2.6h3.2L2.6 5.8zM7.4 7.4H4.2l3.2-3.2z",
};

function GlifoDaBolinha({ controle }: { controle: Controle }) {
  const preenchido = controle === "ampliar";
  return (
    <svg width={8} height={8} viewBox="0 0 10 10" aria-hidden="true">
      <path
        d={GLIFOS_DAS_BOLINHAS[controle]}
        fill={preenchido ? "currentColor" : "none"}
        stroke={preenchido ? "none" : "currentColor"}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

const PROPS_DO_ICONE = {
  width: 12,
  height: 12,
  viewBox: "0 0 12 12",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  "aria-hidden": true,
} as const;

/** Ícones finos, no estilo dos botões do Windows (os mesmos da barra de título do app). */
function IconeDoWindows({ controle, alternado }: { controle: Controle; alternado: boolean }) {
  if (controle === "fechar") {
    return (
      <svg {...PROPS_DO_ICONE}>
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
      </svg>
    );
  }
  if (controle === "minimizar" && !alternado) {
    return (
      <svg {...PROPS_DO_ICONE}>
        <path d="M2 6.5h8" strokeLinecap="round" />
      </svg>
    );
  }
  // Maximizar (um quadrado) ou, com a janela já ampliada ou minimizada, restaurar (dois quadrados).
  return alternado ? (
    <svg {...PROPS_DO_ICONE}>
      <rect x="1.5" y="4" width="6.5" height="6.5" rx="1" />
      <path d="M4 4V2.5a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1H8" />
    </svg>
  ) : (
    <svg {...PROPS_DO_ICONE}>
      <rect x="2" y="2" width="8" height="8" rx="1.25" />
    </svg>
  );
}

export function ControlesDoNo({
  lado,
  objeto,
  aoFechar,
  dicaDoFechar,
  aoMinimizar,
  minimizada = false,
  aoAmpliar,
  ampliada = false,
  ampliarDesabilitado = false,
}: PropsDosControlesDoNo) {
  const { preferencias } = usePreferenciasDaTela();
  // "Automático" segue o sistema; "Estilo Mac" e "Estilo Windows" ignoram-no.
  const noMac = preferencias.controlesDasJanelas === "automatico" ? rodandoNoMac() : preferencias.controlesDasJanelas === "mac";
  if ((lado === "inicio") !== noMac) {
    return null;
  }

  // A ordem das bolinhas do Mac (vermelha, amarela, verde); no Windows é a inversa,
  // como na janela do sistema: minimizar, maximizar, fechar.
  const botoes: { controle: Controle; rotulo: string; dica: string; alternado: boolean; desabilitado: boolean; aoClicar: () => void }[] = [];
  if (aoFechar !== undefined) {
    const rotulo = `Fechar ${objeto}`;
    botoes.push({
      controle: "fechar",
      rotulo,
      dica: dicaDoFechar ?? rotulo,
      alternado: false,
      desabilitado: false,
      aoClicar: aoFechar,
    });
  }
  if (aoMinimizar !== undefined) {
    const rotulo = `${minimizada ? "Restaurar" : "Minimizar"} ${objeto}`;
    botoes.push({ controle: "minimizar", rotulo, dica: rotulo, alternado: minimizada, desabilitado: false, aoClicar: aoMinimizar });
  }
  if (aoAmpliar !== undefined) {
    botoes.push({
      controle: "ampliar",
      rotulo: ampliada ? "Sair da tela cheia" : `Ampliar ${objeto}`,
      dica: ampliada ? "Sair da tela cheia (Esc)" : "Ampliar (tela cheia)",
      alternado: ampliada,
      desabilitado: ampliarDesabilitado,
      aoClicar: aoAmpliar,
    });
  }
  if (botoes.length === 0) {
    return null;
  }

  if (noMac) {
    return (
      <span className="controles-do-no controles-do-no-mac nodrag" role="group" aria-label="Controles da janela">
        {botoes.map((botao) => (
          <button
            key={botao.controle}
            type="button"
            className={`bolinha-do-no bolinha-do-no-${botao.controle} nodrag`}
            aria-label={botao.rotulo}
            title={botao.dica}
            disabled={botao.desabilitado}
            onClick={botao.aoClicar}
          >
            <GlifoDaBolinha controle={botao.controle} />
          </button>
        ))}
      </span>
    );
  }

  const ordemDoWindows: Readonly<Record<Controle, number>> = { minimizar: 0, ampliar: 1, fechar: 2 };
  return (
    <span className="controles-do-no controles-do-no-windows nodrag" role="group" aria-label="Controles da janela">
      <span className="separador-dos-controles-do-no" aria-hidden="true" />
      {[...botoes]
        .sort((a, b) => ordemDoWindows[a.controle] - ordemDoWindows[b.controle])
        .map((botao) => (
          <button
            key={botao.controle}
            type="button"
            className={`botao-do-no botao-do-no-${botao.controle} nodrag`}
            aria-label={botao.rotulo}
            title={botao.dica}
            disabled={botao.desabilitado}
            onClick={botao.aoClicar}
          >
            <IconeDoWindows controle={botao.controle} alternado={botao.alternado} />
          </button>
        ))}
    </span>
  );
}
