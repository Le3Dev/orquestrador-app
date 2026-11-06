import { useId, useState } from "react";

import { mensagemDeErro } from "../shared/api/cliente";
import type {
  DadosDaConfiguracao,
  DadosDaPredefinicao,
  DadosDaQuantidade,
  DadosDoEsforcoHerdado,
  EsforcoDeRaciocinio,
  EsforcosHerdados,
  ModeloClaude,
  NivelDePermissao,
  NomeDaPredefinicao,
} from "../shared/api/tipos";
import { ROTULOS_DAS_PERMISSOES, ROTULOS_DOS_ESFORCOS, ROTULOS_DOS_MODELOS } from "../shared/formatacao";
import { ajudaDaPredefinicao, useEsforcosHerdados, usePredefinicoes } from "../shared/hooks/useDadosDaConfiguracao";
import { CampoDeInstrucoes } from "./CampoDeInstrucoes";
import { PreviaDoPromptFinal } from "./PreviaDoPromptFinal";

const LIMITE_DE_SUBAGENTES = 10;

interface Opcao<Valor extends string> {
  valor: Valor;
  titulo: string;
  descricao?: string;
}

const MODELOS: readonly Opcao<ModeloClaude>[] = (["fable", "opus", "sonnet", "haiku"] as const).map((modelo) => ({
  valor: modelo,
  titulo: ROTULOS_DOS_MODELOS[modelo].nome,
  descricao: ROTULOS_DOS_MODELOS[modelo].descricao,
}));

const ESFORCOS: readonly Opcao<EsforcoDeRaciocinio>[] = (
  ["padrao", "baixo", "medio", "alto", "extra_alto", "maximo"] as const
).map((esforco) => ({ valor: esforco, titulo: ROTULOS_DOS_ESFORCOS[esforco] }));

const PERMISSOES: readonly Opcao<NivelDePermissao>[] =(["leitura", "edicao", "edicao_e_comandos"] as const).map(
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

interface PropsDoSeletorDeEsforco {
  rotulo: string;
  valor: EsforcoDeRaciocinio;
  idDaAjuda: string;
  /** O que o Claude Code usa quando fica em "padrao"; nulo quando não se sabe. */
  herdado: DadosDoEsforcoHerdado | null;
  aoEscolher: (esforco: EsforcoDeRaciocinio) => void;
}

/** Lista suspensa, e não segmentado: seis níveis não cabem lado a lado na coluna do modelo. */
function SeletorDeEsforco({ rotulo, valor, idDaAjuda, herdado, aoEscolher }: PropsDoSeletorDeEsforco) {
  const id = useId();
  const idDoAviso = useId();
  // Em "padrao" o app não força nada: avisa quando o que o Claude Code herda gasta tokens demais.
  const avisar = valor === "padrao" && herdado !== null && herdado.deveAvisar;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {rotulo}
      </label>
      <select
        id={id}
        className="select text-[12px]"
        value={valor}
        aria-describedby={avisar ? `${idDaAjuda} ${idDoAviso}` : idDaAjuda}
        onChange={(evento) => {
          const escolhido = ESFORCOS.find((opcao) => opcao.valor === evento.target.value);
          if (escolhido !== undefined) {
            aoEscolher(escolhido.valor);
          }
        }}
      >
        {ESFORCOS.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.titulo}
          </option>
        ))}
      </select>
      {avisar && (
        <span id={idDoAviso} className="hint-warning">
          Em Padrão, o Claude Code usa <strong>{ROTULOS_DOS_ESFORCOS[herdado.nivel]}</strong> para este modelo
          (definido em <span className="mono">{herdado.origem}</span>). Isso gasta mais tokens; escolha um nível aqui
          para controlar.
        </span>
      )}
    </div>
  );
}

interface Props {
  valor: DadosDaConfiguracao;
  aoMudar: (configuracao: DadosDaConfiguracao) => void;
  /**
   * Busca o esforço que o Claude Code usaria em "padrao", para avisar quando
   * ele gasta tokens demais. Deve mudar de identidade quando os modelos ou a
   * pasta mudam. Sem ela, não há aviso.
   */
  buscarEsforcoHerdado?: () => Promise<EsforcosHerdados>;
  /**
   * Aplica a predefinição no servidor e devolve a configuração resultante (⚙ de
   * um Orquestrador existente). Sem ela (formulário de criação), o botão só
   * preenche os campos, que continuam editáveis.
   */
  aplicarPredefinicao?: (predefinicao: NomeDaPredefinicao) => Promise<DadosDaConfiguracao>;
  /** A pasta do orquestrador (ou a escolhida no rascunho), para a pré-visualização do prompt. */
  pastaDeTrabalho?: string | undefined;
}

/**
 * Modelos e esforço, quantidade de subagentes, permissões, commit e push e
 * as instruções personalizadas. Usado ao criar e ao reconfigurar.
 */
export function CamposDaConfiguracao({
  valor,
  aoMudar,
  buscarEsforcoHerdado,
  aplicarPredefinicao,
  pastaDeTrabalho,
}: Props) {
  const idDoLimite = useId();
  const idDaAjudaDoEsforco = useId();
  const idDaAjudaDoCommit = useId();
  const predefinicoes = usePredefinicoes();
  const herdados = useEsforcosHerdados(buscarEsforcoHerdado);
  const [aplicando, setAplicando] = useState(false);
  const [erroDaPredefinicao, setErroDaPredefinicao] = useState<string | null>(null);
  const economico = predefinicoes.find((predefinicao) => predefinicao.nome === "economico");
  const quantidade = valor.quantidadeDeSubagentes;
  // Commit e push são comandos git: sem permissão de rodar comandos, a opção não tem efeito.
  const commitSemComandos = valor.permitirCommitEPush && valor.nivelDePermissao !== "edicao_e_comandos";

  function mudar<Campo extends keyof DadosDaConfiguracao>(campo: Campo, novo: DadosDaConfiguracao[Campo]): void {
    aoMudar({ ...valor, [campo]: novo });
  }

  async function usarPredefinicao(predefinicao: DadosDaPredefinicao): Promise<void> {
    setErroDaPredefinicao(null);
    if (aplicarPredefinicao === undefined) {
      aoMudar({ ...valor, ...predefinicao.configuracao });
      return;
    }
    setAplicando(true);
    try {
      aoMudar(await aplicarPredefinicao(predefinicao.nome));
    } catch (falha) {
      setErroDaPredefinicao(`Não foi possível aplicar o ${predefinicao.rotulo.toLowerCase()}: ${mensagemDeErro(falha)}`);
    } finally {
      setAplicando(false);
    }
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
      {economico !== undefined && (
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            title={ajudaDaPredefinicao(economico)}
            disabled={aplicando}
            aria-busy={aplicando}
            onClick={() => void usarPredefinicao(economico)}
          >
            {aplicando ? "Aplicando…" : "Modo econômico"}
          </button>
          {erroDaPredefinicao !== null && (
            <span role="alert" className="hint-error">
              {erroDaPredefinicao}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="grid gap-4 @xl:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Segmentado
              rotulo="Modelo do orquestrador"
              opcoes={MODELOS}
              valor={valor.modeloDoOrquestrador}
              aoEscolher={(modelo) => mudar("modeloDoOrquestrador", modelo)}
            />
            <SeletorDeEsforco
              rotulo="Esforço do orquestrador"
              valor={valor.esforcoDoOrquestrador}
              idDaAjuda={idDaAjudaDoEsforco}
              herdado={herdados?.orquestrador ?? null}
              aoEscolher={(esforco) => mudar("esforcoDoOrquestrador", esforco)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Segmentado
              rotulo="Modelo dos subagentes"
              opcoes={MODELOS}
              valor={valor.modeloDosSubagentes}
              aoEscolher={(modelo) => mudar("modeloDosSubagentes", modelo)}
            />
            <SeletorDeEsforco
              rotulo="Esforço dos subagentes"
              valor={valor.esforcoDosSubagentes}
              idDaAjuda={idDaAjudaDoEsforco}
              herdado={herdados?.subagentes ?? null}
              aoEscolher={(esforco) => mudar("esforcoDosSubagentes", esforco)}
            />
          </div>
        </div>
        <span id={idDaAjudaDoEsforco} className="hint">
          Padrão: o app não força nada — vale o settings.json do Claude Code desta máquina ou, sem ele, o padrão do
          modelo. Mais esforço = respostas mais cuidadosas, porém mais lentas e com mais uso de cota.
        </span>
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

      <div className="flex flex-col gap-1.5">
        <label className="flex w-fit cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={valor.permitirCommitEPush}
            aria-describedby={idDaAjudaDoCommit}
            onChange={(evento) => mudar("permitirCommitEPush", evento.target.checked)}
          />
          <span className="label">Permitir commit e push quando eu pedir</span>
        </label>
        <span id={idDaAjudaDoCommit} className="hint">
          Commit e push só quando você pedir explicitamente na mensagem; nunca na main e sem Co-authored-by.
        </span>
        {commitSemComandos && (
          <span className="text-[11px] text-warning">
            Commit e push exigem a permissão de rodar comandos ({ROTULOS_DAS_PERMISSOES.edicao_e_comandos.nome}).
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <CampoDeInstrucoes
          rotulo="Instruções personalizadas (opcional)"
          ajuda="Regras suas que este orquestrador segue em todo pedido, além das dele. Valem já no próximo pedido, inclusive nesta conversa. Vazio: valem as instruções gerais (botão na barra do canvas), se houver. Não ampliam as permissões acima."
          placeholder="Ex.: Responda em tópicos curtos. Rode os testes antes de concluir."
          valor={valor.instrucoesPersonalizadas}
          aoMudar={(texto) => mudar("instrucoesPersonalizadas", texto)}
        />
        <PreviaDoPromptFinal configuracao={valor} pastaDeTrabalho={pastaDeTrabalho} comoLink />
      </div>

      <p className="hint">
        Cada subagente consome a cota da sua assinatura do Claude, e todos rodam ao mesmo tempo. Opus em vários
        subagentes gasta a cota mais rápido.
      </p>
    </div>
  );
}
