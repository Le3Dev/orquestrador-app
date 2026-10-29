import type { SituacaoDoOrquestrador, SituacaoDoSubagente, SituacaoDoTurno } from "../shared/api/tipos";

type Situacao = SituacaoDoOrquestrador | SituacaoDoTurno | SituacaoDoSubagente;

const APARENCIA: Readonly<Record<Situacao, { rotulo: string; classe: string }>> = {
  ocioso: { rotulo: "Ocioso", classe: "" },
  trabalhando: { rotulo: "Trabalhando", classe: "etiqueta-ativa etiqueta-pulso" },
  em_andamento: { rotulo: "Em andamento", classe: "etiqueta-ativa etiqueta-pulso" },
  executando: { rotulo: "Executando", classe: "etiqueta-ativa etiqueta-pulso" },
  concluido: { rotulo: "Concluído", classe: "etiqueta-success" },
  falhou: { rotulo: "Falhou", classe: "etiqueta-error" },
  cancelado: { rotulo: "Cancelado", classe: "etiqueta-warning" },
  interrompido: { rotulo: "Interrompido", classe: "etiqueta-warning" },
};

export function Etiqueta({ situacao }: { situacao: Situacao }) {
  const { rotulo, classe } = APARENCIA[situacao];
  return <span className={`etiqueta ${classe}`}>{rotulo}</span>;
}
