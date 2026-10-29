import { useId } from "react";

import type { DadosDaConfiguracao, DadosDaQuantidade, ModeloClaude, NivelDePermissao } from "../shared/api/tipos";
import { ROTULOS_DAS_PERMISSOES, ROTULOS_DOS_MODELOS } from "../shared/formatacao";

const LIMITE_DE_SUBAGENTES = 10;

interface Opcao<Valor extends string> {
  valor: Valor;
  titulo: string;
  descricao?: string;
}

const MODELOS: readonly Opcao<ModeloClaude>[] = (["opus", "sonnet", "haiku"] as const).map((modelo) => ({
  valor: modelo,
  titulo: ROTULOS_DOS_MODELOS[modelo].nome,
  descricao: ROTULOS_DOS_MODELOS[modelo].descricao,
}));

const PERMISSOES: readonly Opcao<NivelDePermissao>[] = (["leitura", "edicao", "edicao_e_comandos"] as const).map(
  (nivel) => ({ valor: nivel, titulo: ROTULOS_DAS_PERMISSOES[nivel].nome }),
);

const MODOS: readonly Opcao<DadosDaQuantidade["modo"]>[] = [
  { valor: "automatica", titulo: "Automática", descricao: "Ele decide, até o máximo" },
  { valor: "fixa", titulo: "Fixa", descricao: "Sempre essa quantidade" },
];

interface PropsDoSegmentado<Valor extends string> {
  rotulo: string;
  opcoes: readonly Opcao<Valor>[];
  valor: Valor;
  aoEscolher: (valor: Valor) => void;
}

/** Grupo de opções lado a lado (rádios), com a escolhida em destaque. */
function Segmentado<Valor extends string>({ rotulo, opcoes, valor, aoEscolher }: PropsDoSegmentado<Valor>) {
  const nome = useId();
  return (
    <fieldset className="field">
      <legend className="label mb-1.5">{rotulo}</legend>
      <div className="segmentado">
        {opcoes.map((opcao) => (
          <label key={opcao.valor}>
            <input
              type="radio"
              name={nome}
              value={opcao.valor}
              checked={valor === opcao.valor}
              onChange={() => aoEscolher(opcao.valor)}
            />
            <span className="font-titulo text-[12px] font-medium">{opcao.titulo}</span>
            {opcao.descricao !== undefined && <span className="text-[10.5px] text-muted">{opcao.descricao}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface Props {
  valor: DadosDaConfiguracao;
  aoMudar: (configuracao: DadosDaConfiguracao) => void;
}

/** Modelos, quantidade de subagentes e permissões — usado ao criar e ao reconfigurar. */
export function CamposDaConfiguracao({ valor, aoMudar }: Props) {
  const idDoLimite = useId();
  const quantidade = valor.quantidadeDeSubagentes;

  function mudar<Campo extends keyof DadosDaConfiguracao>(campo: Campo, novo: DadosDaConfiguracao[Campo]): void {
    aoMudar({ ...valor, [campo]: novo });
  }

  function mudarLimite(limite: number): void {
    if (Number.isInteger(limite)) {
      mudar("quantidadeDeSubagentes", { ...quantidade, limite: Math.min(LIMITE_DE_SUBAGENTES, Math.max(1, limite)) });
    }
  }

  // Consulta de contêiner, e não de tela: os campos vivem dentro de terminais
  // que o usuário redimensiona no canvas.
  return (
    <div className="flex flex-col gap-4 @container">
      <div className="grid gap-4 @xl:grid-cols-2">
        <Segmentado
          rotulo="Modelo do orquestrador"
          opcoes={MODELOS}
          valor={valor.modeloDoOrquestrador}
          aoEscolher={(modelo) => mudar("modeloDoOrquestrador", modelo)}
        />
        <Segmentado
          rotulo="Modelo dos subagentes"
          opcoes={MODELOS}
          valor={valor.modeloDosSubagentes}
          aoEscolher={(modelo) => mudar("modeloDosSubagentes", modelo)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Segmentado
          rotulo="Quantidade de subagentes"
          opcoes={MODOS}
          valor={quantidade.modo}
          aoEscolher={(modo) => mudar("quantidadeDeSubagentes", { ...quantidade, modo })}
        />
        <div className="field">
          <label className="label" htmlFor={idDoLimite}>
            {quantidade.modo === "automatica" ? "Máximo" : "Quantidade"}
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-sm btn-outline w-8 px-0"
              aria-label="Diminuir"
              disabled={quantidade.limite <= 1}
              onClick={() => mudarLimite(quantidade.limite - 1)}
            >
              −
            </button>
            <input
              id={idDoLimite}
              type="number"
              className="input w-14 text-center font-mono"
              min={1}
              max={LIMITE_DE_SUBAGENTES}
              value={quantidade.limite}
              onChange={(evento) => mudarLimite(Number(evento.target.value))}
            />
            <button
              type="button"
              className="btn btn-sm btn-outline w-8 px-0"
              aria-label="Aumentar"
              disabled={quantidade.limite >= LIMITE_DE_SUBAGENTES}
              onClick={() => mudarLimite(quantidade.limite + 1)}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Segmentado
          rotulo="Permissões"
          opcoes={PERMISSOES}
          valor={valor.nivelDePermissao}
          aoEscolher={(nivel) => mudar("nivelDePermissao", nivel)}
        />
        <span className="hint">{ROTULOS_DAS_PERMISSOES[valor.nivelDePermissao].descricao}</span>
      </div>

      <p className="hint">
        Cada subagente consome a cota da sua assinatura do Claude, e todos rodam ao mesmo tempo. Opus em vários
        subagentes gasta a cota mais rápido.
      </p>
    </div>
  );
}
