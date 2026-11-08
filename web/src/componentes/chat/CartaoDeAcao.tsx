import { useState } from "react";

import { api, ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import { type AcaoDoApp, LIMITE_DA_FILA, type ResumoDoOrquestrador } from "../../shared/api/tipos";
import { AVISO_DO_LIMITE_DE_ORQUESTRADORES } from "../../shared/canvas/limiteDeTerminais";
import { formatarDecorrido } from "../../shared/formatacao";
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
  /**
   * A lista de Orquestradores da tela, atualizada a cada poucos segundos: o
   * cartão mostra, antes do clique, o estado de quem vai receber o pedido.
   */
  orquestradores: readonly ResumoDoOrquestrador[];
}

interface Props extends PropsDasAcoesDoChat {
  acao: AcaoDoApp;
}

/** Abrir (como sempre), colocar o pedido na fila de um ocupado ou criar outro. */
type Modo = "abrir" | "fila" | "criar";

type Etapa =
  | { tipo: "pronto" }
  | { tipo: "executando"; modo: Modo }
  | { tipo: "feito"; orquestradorId: string; enfileirado: boolean }
  // No clique, o escolhido estava ocupado: o cartão oferece a fila ou outro, sem mandar nada.
  | { tipo: "ocupado"; orquestrador: ResumoDoOrquestrador }
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

/** Trabalhando ou com um Plano à espera da aprovação: um pedido novo não roda agora. */
function estaOcupado(orquestrador: ResumoDoOrquestrador): boolean {
  return orquestrador.situacao === "trabalhando" || orquestrador.planoPendente === true;
}

/**
 * Quem recebe o pedido: o que o Claude indicou pelo nome, se existe na
 * pasta; senão o ocioso usado mais recentemente; senão o mais recente.
 */
function escolher(
  daPasta: readonly ResumoDoOrquestrador[],
  nome: string | null | undefined,
): ResumoDoOrquestrador | undefined {
  const chave = (nome ?? "").trim().toLowerCase();
  const indicado = chave === "" ? undefined : daPasta.find((item) => item.nome.trim().toLowerCase() === chave);
  return indicado ?? maisRecente(daPasta.filter((item) => !estaOcupado(item))) ?? maisRecente(daPasta);
}

/**
 * Ex.: "ocioso", "trabalhando há 12min 05s em “corrigir…”", "2 na fila",
 * "alterações sem commit". As alterações são aproximadas: um worktree que
 * ficou com o orquestrador parado (o fim do turno remove os limpos).
 */
function descreverEstado(orquestrador: ResumoDoOrquestrador, agora: Date): string {
  const partes: string[] = [];
  if (orquestrador.situacao === "trabalhando") {
    const turno = orquestrador.ultimoTurno;
    partes.push(
      turno === null
        ? "trabalhando"
        : `trabalhando há ${formatarDecorrido(turno.iniciadoEm, null, agora)} em “${turno.texto}”`,
    );
  } else if (orquestrador.planoPendente === true) {
    partes.push("aguardando aprovação do plano");
  } else {
    partes.push("ocioso");
  }
  const fila = orquestrador.fila?.length ?? 0;
  if (fila > 0) {
    partes.push(`${fila} na fila`);
  }
  if (orquestrador.situacao === "ocioso" && orquestrador.worktree !== null) {
    partes.push("alterações sem commit");
  }
  return partes.join(" · ");
}

function avisoDeFilaCheia(nome: string): string {
  return `A fila de "${nome}" está cheia (máximo ${LIMITE_DA_FILA} pedidos). Crie outro orquestrador ou espere a fila andar.`;
}

/**
 * Ação sugerida pelo Claude no chat: abrir um Orquestrador num projeto (e,
 * se houver, já mandar o pedido para ele). Só acontece no clique. Sem `novo`,
 * reaproveita um Orquestrador da mesma pasta (o indicado pelo Claude, senão
 * um ocioso, senão o usado mais recentemente) ou cria um; com `novo`, cria
 * sempre. Quem é criado recebe o nome da função sugerido pelo Claude (ou,
 * sem ele, o do projeto), sem repetir um nome da pasta, e a configuração
 * padrão. Depois abre o terminal dele no canvas.
 *
 * Antes do clique, mostra o estado de quem vai receber o pedido. Ocupado
 * (trabalhando ou com Plano pendente), o cartão troca o botão por dois:
 * colocar o pedido na fila dele ou criar outro orquestrador. A escolha é
 * refeita no clique com a lista do servidor, não com a da resposta do chat.
 */
export function CartaoDeAcao({ acao, aoAbrirTerminal, temVagaPara, aoAtualizarOrquestradores, orquestradores }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "pronto" });
  const novo = acao.novo === true;
  const pedido = acao.pedido !== null && acao.pedido.trim() !== "" ? acao.pedido : null;

  const daPastaNaTela = orquestradores.filter((item) => mesmaPasta(item.pastaDeTrabalho, acao.pasta));
  const escolhido = novo
    ? undefined
    : etapa.tipo === "ocupado"
      ? etapa.orquestrador
      : escolher(daPastaNaTela, acao.orquestrador);
  const ocupado = etapa.tipo === "ocupado" || (escolhido !== undefined && estaOcupado(escolhido));
  // O nome só vale para quem a ação criar; reaproveitando um existente, fica de lado.
  const baseDoNome = acao.nome?.trim() || acao.projeto;
  const nomeSugerido = nomeLivre(baseDoNome, daPastaNaTela.map((item) => item.nome));
  // Fila ou outro: só com um pedido a mandar e enquanto o "abrir" não estiver em curso.
  const oferecerFila =
    !novo &&
    pedido !== null &&
    ocupado &&
    etapa.tipo !== "feito" &&
    !(etapa.tipo === "executando" && etapa.modo === "abrir");

  async function executar(modo: Modo): Promise<void> {
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
    const mostrado = escolhido?.id;
    setEtapa({ tipo: "executando", modo });
    try {
      const existentes = await api.listarOrquestradores();
      const daPasta = existentes.filter((item) => mesmaPasta(item.pastaDeTrabalho, acao.pasta));
      let orquestrador: ResumoDoOrquestrador | undefined;
      if (modo === "fila") {
        // O mesmo que o cartão mostrou, se ainda existe; senão a escolha de novo.
        orquestrador = daPasta.find((item) => item.id === mostrado) ?? escolher(daPasta, acao.orquestrador);
      } else if (modo === "abrir" && !novo) {
        orquestrador = escolher(daPasta, acao.orquestrador);
        // Ficou ocupado depois da resposta: em vez de mandar (o servidor recusaria), oferece fila ou outro.
        if (orquestrador !== undefined && pedido !== null && estaOcupado(orquestrador)) {
          setEtapa({ tipo: "ocupado", orquestrador });
          return;
        }
      }
      // Só entra na fila quem segue ocupado; se ele ficou livre, o pedido vai direto.
      const enfileirar = modo === "fila" && orquestrador !== undefined && estaOcupado(orquestrador);
      if (enfileirar && orquestrador !== undefined && (orquestrador.fila?.length ?? 0) >= LIMITE_DA_FILA) {
        setEtapa({ tipo: "erro", mensagem: avisoDeFilaCheia(orquestrador.nome) });
        return;
      }
      // Confere a vaga antes de criar: sem ela, nada é criado nem enviado.
      if (!temVagaPara(orquestrador?.id ?? null)) {
        setEtapa({ tipo: "erro", mensagem: AVISO_DO_LIMITE_DE_ORQUESTRADORES });
        return;
      }
      if (orquestrador === undefined) {
        orquestrador = await api.criarOrquestrador({
          nome: nomeLivre(baseDoNome, daPasta.map((item) => item.nome)),
          pastaDeTrabalho: acao.pasta,
          ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
        });
        await aoAtualizarOrquestradores(orquestrador);
      }
      aoAbrirTerminal(orquestrador.id);
      if (pedido !== null) {
        if (enfileirar) {
          try {
            await api.enfileirarPedido(orquestrador.id, pedido);
          } catch (falha) {
            const cheia = falha instanceof ErroDaApi && falha.status === 409;
            setEtapa({ tipo: "erro", mensagem: cheia ? avisoDeFilaCheia(orquestrador.nome) : mensagemDeErro(falha) });
            return;
          }
        } else {
          await api.enviarMensagem(orquestrador.id, pedido);
        }
      }
      setEtapa({ tipo: "feito", orquestradorId: orquestrador.id, enfileirado: enfileirar });
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
        {pedido !== null && <span className="texto-longo text-[12px] text-secondary">pedido: {pedido}</span>}
        {(escolhido === undefined || oferecerFila) && etapa.tipo !== "feito" && (
          <span className="mono truncate text-[11.5px] text-secondary" title={nomeSugerido} data-testid="nome-sugerido">
            {oferecerFila ? "se criar outro" : "nome"}: {nomeSugerido}
          </span>
        )}
        {escolhido !== undefined && etapa.tipo !== "feito" && (
          <span className="mono truncate text-[11.5px] text-secondary" data-testid="estado-do-escolhido">
            {escolhido.nome}: {descreverEstado(escolhido, new Date())}
          </span>
        )}
        {etapa.tipo === "erro" && (
          <span className="hint-error texto-longo" role="alert">
            {etapa.mensagem}
          </span>
        )}
      </div>
      {oferecerFila ? (
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            className="btn btn-sm btn-cta"
            disabled={etapa.tipo === "executando"}
            onClick={() => void executar("fila")}
          >
            {etapa.tipo === "executando" && etapa.modo === "fila" ? "enfileirando…" : "Colocar na fila"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={etapa.tipo === "executando"}
            onClick={() => void executar("criar")}
          >
            {etapa.tipo === "executando" && etapa.modo === "criar" ? "criando…" : "Criar outro"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`btn btn-sm ${etapa.tipo === "feito" ? "btn-outline" : "btn-cta"}`}
          disabled={etapa.tipo === "executando"}
          onClick={() => void executar("abrir")}
        >
          {etapa.tipo === "executando"
            ? novo
              ? "criando…"
              : "abrindo…"
            : etapa.tipo === "feito"
              ? etapa.enfileirado
                ? "na fila ✓"
                : "aberto ✓"
              : etapa.tipo === "erro"
                ? "tentar de novo"
                : novo
                  ? "criar"
                  : "abrir"}
        </button>
      )}
    </div>
  );
}
