import { useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { AcaoDoApp, ResumoDoOrquestrador } from "../../shared/api/tipos";
import { AVISO_DO_LIMITE_DE_ORQUESTRADORES } from "../../shared/canvas/limiteDeTerminais";
import { CONFIGURACAO_PADRAO_DO_ORQUESTRADOR } from "../../shared/modelos";
import { nomeLivre } from "../../shared/nomeLivre";

export interface PropsDasAcoesDoChat {
  /** Abre (ou foca) o terminal do Orquestrador no canvas. */
  aoAbrirTerminal: (orquestradorId: string) => void;
  /**
   * Se cabe abrir o terminal no canvas (limite de orquestradores abertos). Um
   * já aberto sempre cabe; nulo é um Orquestrador que ainda vai ser criado.
   */
  temVagaPara: (orquestradorId: string | null) => boolean;
  /** Atualiza a lista de Orquestradores; `criado` é o que o chat acabou de criar. */
  aoAtualizarOrquestradores: (criado?: ResumoDoOrquestrador) => Promise<void>;
}

interface Props extends PropsDasAcoesDoChat {
  acao: AcaoDoApp;
}

type Etapa =
  | { tipo: "pronto" }
  | { tipo: "executando" }
  | { tipo: "feito"; orquestradorId: string }
  | { tipo: "erro"; mensagem: string };

/** Compara pastas sem diferenciar maiúsculas nem `\` de `/` (e sem a barra final). */
function mesmaPasta(a: string, b: string): boolean {
  const normalizar = (pasta: string) => pasta.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalizar(a) === normalizar(b);
}

/** Instante do último uso: o início do último turno ou, sem turnos, a criação. */
function ultimoUso(orquestrador: ResumoDoOrquestrador): number {
  const criado = Date.parse(orquestrador.criadoEm);
  const turno = orquestrador.ultimoTurno === null ? Number.NaN : Date.parse(orquestrador.ultimoTurno.iniciadoEm);
  return Math.max(Number.isNaN(criado) ? 0 : criado, Number.isNaN(turno) ? 0 : turno);
}

/** Entre os Orquestradores da pasta, o usado mais recentemente. */
function maisRecente(daPasta: readonly ResumoDoOrquestrador[]): ResumoDoOrquestrador | undefined {
  let escolhido: ResumoDoOrquestrador | undefined;
  for (const item of daPasta) {
    if (escolhido === undefined || ultimoUso(item) > ultimoUso(escolhido)) {
      escolhido = item;
    }
  }
  return escolhido;
}

/**
 * Ação sugerida pelo Claude no chat: abrir um Orquestrador num projeto (e,
 * se houver, já mandar o pedido para ele). Só acontece no clique. Sem `novo`,
 * reaproveita o Orquestrador da mesma pasta (o usado mais recentemente, se
 * houver vários) ou cria um; com `novo`, cria sempre, com um nome que não se
 * repete na pasta. Quem é criado recebe a configuração padrão. Depois abre o
 * terminal dele no canvas.
 */
export function CartaoDeAcao({ acao, aoAbrirTerminal, temVagaPara, aoAtualizarOrquestradores }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "pronto" });
  const novo = acao.novo === true;

  async function executar(): Promise<void> {
    if (etapa.tipo === "executando") {
      return;
    }
    // Já feito: só reabre o terminal, sem criar outro nem reenviar o pedido.
    if (etapa.tipo === "feito") {
      if (!temVagaPara(etapa.orquestradorId)) {
        setEtapa({ tipo: "erro", mensagem: AVISO_DO_LIMITE_DE_ORQUESTRADORES });
        return;
      }
      aoAbrirTerminal(etapa.orquestradorId);
      return;
    }
    setEtapa({ tipo: "executando" });
    try {
      const existentes = await api.listarOrquestradores();
      const daPasta = existentes.filter((item) => mesmaPasta(item.pastaDeTrabalho, acao.pasta));
      let orquestrador = novo ? undefined : maisRecente(daPasta);
      // Confere a vaga antes de criar: sem ela, nada é criado nem enviado.
      if (!temVagaPara(orquestrador?.id ?? null)) {
        setEtapa({ tipo: "erro", mensagem: AVISO_DO_LIMITE_DE_ORQUESTRADORES });
        return;
      }
      if (orquestrador === undefined) {
        orquestrador = await api.criarOrquestrador({
          nome: nomeLivre(acao.projeto, daPasta.map((item) => item.nome)),
          pastaDeTrabalho: acao.pasta,
          ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
        });
        await aoAtualizarOrquestradores(orquestrador);
      }
      aoAbrirTerminal(orquestrador.id);
      if (acao.pedido !== null && acao.pedido.trim() !== "") {
        await api.enviarMensagem(orquestrador.id, acao.pedido);
      }
      setEtapa({ tipo: "feito", orquestradorId: orquestrador.id });
    } catch (falha) {
      setEtapa({ tipo: "erro", mensagem: mensagemDeErro(falha) });
    }
  }

  return (
    <div className="cartao-de-acao">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-titulo text-[12.5px] font-medium text-primary">
          {novo ? "Novo orquestrador em" : "Abrir orquestrador em"} {acao.projeto}
        </span>
        <span className="mono truncate text-muted" title={acao.pasta}>
          {acao.pasta}
        </span>
        {acao.pedido !== null && acao.pedido.trim() !== "" && (
          <span className="texto-longo text-[12px] text-secondary">pedido: {acao.pedido}</span>
        )}
        {etapa.tipo === "erro" && (
          <span className="hint-error texto-longo" role="alert">
            {etapa.mensagem}
          </span>
        )}
      </div>
      <button
        type="button"
        className={`btn btn-sm ${etapa.tipo === "feito" ? "btn-outline" : "btn-cta"}`}
        disabled={etapa.tipo === "executando"}
        onClick={() => void executar()}
      >
        {etapa.tipo === "executando"
          ? novo
            ? "criando…"
            : "abrindo…"
          : etapa.tipo === "feito"
            ? "aberto ✓"
            : etapa.tipo === "erro"
              ? "tentar de novo"
              : novo
                ? "criar"
                : "abrir"}
      </button>
    </div>
  );
}
