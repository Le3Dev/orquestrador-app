import { Handle, type NodeProps, NodeToolbar, Position } from "@xyflow/react";
import { memo } from "react";

import { aparenciaDoBixinho, papelQueNomeia } from "../../shared/canvas/bixinhos";
import { type AcoesDoCanvas, useCanvas } from "../../shared/canvas/contexto";
import { iconeDaFerramenta } from "../../shared/canvas/iconesDeFerramenta";
import { type Ancora, type NoBixinho as TipoDoNo, subagentesVisiveis } from "../../shared/canvas/nos";
import type { SubagenteNaTela } from "../../shared/estado/aplicarEvento";
import { formatarDecorrido, formatarTokens, idCurto } from "../../shared/formatacao";
import { useRelogio } from "../../shared/hooks/useRelogio";
import { Etiqueta } from "../Etiqueta";
import { IconeFechar } from "../Icones";
import { TextoFormatado } from "../TextoFormatado";
import { Bixinho, IconeDaFerramenta } from "./Bixinho";

/**
 * A ficha do bixinho selecionado. Com um subagente pronto, o título é o nome
 * dele e o nome do bicho fica só como detalhe; senão, o título é o nome do
 * bicho e o detalhe, o papel (executor nos eventos antigos).
 */
function Ficha({
  subagente,
  nomeDoBicho,
  papelNoTitulo,
  agora,
}: {
  subagente: SubagenteNaTela;
  nomeDoBicho: string;
  papelNoTitulo: string | null;
  agora: Date;
}) {
  const executando = subagente.situacao === "executando";
  const conteudo = subagente.resultado || subagente.textos.join("\n\n") || subagente.resumo;

  return (
    <div className="ficha-do-bixinho nowheel nodrag">
      <div className="flex items-center justify-between gap-2">
        <span className="font-titulo min-w-0 truncate text-[13px] font-semibold">
          {papelNoTitulo ?? nomeDoBicho}{" "}
          <span className="mono text-muted">
            {papelNoTitulo === null ? (subagente.papel ?? "executor") : nomeDoBicho}#{idCurto(subagente.id)}
          </span>
        </span>
        <Etiqueta situacao={subagente.situacao} />
      </div>
      <p className="font-titulo text-[12.5px] font-medium">{subagente.descricao || "Subagente"}</p>
      <p className="mono text-muted">
        {formatarDecorrido(subagente.iniciadoEm, subagente.encerradoEm, agora)} · {subagente.ferramentasUsadas}{" "}
        {subagente.ferramentasUsadas === 1 ? "ferramenta" : "ferramentas"} · {formatarTokens(subagente.tokens)} tokens
      </p>
      <div className="flex flex-col gap-1">
        <span className="rotulo-tecnico">tarefa recebida do orquestrador</span>
        <p className="custom-scrollbar mono texto-longo max-h-32 overflow-y-auto text-caption">{subagente.tarefa || "—"}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="rotulo-tecnico">{executando ? "até agora" : "relatório"}</span>
        <div className="custom-scrollbar max-h-72 overflow-y-auto pr-1">
          <TextoFormatado texto={conteudo || "Ainda sem resultado."} className="markdown-compacto" />
        </div>
      </div>
    </div>
  );
}

/**
 * Onde a linha do terminal pode chegar: no lado do bixinho voltado para o
 * terminal (`ladoDoBixinho`). Em cima, no topo do desenho, não no balão; dos
 * lados, na borda do desenho, na altura do corpo; embaixo, na base do nó.
 */
const ANCORAS_DO_BIXINHO: readonly { id: Ancora; posicao: Position; classe: string }[] = [
  { id: "cima", posicao: Position.Top, classe: "ancora ancora-bixinho" },
  { id: "baixo", posicao: Position.Bottom, classe: "ancora" },
  { id: "esquerda", posicao: Position.Left, classe: "ancora ancora-bixinho-esquerda" },
  { id: "direita", posicao: Position.Right, classe: "ancora ancora-bixinho-direita" },
];

interface PropsDoConteudo {
  subagente: SubagenteNaTela;
  /** O Orquestrador dono do bixinho: vai junto com o id do Subagente ao fechar. */
  orquestradorId: string;
  /** Fecha o bixinho parado (a ação do canvas, estável para o `memo` valer). Só visual: o histórico continua. */
  aoFechar: AcoesDoCanvas["fecharBixinho"];
  selecionado: boolean;
  /** Saindo sozinho do canvas (o Subagente terminou): encolhe e some com fade. */
  saindo?: boolean;
}

/**
 * O que o bixinho mostra. Só re-renderiza quando o próprio Subagente muda (a
 * conversa preserva o objeto dos Subagentes que um evento não tocou) ou
 * quando é selecionado — e não a cada evento de outro Subagente nem a cada
 * quadro em que o terminal é arrastado. O relógio só corre executando.
 */
export const ConteudoDoBixinho = memo(function ConteudoDoBixinho({
  subagente,
  orquestradorId,
  aoFechar,
  selecionado,
  saindo = false,
}: PropsDoConteudo) {
  const executando = subagente.situacao === "executando";
  const agora = useRelogio(executando);
  const aparencia = aparenciaDoBixinho(subagente.id);
  // Só enquanto trabalha: parado, a última ferramenta não diz nada.
  const icone = executando ? iconeDaFerramenta(subagente.ultimaFerramenta) : null;
  const fala = executando
    ? subagente.atividade || "pensando…"
    : subagente.situacao === "concluido"
      ? "pronto!"
      : subagente.situacao === "falhou"
        ? "deu ruim…"
        : "zzz";
  // Um subagente pronto (ou outro tipo com papel) dá o nome ao bixinho, no
  // lugar do nome do bicho; o desenho continua o mesmo. O workflow segue com o
  // bicho e o papel ao lado; o executor comum, que é a maioria, só no tooltip e
  // na ficha, para não repetir em todo bixinho.
  const papelQueDaNome = papelQueNomeia(subagente.papel);
  const papelNoRotulo =
    papelQueDaNome === null && subagente.papel !== null && subagente.papel !== "executor" ? subagente.papel : null;
  const dica = "Clique para ver a tarefa e o relatório";
  const nomeParaFechar = papelQueDaNome ?? aparencia.nome;

  return (
    <>
      {ANCORAS_DO_BIXINHO.map(({ id, posicao, classe }) => (
        <Handle key={id} id={id} type="target" position={posicao} className={classe} isConnectable={false} />
      ))}
      {/* Montada só com o bixinho selecionado: a barra do React Flow acompanha
          cada quadro de pan/zoom e varre todos os nós a cada atualização. */}
      {selecionado && (
        <NodeToolbar isVisible position={Position.Right} offset={14}>
          <Ficha subagente={subagente} nomeDoBicho={aparencia.nome} papelNoTitulo={papelQueDaNome} agora={agora} />
        </NodeToolbar>
      )}

      <div
        className={`no-bixinho no-bixinho-${subagente.situacao} ${selecionado ? "no-bixinho-selecionado" : ""} ${saindo ? "no-bixinho-saindo" : ""}`}
        title={subagente.papel === null ? dica : `${subagente.papel} · ${dica.toLowerCase()}`}
      >
        <div className="balao-do-bixinho">
          <span className={executando ? "cursor" : ""}>{fala}</span>
        </div>
        {/* Quem ainda executa não fecha. Quem falhou fica até o usuário ver o erro e fechar; o clique não chega
            ao nó (não abre a ficha) e o `nodrag` impede o arraste. */}
        {!executando && (
          <button
            type="button"
            className="fechar-do-bixinho nodrag"
            aria-label={`Fechar subagente ${nomeParaFechar}`}
            title="Fechar subagente (o histórico continua no terminal)"
            onClick={(evento) => {
              evento.stopPropagation();
              aoFechar(orquestradorId, subagente.id);
            }}
          >
            <IconeFechar tamanho={10} />
          </button>
        )}
        {icone !== null && <IconeDaFerramenta icone={icone} />}
        <Bixinho aparencia={aparencia} situacao={subagente.situacao} />
        {/* Nome longo corta com reticências; o #id fica sempre visível (o nome inteiro, no tooltip). */}
        <span className="font-titulo flex max-w-full items-baseline text-[12px] font-semibold leading-none">
          <span className="min-w-0 truncate">
            {papelQueDaNome ?? aparencia.nome}
            {papelNoRotulo !== null && <span className="font-normal"> · {papelNoRotulo}</span>}
          </span>
          <span className="mono ml-1 shrink-0 font-normal text-muted">#{idCurto(subagente.id)}</span>
        </span>
        <span className="mono text-muted">
          {formatarDecorrido(subagente.iniciadoEm, subagente.encerradoEm, agora)} · {formatarTokens(subagente.tokens)} tok
        </span>
      </div>
    </>
  );
});

/**
 * Um Subagente no canvas. Fica preso ao terminal do Orquestrador (move junto
 * com ele), mas pode ser arrastado; clicando, abre a ficha com a tarefa e o
 * relatório. Quando o Subagente conclui ou é cancelado, sai sozinho depois de
 * alguns segundos (`useSaidaDosBixinhos`), com a classe `no-bixinho-saindo`.
 *
 * Esta é só a casca: lê o contexto do canvas, que muda a cada evento de
 * qualquer conversa, e acha o próprio Subagente. O desenho fica no
 * `ConteudoDoBixinho`.
 */
export function NoBixinho({ id, data, selected }: NodeProps<TipoDoNo>) {
  const { conversas, bixinhosSaindo, acoes } = useCanvas();
  const subagente = subagentesVisiveis(conversas.get(data.orquestradorId)).find(
    (candidato) => candidato.id === data.subagenteId,
  );

  if (subagente === undefined) {
    return null;
  }

  return (
    <ConteudoDoBixinho
      subagente={subagente}
      orquestradorId={data.orquestradorId}
      aoFechar={acoes.fecharBixinho}
      selecionado={selected}
      saindo={bixinhosSaindo?.has(id) === true}
    />
  );
}
