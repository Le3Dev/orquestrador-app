import type { SituacaoDoOrquestrador, SituacaoDoSubagente, SituacaoDoTurno } from "../shared/api/tipos";
import { useTextos } from "../shared/idioma/idioma";
import { textosDeComponentesComuns } from "../shared/idioma/textos/componentesComuns";

type Situacao = SituacaoDoOrquestrador | SituacaoDoTurno | SituacaoDoSubagente;

const CLASSES: Readonly<Record<Situacao, string>> = {
  ocioso: "",
  trabalhando: "etiqueta-ativa etiqueta-pulso",
  em_andamento: "etiqueta-ativa etiqueta-pulso",
  executando: "etiqueta-ativa etiqueta-pulso",
  concluido: "etiqueta-success",
  falhou: "etiqueta-error",
  cancelado: "etiqueta-warning",
  interrompido: "etiqueta-warning",
};

export function Etiqueta({ situacao }: { situacao: Situacao }) {
  const t = useTextos(textosDeComponentesComuns).situacoes;
  return <span className={`etiqueta ${CLASSES[situacao]}`}>{t[situacao]}</span>;
}
