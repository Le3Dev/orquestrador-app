import { useId, useState } from "react";

import { mensagemDeErro } from "../shared/api/cliente";
import {
  type DadosDaConfiguracao,
  type DadosDaPredefinicao,
  type EsforcosHerdados,
  type NivelDePermissao,
  type NomeDaPredefinicao,
  type SelecaoDeSubagentesProntos,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
} from "../shared/api/tipos";
import { type EscalaDaLetra, OPCOES_DA_ESCALA_DA_LETRA } from "../shared/canvas/layout";
import { AVISO_DO_ULTRACODE, ROTULOS_DAS_PERMISSOES } from "../shared/formatacao";
import {
  ajudaDaPredefinicao,
  useEsforcosHerdados,
  usePredefinicoes,
  usePreferencias,
} from "../shared/hooks/useDadosDaConfiguracao";
import { DICA_DAS_VARIAVEIS, tamanhoDasInstrucoes } from "../shared/instrucoes";
import { AvisoDoEsforcoHerdado, IconeDaPermissao, Rotulo, SeletorDePerfil } from "./canvas/LinhasDaConfiguracao";
import { MenuDeModelo } from "./canvas/MenuDeModelo";
import { QuantidadeDeSubagentes } from "./canvas/QuantidadeDeSubagentes";
import { PreviaDoPromptFinal } from "./PreviaDoPromptFinal";

const PERMISSOES: readonly NivelDePermissao[] = ["leitura", "edicao", "edicao_e_comandos"];

type ModoDosProntos = "todos" | "nenhum" | "escolher";

const MODOS_DOS_PRONTOS: readonly { valor: ModoDosProntos; titulo: string }[] = [
  { valor: "todos", titulo: "Todos" },
  { valor: "nenhum", titulo: "Nenhum" },
  { valor: "escolher", titulo: "Escolher" },
];

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
   * um Orquestrador existente). Sem ela, o botão só preenche os campos, que
   * continuam editáveis.
   */
  aplicarPredefinicao?: (predefinicao: NomeDaPredefinicao) => Promise<DadosDaConfiguracao>;
  /** A pasta do orquestrador, para a pré-visualização do prompt. */
  pastaDeTrabalho?: string | undefined;
  /** O nome do orquestrador, para `{{nome}}` na pré-visualização do prompt. */
  nome?: string | undefined;
  /**
   * O tamanho da letra do cartão no canvas (⚙ de um Orquestrador existente).
   * Não é dado do servidor: fica no layout do canvas e vale na hora. Sem ele,
   * o campo não aparece.
   */
  tamanhoDaLetra?: { valor: EscalaDaLetra; aoMudar: (escala: EscalaDaLetra) => void };
}

/**
 * As linhas da ⚙ do terminal, com a mesma cara da criação (NoRascunho):
 * permissão, modelos com o menu de esforço, quantidade, subagentes prontos,
 * opções, tamanho da letra e instruções. Pasta e nome não aparecem aqui: a pasta
 * não muda depois de criado, e o nome (rota própria) fica no ⚙ do terminal,
 * acima destas linhas.
 * Precisa estar dentro de um `.corpo-da-criacao` (a consulta de contêiner
 * empilha as linhas).
 */
export function CamposDaConfiguracao({
  valor,
  aoMudar,
  buscarEsforcoHerdado,
  aplicarPredefinicao,
  pastaDeTrabalho,
  nome,
  tamanhoDaLetra,
}: Props) {
  const idDoCampo = useId();
  const idDaPermissao = useId();
  const idDaLetra = useId();
  const predefinicoes = usePredefinicoes();
  const herdados = useEsforcosHerdados(buscarEsforcoHerdado);
  // Uma leitura só: a biblioteca de subagentes prontos e os perfis de instruções.
  const preferencias = usePreferencias();
  const biblioteca = preferencias?.subagentesProntos ?? null;
  const idDosProntos = useId();
  const [aplicando, setAplicando] = useState(false);
  const [erroDaPredefinicao, setErroDaPredefinicao] = useState<string | null>(null);
  const economico = predefinicoes.find((predefinicao) => predefinicao.nome === "economico");

  const comandos = valor.nivelDePermissao === "edicao_e_comandos";
  // Commit e push são comandos git: sem permissão de rodar comandos, a opção não tem efeito.
  const commitSemComandos = valor.permitirCommitEPush && !comandos;
  const tamanho = tamanhoDasInstrucoes(valor.instrucoesPersonalizadas);
  const passouDoLimite = tamanho > TAMANHO_MAXIMO_DAS_INSTRUCOES;
  // Ausente (orquestrador antigo): recebe todos, como antes da opção.
  const prontos: SelecaoDeSubagentesProntos = valor.subagentesProntos ?? "todos";
  const modoDosProntos: ModoDosProntos = Array.isArray(prontos) ? "escolher" : prontos;

  function mudar<Campo extends keyof DadosDaConfiguracao>(campo: Campo, novo: DadosDaConfiguracao[Campo]): void {
    aoMudar({ ...valor, [campo]: novo });
  }

  /** "Escolher" começa do que ele recebe hoje: todos marcados, ou nenhum. */
  function mudarModoDosProntos(modo: ModoDosProntos): void {
    if (modo === modoDosProntos) {
      return;
    }
    if (modo !== "escolher") {
      mudar("subagentesProntos", modo);
      return;
    }
    mudar("subagentesProntos", prontos === "todos" ? (biblioteca ?? []).map((subagente) => subagente.nome) : []);
  }

  /** Marca ou desmarca um; a lista sai na ordem da biblioteca e sem nomes que já não existem. */
  function alternarPronto(nome: string, marcado: boolean): void {
    const escolhidos = new Set(Array.isArray(prontos) ? prontos : []);
    if (marcado) {
      escolhidos.add(nome);
    } else {
      escolhidos.delete(nome);
    }
    mudar(
      "subagentesProntos",
      (biblioteca ?? []).map((subagente) => subagente.nome).filter((existente) => escolhidos.has(existente)),
    );
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

  return (
    <>
      <div className="linha-da-criacao">
        <Rotulo
          id={idDaPermissao}
          titulo="Permissão"
          dica="O que ele pode fazer na pasta."
          explicacao={`Vale para o orquestrador e para os subagentes. Libere ${ROTULOS_DAS_PERMISSOES.edicao_e_comandos.nome} só quando precisar instalar, testar ou compilar.`}
          alinharAoTopo
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="permissoes-da-criacao" role="radiogroup" aria-labelledby={idDaPermissao}>
            {PERMISSOES.map((nivel) => {
              const escolhida = valor.nivelDePermissao === nivel;
              return (
                <label
                  key={nivel}
                  className={`opcao-da-permissao ${escolhida && nivel === "edicao_e_comandos" ? "opcao-da-permissao-risco" : ""}`}
                  title={ROTULOS_DAS_PERMISSOES[nivel].nome}
                >
                  <input
                    type="radio"
                    name={`${idDaPermissao}-nivel`}
                    value={nivel}
                    checked={escolhida}
                    onChange={() => mudar("nivelDePermissao", nivel)}
                  />
                  <IconeDaPermissao nivel={nivel} />
                  <span className="truncate">{ROTULOS_DAS_PERMISSOES[nivel].nome}</span>
                </label>
              );
            })}
          </div>
          <span className={`text-[12px] ${comandos ? "text-warning" : "text-secondary"}`}>
            {comandos
              ? "Edita, instala, testa e compila. Use só em pastas que você confia."
              : ROTULOS_DAS_PERMISSOES[valor.nivelDePermissao].descricao}
          </span>
        </div>
      </div>

      <div className="linha-da-criacao">
        <Rotulo
          htmlFor={`${idDoCampo}-orquestrador`}
          titulo="Orquestrador"
          dica="Quem conversa com você."
          explicacao="Ele entende o pedido, divide em tarefas e passa para os subagentes. Fable é para os desafios mais difíceis, Opus é o mais capaz no dia a dia, Sonnet equilibra e Haiku é rápido e gasta menos cota. O esforço é quanto ele pensa antes de responder; no automático, vale o padrão do Claude Code."
          alinharAoTopo
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <MenuDeModelo
            id={`${idDoCampo}-orquestrador`}
            rotulo="Modelo do orquestrador"
            modelo={valor.modeloDoOrquestrador}
            esforco={valor.esforcoDoOrquestrador}
            comUltracode
            aoEscolherModelo={(modelo) => mudar("modeloDoOrquestrador", modelo)}
            aoEscolherEsforco={(esforco) => mudar("esforcoDoOrquestrador", esforco)}
          />
          <AvisoDoEsforcoHerdado esforco={valor.esforcoDoOrquestrador} herdado={herdados?.orquestrador ?? null} />
          {valor.esforcoDoOrquestrador === "ultracode" && <span className="hint-warning">{AVISO_DO_ULTRACODE}</span>}
        </div>

        <Rotulo
          htmlFor={`${idDoCampo}-subagentes`}
          titulo="Subagentes"
          dica="Ajudantes que trabalham em paralelo."
          explicacao="O orquestrador lança um para cada tarefa, e eles aparecem como bixinhos ligados ao terminal. No padrão, ele decide quantos usar, até 3 ao mesmo tempo. Cada subagente consome a cota da sua assinatura do Claude."
          alinharAoTopo
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <MenuDeModelo
            id={`${idDoCampo}-subagentes`}
            rotulo="Modelo dos subagentes"
            modelo={valor.modeloDosSubagentes}
            esforco={valor.esforcoDosSubagentes}
            aoEscolherModelo={(modelo) => mudar("modeloDosSubagentes", modelo)}
            aoEscolherEsforco={(esforco) => mudar("esforcoDosSubagentes", esforco)}
          />
          <AvisoDoEsforcoHerdado esforco={valor.esforcoDosSubagentes} herdado={herdados?.subagentes ?? null} />
        </div>
      </div>

      <div className="linha-da-criacao">
        <Rotulo
          titulo="Quantidade"
          dica="Quantos ao mesmo tempo."
          explicacao="Automática: o orquestrador decide quantos subagentes usar, até o máximo escolhido (no padrão, até 3 ao mesmo tempo). Fixa: ele usa sempre essa quantidade. Cada subagente consome a cota da sua assinatura do Claude."
          alinharAoTopo
        />
        <QuantidadeDeSubagentes
          valor={valor.quantidadeDeSubagentes}
          aoMudar={(quantidade) => mudar("quantidadeDeSubagentes", quantidade)}
        />
      </div>

      <div className="linha-da-criacao">
        <Rotulo
          id={idDosProntos}
          titulo="Subagentes prontos"
          dica="Quais ele pode usar."
          explicacao="Os subagentes prontos são criados no botão Subagentes da barra. Todos inclui os que você criar depois; Nenhum deixa só o subagente padrão; Escolher libera só os marcados. Vale já no próximo pedido."
          alinharAoTopo
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="permissoes-da-criacao w-fit" role="radiogroup" aria-labelledby={idDosProntos}>
            {MODOS_DOS_PRONTOS.map((opcao) => (
              <label key={opcao.valor} className="opcao-da-permissao">
                <input
                  type="radio"
                  name={`${idDosProntos}-modo`}
                  value={opcao.valor}
                  checked={modoDosProntos === opcao.valor}
                  onChange={() => mudarModoDosProntos(opcao.valor)}
                />
                {opcao.titulo}
              </label>
            ))}
          </div>
          {biblioteca !== null && biblioteca.length === 0 ? (
            <span className="text-[12px] text-secondary">Nenhum subagente pronto criado ainda.</span>
          ) : (
            Array.isArray(prontos) &&
            biblioteca !== null && (
              <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1" role="group" aria-label="Subagentes prontos escolhidos">
                {biblioteca.map((subagente) => (
                  <label key={subagente.nome} className="flex min-w-0 items-center gap-1.5 text-[12.5px]" title={subagente.descricao}>
                    <input
                      type="checkbox"
                      checked={prontos.includes(subagente.nome)}
                      onChange={(evento) => alternarPronto(subagente.nome, evento.target.checked)}
                    />
                    <span className="mono truncate">{subagente.nome}</span>
                  </label>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      <div className="linha-da-criacao">
        <Rotulo
          titulo="Opções"
          dica="Cada feature pronta vira um commit com push."
          explicacao="Ligado, cada feature ou correção pronta (testada, com lint e build ok) vira um commit próprio com push da branch em seguida, numa branch feature/, fix/, hotfix/ ou refactor/. PR e merge só quando você pedir. Precisa da permissão de rodar comandos. O Modo econômico troca modelos e esforço por outros que gastam menos cota e já vale, sem o Salvar; os campos continuam editáveis."
          alinharAoTopo
        />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              role="switch"
              className="interruptor"
              aria-checked={valor.permitirCommitEPush}
              onClick={() => mudar("permitirCommitEPush", !valor.permitirCommitEPush)}
            >
              <span className={`interruptor-trilho ${commitSemComandos ? "interruptor-sem-efeito" : ""}`} aria-hidden="true" />
              Commit e push por feature
            </button>
            {economico !== undefined && (
              <button
                type="button"
                className="btn btn-sm btn-ghost ml-auto shrink-0"
                title={ajudaDaPredefinicao(economico)}
                disabled={aplicando}
                aria-busy={aplicando}
                onClick={() => void usarPredefinicao(economico)}
              >
                {aplicando ? "Aplicando…" : "Modo econômico"}
              </button>
            )}
          </div>
          {/* Os avisos ficam embaixo: o Modo econômico não muda de lugar quando eles aparecem. */}
          {commitSemComandos && (
            <span className="text-[11.5px] text-warning">Só vale com {ROTULOS_DAS_PERMISSOES.edicao_e_comandos.nome}.</span>
          )}
          {erroDaPredefinicao !== null && (
            <span role="alert" className="hint-error">
              {erroDaPredefinicao}
            </span>
          )}
        </div>
      </div>

      {tamanhoDaLetra !== undefined && (
        <div className="linha-da-criacao">
          <Rotulo
            id={idDaLetra}
            titulo="Tamanho da letra"
            dica="Só deste orquestrador, no canvas."
            explicacao="Aumenta a letra do cartão inteiro, na configuração e na conversa, e o cartão cresce junto. Vale na hora, sem o Salvar, e fica guardado neste navegador."
          />
          <div className="permissoes-da-criacao w-fit" role="radiogroup" aria-labelledby={idDaLetra}>
            {OPCOES_DA_ESCALA_DA_LETRA.map((opcao) => (
              <label key={opcao.valor} className="opcao-da-permissao">
                <input
                  type="radio"
                  name={`${idDaLetra}-escala`}
                  value={opcao.valor}
                  checked={tamanhoDaLetra.valor === opcao.valor}
                  onChange={() => tamanhoDaLetra.aoMudar(opcao.valor)}
                />
                {opcao.titulo}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="linha-da-criacao linha-instrucoes">
        <Rotulo
          htmlFor={`${idDoCampo}-instrucoes`}
          titulo="Instruções"
          dica="Regras só deste orquestrador."
          explicacao="Entram no prompt dele, por exemplo o jeito de responder ou o que rodar antes de concluir, e valem já no próximo pedido, inclusive nesta conversa. Vazio, valem as Instruções gerais (botão na barra). Aplicar perfil copia um texto pronto, criado no mesmo botão. Não ampliam a permissão acima."
          alinharAoTopo
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <SeletorDePerfil
            perfis={preferencias?.perfisDeInstrucoes ?? []}
            textoAtual={valor.instrucoesPersonalizadas}
            aoAplicar={(texto) => mudar("instrucoesPersonalizadas", texto)}
          />
          <textarea
            id={`${idDoCampo}-instrucoes`}
            className="textarea instrucoes-da-criacao custom-scrollbar"
            value={valor.instrucoesPersonalizadas}
            placeholder="Opcional. Ex.: Responda em tópicos curtos. Rode os testes antes de concluir."
            aria-invalid={passouDoLimite}
            spellCheck
            onChange={(evento) => mudar("instrucoesPersonalizadas", evento.target.value)}
          />
          <span className="hint">{DICA_DAS_VARIAVEIS}</span>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <PreviaDoPromptFinal configuracao={valor} pastaDeTrabalho={pastaDeTrabalho} nome={nome} comoLink />
            </div>
            <span className={`mono shrink-0 text-[11px] ${passouDoLimite ? "text-error" : "text-muted"}`} aria-live="polite">
              {tamanho.toLocaleString("pt-BR")} / {TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString("pt-BR")}
            </span>
          </div>
          {passouDoLimite && (
            <span className="text-[11px] text-error" role="alert">
              Passou do limite de {TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString("pt-BR")} caracteres: encurte o texto
              para conseguir salvar.
            </span>
          )}
        </div>
      </div>
    </>
  );
}
