import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

import type { DadosDaQuantidade, EsforcoDeRaciocinio } from "../../shared/api/tipos";
import { rotuloDoEsforcoNaCriacao } from "../../shared/formatacao";
import { IconeLapis } from "../Icones";

const LIMITE_DE_SUBAGENTES = 10;

const ESFORCOS: readonly EsforcoDeRaciocinio[] = ["padrao", "baixo", "medio", "alto", "extra_alto", "maximo"];

/** Ex.: "até 3 por vez" (automática) ou "sempre 4" (fixa). */
function textoDaQuantidade({ modo, limite }: DadosDaQuantidade): string {
  return modo === "automatica" ? `até ${limite} por vez` : `sempre ${limite}`;
}

interface PropsDoChip {
  texto: string;
  /** Nome acessível do chip, que diz de quem é o ajuste. */
  rotulo: string;
  /** Diferente do padrão: o chip fica laranja e ganha o × que volta ao padrão. */
  personalizado: boolean;
  rotuloDoLimpar: string;
  aoLimpar: () => void;
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
  /** Encosta o menu na direita do chip (o último da linha, para não estourar a janela). */
  menuNaDireita?: boolean;
  /** O conteúdo do menu; `fechar` fecha e devolve o foco ao chip. */
  children: (fechar: () => void) => ReactNode;
}

/**
 * Chip que mostra um ajuste e abre um menu pequeno para mudá-lo. Fecha com
 * clique fora, com Esc (o foco volta ao chip) e ao escolher.
 */
function ChipComMenu({
  texto,
  rotulo,
  personalizado,
  rotuloDoLimpar,
  aoLimpar,
  aberto,
  aoMudarAberto,
  menuNaDireita = false,
  children,
}: PropsDoChip) {
  const caixa = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // A função mais recente, sem refazer os ouvintes a cada render.
  const mudarAberto = useRef(aoMudarAberto);
  mudarAberto.current = aoMudarAberto;

  useEffect(() => {
    if (!aberto) {
      return;
    }
    function aoApertar(evento: PointerEvent): void {
      if (caixa.current !== null && !caixa.current.contains(evento.target as Node)) {
        mudarAberto.current(false);
      }
    }
    function aoTeclar(evento: globalThis.KeyboardEvent): void {
      if (evento.key === "Escape") {
        // Marca o Esc como tratado: os painéis da barra também ouvem o document.
        evento.preventDefault();
        evento.stopPropagation();
        mudarAberto.current(false);
        chip.current?.focus();
      }
    }
    document.addEventListener("pointerdown", aoApertar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("pointerdown", aoApertar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  // Quando a linha quebra, o chip pode ir para o outro lado: se o menu passar
  // da borda do corpo da criação (que corta o que vaza), ele vira de lado.
  // O menu é recriado a cada abertura, então o ajuste não fica para a próxima.
  useLayoutEffect(() => {
    const elemento = menu.current;
    const corpo = caixa.current?.closest(".corpo-da-criacao");
    if (!aberto || elemento === null || corpo === null || corpo === undefined) {
      return;
    }
    const area = corpo.getBoundingClientRect();
    const posicao = elemento.getBoundingClientRect();
    if (menuNaDireita && posicao.left < area.left) {
      elemento.style.right = "auto";
      elemento.style.left = "0";
    } else if (!menuNaDireita && posicao.right > area.right) {
      elemento.style.left = "auto";
      elemento.style.right = "0";
    }
  }, [aberto, menuNaDireita]);

  function fechar(): void {
    aoMudarAberto(false);
    chip.current?.focus();
  }

  return (
    <div ref={caixa} className="relative inline-flex min-w-0">
      <div className={`chip-de-ajuste ${personalizado ? "chip-de-ajuste-personalizado" : ""}`}>
        <button
          ref={chip}
          type="button"
          className="chip-de-ajuste-botao"
          aria-label={rotulo}
          aria-expanded={aberto}
          onClick={() => aoMudarAberto(!aberto)}
        >
          <IconeLapis tamanho={12} />
          <span className="truncate">{texto}</span>
        </button>
        {personalizado && (
          <button
            type="button"
            className="chip-de-ajuste-limpar"
            aria-label={rotuloDoLimpar}
            title={rotuloDoLimpar}
            onClick={() => {
              aoLimpar();
              aoMudarAberto(false);
              chip.current?.focus();
            }}
          >
            <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
      {aberto && <div ref={menu} className={`menu-da-criacao ${menuNaDireita ? "right-0" : "left-0"}`}>{children(fechar)}</div>}
    </div>
  );
}

interface PropsDoEsforco {
  /** "do orquestrador" ou "dos subagentes". */
  dono: string;
  valor: EsforcoDeRaciocinio;
  aoEscolher: (esforco: EsforcoDeRaciocinio) => void;
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
}

/** Quanto o modelo pensa antes de responder. No automático, o app não força nada. */
export function ChipDeEsforco({ dono, valor, aoEscolher, aberto, aoMudarAberto }: PropsDoEsforco) {
  const nome = rotuloDoEsforcoNaCriacao(valor).toLowerCase();

  // Setas sobem e descem entre as opções, como numa lista do sistema.
  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>): void {
    if (evento.key !== "ArrowDown" && evento.key !== "ArrowUp") {
      return;
    }
    evento.preventDefault();
    const opcoes = [...evento.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]")];
    const atual = opcoes.indexOf(document.activeElement as HTMLButtonElement);
    const passo = evento.key === "ArrowDown" ? 1 : -1;
    opcoes[(atual + passo + opcoes.length) % opcoes.length]?.focus();
  }

  return (
    <ChipComMenu
      texto={`esforço ${nome}`}
      rotulo={`Esforço ${dono}: ${nome}`}
      personalizado={valor !== "padrao"}
      rotuloDoLimpar={`Voltar o esforço ${dono} ao automático`}
      aoLimpar={() => aoEscolher("padrao")}
      aberto={aberto}
      aoMudarAberto={aoMudarAberto}
    >
      {(fechar) => (
        <div role="listbox" aria-label={`Esforço ${dono}`} className="flex w-[232px] flex-col" onKeyDown={aoTeclar}>
          {ESFORCOS.map((esforco) => (
            <button
              key={esforco}
              type="button"
              role="option"
              aria-selected={esforco === valor}
              className="opcao-do-menu"
              autoFocus={esforco === valor}
              onClick={() => {
                aoEscolher(esforco);
                fechar();
              }}
            >
              <span>{rotuloDoEsforcoNaCriacao(esforco)}</span>
              {esforco === "padrao" && <span className="font-mono text-[10.5px] text-muted">padrão do Claude Code</span>}
            </button>
          ))}
        </div>
      )}
    </ChipComMenu>
  );
}

interface PropsDaQuantidade {
  valor: DadosDaQuantidade;
  /** O padrão da criação: diferente dele, o chip fica laranja e o × volta a ele. */
  padrao: DadosDaQuantidade;
  aoMudar: (quantidade: DadosDaQuantidade) => void;
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
}

/** Quantos subagentes ao mesmo tempo: ele decide até um máximo, ou sempre o mesmo número. */
export function ChipDeQuantidade({ valor, padrao, aoMudar, aberto, aoMudarAberto }: PropsDaQuantidade) {
  const { modo, limite } = valor;
  const texto = textoDaQuantidade(valor);

  function mudarLimite(novo: number): void {
    aoMudar({ modo, limite: Math.min(LIMITE_DE_SUBAGENTES, Math.max(1, novo)) });
  }

  return (
    <ChipComMenu
      texto={texto}
      rotulo={`Subagentes: ${texto}`}
      personalizado={modo !== padrao.modo || limite !== padrao.limite}
      rotuloDoLimpar={`Voltar a quantidade ao padrão, ${textoDaQuantidade(padrao)}`}
      aoLimpar={() => aoMudar(padrao)}
      aberto={aberto}
      aoMudarAberto={aoMudarAberto}
      menuNaDireita
    >
      {() => (
        <div role="dialog" aria-label="Quantos subagentes" className="flex w-[250px] flex-col gap-2.5 p-1.5">
          <div role="group" aria-label="Como contar" className="segmentado-do-menu">
            <button type="button" aria-pressed={modo === "automatica"} onClick={() => aoMudar({ modo: "automatica", limite })}>
              Ele decide
            </button>
            <button type="button" aria-pressed={modo === "fixa"} onClick={() => aoMudar({ modo: "fixa", limite })}>
              Sempre
            </button>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="passo-numerico">
              <button type="button" aria-label="Menos subagentes" disabled={limite <= 1} onClick={() => mudarLimite(limite - 1)}>
                −
              </button>
              <span className="font-mono text-[13px] text-primary" aria-live="polite">
                {limite}
              </span>
              <button
                type="button"
                aria-label="Mais subagentes"
                disabled={limite >= LIMITE_DE_SUBAGENTES}
                onClick={() => mudarLimite(limite + 1)}
              >
                +
              </button>
            </div>
            <span className="text-[12px] leading-snug text-secondary">
              {modo === "automatica"
                ? `Usa de 0 a ${limite} ao mesmo tempo, conforme o pedido.`
                : `Sempre ${limite} ${limite === 1 ? "subagente" : "subagentes"}.`}
            </span>
          </div>
        </div>
      )}
    </ChipComMenu>
  );
}
