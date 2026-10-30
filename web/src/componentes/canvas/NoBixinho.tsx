import { Handle, type NodeProps, NodeToolbar, Position } from "@xyflow/react";
import { memo } from "react";

import { aparenciaDoBixinho } from "../../shared/canvas/bixinhos";
import { useCanvas } from "../../shared/canvas/contexto";
import { type NoBixinho as TipoDoNo, subagentesVisiveis } from "../../shared/canvas/nos";
import type { SubagenteNaTela } from "../../shared/estado/aplicarEvento";
import { formatarDecorrido, formatarTokens, idCurto } from "../../shared/formatacao";
import { useRelogio } from "../../shared/hooks/useRelogio";
import { Etiqueta } from "../Etiqueta";
import { TextoFormatado } from "../TextoFormatado";
import { Bixinho } from "./Bixinho";

function Ficha({ subagente, nome, agora }: { subagente: SubagenteNaTela; nome: string; agora: Date }) {
  const executando = subagente.situacao === "executando";
  const conteudo = subagente.resultado || subagente.textos.join("\n\n") || subagente.resumo;

  return (
    <div className="ficha-do-bixinho nowheel nodrag">
      <div className="flex items-center justify-between gap-2">
        <span className="font-titulo text-[13px] font-semibold">
          {nome} <span className="mono text-muted">executor#{idCurto(subagente.id)}</span>
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

interface PropsDoConteudo {
  subagente: SubagenteNaTela;
  selecionado: boolean;
}

/**
 * O que o bixinho mostra. Só re-renderiza quando o próprio Subagente muda (a
 * conversa preserva o objeto dos Subagentes que um evento não tocou) ou
 * quando é selecionado — e não a cada evento de outro Subagente nem a cada
 * quadro em que o terminal é arrastado. O relógio só corre executando.
 */
export const ConteudoDoBixinho = memo(function ConteudoDoBixinho({ subagente, selecionado }: PropsDoConteudo) {
  const executando = subagente.situacao === "executando";
  const agora = useRelogio(executando);
  const aparencia = aparenciaDoBixinho(subagente.id);
  const fala = executando
    ? subagente.atividade || "pensando…"
    : subagente.situacao === "concluido"
      ? "pronto!"
      : subagente.situacao === "falhou"
        ? "deu ruim…"
        : "zzz";

  return (
    <>
      {/* A linha do terminal chega no topo do desenho, não no balão. */}
      <Handle type="target" position={Position.Top} className="ancora ancora-bixinho" isConnectable={false} />
      {/* Montada só com o bixinho selecionado: a barra do React Flow acompanha
          cada quadro de pan/zoom e varre todos os nós a cada atualização. */}
      {selecionado && (
        <NodeToolbar isVisible position={Position.Right} offset={14}>
          <Ficha subagente={subagente} nome={aparencia.nome} agora={agora} />
        </NodeToolbar>
      )}

      <div
        className={`no-bixinho no-bixinho-${subagente.situacao} ${selecionado ? "no-bixinho-selecionado" : ""}`}
        title="Clique para ver a tarefa e o relatório"
      >
        <div className="balao-do-bixinho">
          <span className={executando ? "cursor" : ""}>{fala}</span>
        </div>
        <Bixinho aparencia={aparencia} situacao={subagente.situacao} />
        <span className="font-titulo text-[12px] font-semibold leading-none">
          {aparencia.nome}
          <span className="mono ml-1 font-normal text-muted">#{idCurto(subagente.id)}</span>
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
 * relatório.
 *
 * Esta é só a casca: lê o contexto do canvas, que muda a cada evento de
 * qualquer conversa, e acha o próprio Subagente. O desenho fica no
 * `ConteudoDoBixinho`.
 */
export function NoBixinho({ data, selected }: NodeProps<TipoDoNo>) {
  const { conversas } = useCanvas();
  const subagente = subagentesVisiveis(conversas.get(data.orquestradorId)).find(
    (candidato) => candidato.id === data.subagenteId,
  );

  if (subagente === undefined) {
    return null;
  }

  return <ConteudoDoBixinho subagente={subagente} selecionado={selected} />;
}
