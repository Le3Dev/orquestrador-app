import { type RefObject, useEffect, useId, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import {
  MAXIMO_DE_SUBAGENTES_PRONTOS,
  TAMANHO_MAXIMO_DA_DESCRICAO_DO_SUBAGENTE,
  TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE,
  type DadosDoSubagentePronto,
  type ModeloDoSubagentePronto,
} from "../../shared/api/tipos";
import { tamanhoDasInstrucoes } from "../../shared/instrucoes";
import { nomeDeSubagente } from "../../shared/subagentesProntos";
import { Dica } from "../Dica";
import { IconeFechar, IconePessoas } from "../Icones";

/** Como o servidor confere (`TAMANHO_MAXIMO_DO_NOME_DO_SUBAGENTE`). */
const TAMANHO_MAXIMO_DO_NOME = 40;

const MODELOS: { valor: ModeloDoSubagentePronto; rotulo: string; curto: string }[] = [
  { valor: "herdar", rotulo: "Herdar do orquestrador", curto: "herda" },
  { valor: "opus", rotulo: "Opus", curto: "opus" },
  { valor: "sonnet", rotulo: "Sonnet", curto: "sonnet" },
  { valor: "haiku", rotulo: "Haiku", curto: "haiku" },
];

/** Um subagente na edição, com uma chave estável para a lista e a seleção. */
interface SubagenteEmEdicao extends DadosDoSubagentePronto {
  chave: string;
}

function semChave({ nome, descricao, prompt, modelo }: SubagenteEmEdicao): DadosDoSubagentePronto {
  return { nome, descricao, prompt, modelo };
}

/**
 * O que impede salvar este subagente (em minúscula, para seguir "Para salvar,"), na mesma ordem em que o servidor
 * confere. Os nomes reservados ficam com o servidor, que responde com a
 * mensagem exata.
 */
function problemaDo(subagente: SubagenteEmEdicao, todos: readonly SubagenteEmEdicao[]): string | null {
  if (subagente.nome === "") {
    return "dê um nome.";
  }
  if (!/^[a-z]/.test(subagente.nome)) {
    return "comece o nome por uma letra.";
  }
  if (todos.some((outro) => outro.chave !== subagente.chave && outro.nome === subagente.nome)) {
    return `troque o nome: já existe um "${subagente.nome}".`;
  }
  if (subagente.descricao.trim() === "") {
    return "diga quando usar.";
  }
  const prompt = tamanhoDasInstrucoes(subagente.prompt);
  if (prompt === 0) {
    return "escreva o prompt.";
  }
  if (prompt > TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE) {
    return `encurte o prompt para até ${TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE.toLocaleString("pt-BR")} caracteres.`;
  }
  return null;
}

interface PropsDoEditor {
  subagente: SubagenteEmEdicao;
  problema: string | null;
  aoMudar: (alteracao: Partial<DadosDoSubagentePronto>) => void;
  aoRemover: () => void;
  campoDoNome: RefObject<HTMLInputElement | null>;
}

/** O lado direito: os campos do subagente escolhido, com o rótulo à esquerda. */
function EditorDoSubagente({ subagente, problema, aoMudar, aoRemover, campoDoNome }: PropsDoEditor) {
  const id = useId();
  const tamanhoDoPrompt = tamanhoDasInstrucoes(subagente.prompt);
  const passouDoPrompt = tamanhoDoPrompt > TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE;
  return (
    <div className="subagentes-editor custom-scrollbar">
      <div className="linha-de-campo">
        <span className="rotulo-de-campo">
          <label htmlFor={`${id}-nome`}>Nome</label>
          <Dica sobre="Nome" titulo="Como o orquestrador chama este ajudante.">
            Minúsculas e hífen, por exemplo revisor-de-codigo.
          </Dica>
        </span>
        <input
          ref={campoDoNome}
          id={`${id}-nome`}
          className="input campo-escuro mono"
          value={subagente.nome}
          placeholder="revisor-de-codigo"
          maxLength={TAMANHO_MAXIMO_DO_NOME}
          spellCheck={false}
          onChange={(evento) => aoMudar({ nome: nomeDeSubagente(evento.target.value) })}
        />
      </div>
      <div className="linha-de-campo">
        <span className="rotulo-de-campo">
          <label htmlFor={`${id}-modelo`}>Modelo</label>
          <Dica sobre="Modelo" titulo="Qual Claude ele usa.">
            Herdar usa o mesmo modelo dos subagentes do orquestrador.
          </Dica>
        </span>
        <select
          id={`${id}-modelo`}
          className="select campo-escuro select-do-subagente"
          value={subagente.modelo}
          onChange={(evento) => aoMudar({ modelo: evento.target.value as ModeloDoSubagentePronto })}
        >
          {MODELOS.map((modelo) => (
            <option key={modelo.valor} value={modelo.valor}>
              {modelo.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="linha-de-campo">
        <span className="rotulo-de-campo">
          <label htmlFor={`${id}-descricao`}>Quando usar</label>
          <Dica sobre="Quando usar" titulo="Quando o orquestrador deve chamar.">
            O orquestrador lê esta frase para decidir se usa este ajudante num pedido. Seja específico.
          </Dica>
        </span>
        <input
          id={`${id}-descricao`}
          className="input campo-escuro"
          value={subagente.descricao}
          placeholder="Ex.: depois de mudar código, para revisar o diff procurando bugs"
          maxLength={TAMANHO_MAXIMO_DA_DESCRICAO_DO_SUBAGENTE}
          onChange={(evento) => aoMudar({ descricao: evento.target.value })}
        />
      </div>
      <div className="linha-de-campo">
        <span className="rotulo-de-campo">
          <label htmlFor={`${id}-prompt`}>Prompt</label>
          <Dica sobre="Prompt" titulo="O que ele faz e como.">
            As instruções deste ajudante. Ele roda com as mesmas permissões do orquestrador no pedido.
          </Dica>
        </span>
        <div className="flex flex-col gap-1">
          <textarea
            id={`${id}-prompt`}
            className="textarea campo-escuro textarea-instrucoes textarea-do-subagente custom-scrollbar"
            rows={9}
            value={subagente.prompt}
            placeholder="Ex.: Leia o diff inteiro, aponte bugs com arquivo e linha e não altere nada."
            aria-invalid={passouDoPrompt}
            onChange={(evento) => aoMudar({ prompt: evento.target.value })}
          />
          <span className={`font-mono self-end text-[10.5px] ${passouDoPrompt ? "text-error" : "text-muted"}`} aria-live="polite">
            {tamanhoDoPrompt.toLocaleString("pt-BR")} / {TAMANHO_MAXIMO_DO_PROMPT_DO_SUBAGENTE.toLocaleString("pt-BR")}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-border pt-3">
        <button type="button" className="btn btn-sm btn-danger" onClick={aoRemover}>
          Remover
        </button>
        {problema !== null && <span className="text-[11px] text-warning">Para salvar, {problema}</span>}
      </div>
    </div>
  );
}

interface Props {
  aoFechar: () => void;
  /** Depois de salvar: a página atualiza a contagem do botão da barra. */
  aoSalvar: () => void;
}

/**
 * Subagentes prontos, logo abaixo da barra do canvas, em mestre e detalhe:
 * a lista à esquerda e o escolhido à direita. Todo orquestrador recebe a
 * lista e decide quando chamar cada um pela frase de "quando usar". Salva só
 * `subagentesProntos` (a lista troca inteira no servidor).
 */
export function PainelDeSubagentes({ aoFechar, aoSalvar }: Props) {
  const [salvos, setSalvos] = useState<DadosDoSubagentePronto[] | null>(null);
  const [subagentes, setSubagentes] = useState<SubagenteEmEdicao[]>([]);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const proximaChave = useRef(0);
  const campoDoNome = useRef<HTMLInputElement>(null);
  const focarNoNome = useRef(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const idDoLimite = useId();

  useEffect(() => {
    let atual = true;
    api
      .lerPreferencias()
      .then((preferencias) => {
        if (atual) {
          const lista = preferencias.subagentesProntos.map((subagente, indice) => ({
            ...subagente,
            chave: `salvo-${indice}`,
          }));
          setSalvos(preferencias.subagentesProntos);
          setSubagentes(lista);
          setEscolhido(lista[0]?.chave ?? null);
        }
      })
      .catch((falha: unknown) => {
        if (atual) {
          setErro(mensagemDeErro(falha));
        }
      });
    return () => {
      atual = false;
    };
  }, []);

  // Esc fecha sem salvar, como o Cancelar. Só o Esc dado no painel (ou sem
  // nada focado): o painel não é modal, e um Esc num terminal, numa nota ou
  // num menu da criação não pode jogar fora a edição daqui.
  const painel = useRef<HTMLElement>(null);
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.key === "Escape" && !evento.defaultPrevented && noPainel) {
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  // Um subagente novo já abre com o cursor no nome.
  useEffect(() => {
    if (focarNoNome.current) {
      focarNoNome.current = false;
      campoDoNome.current?.focus();
    }
  }, [escolhido]);

  const atual = subagentes.find((subagente) => subagente.chave === escolhido) ?? null;
  const cheia = subagentes.length >= MAXIMO_DE_SUBAGENTES_PRONTOS;
  const problemas = new Map(subagentes.map((subagente) => [subagente.chave, problemaDo(subagente, subagentes)]));
  const algumProblema = [...problemas.values()].some((problema) => problema !== null);
  const alterado = salvos !== null && JSON.stringify(subagentes.map(semChave)) !== JSON.stringify(salvos);

  function novo(): void {
    const chave = `novo-${proximaChave.current++}`;
    setSubagentes((atuais) => [...atuais, { chave, nome: "", descricao: "", prompt: "", modelo: "herdar" }]);
    focarNoNome.current = true;
    setEscolhido(chave);
  }

  function alterar(alteracao: Partial<DadosDoSubagentePronto>): void {
    setSubagentes((atuais) =>
      atuais.map((subagente) => (subagente.chave === escolhido ? { ...subagente, ...alteracao } : subagente)),
    );
  }

  function remover(): void {
    const indice = subagentes.findIndex((subagente) => subagente.chave === escolhido);
    const restantes = subagentes.filter((subagente) => subagente.chave !== escolhido);
    setSubagentes(restantes);
    // Fica no vizinho: o que veio para o lugar dele, ou o anterior se era o último.
    setEscolhido(restantes[Math.min(indice, restantes.length - 1)]?.chave ?? null);
  }

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      const preferencias = await api.alterarPreferencias({ subagentesProntos: subagentes.map(semChave) });
      setSalvos(preferencias.subagentesProntos);
      aoSalvar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section ref={painel} className="painel-flutuante painel-da-barra painel-de-subagentes mt-2" aria-label="Subagentes prontos">
      <header className="painel-da-barra-cabecalho">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[14px]">Subagentes prontos</h2>
          <span className="text-support">
            Todo orquestrador recebe esta lista e chama o ajudante certo pela frase de quando usar.
          </span>
        </div>
        <button type="button" className="botao-icone shrink-0" aria-label="Fechar subagentes" onClick={aoFechar}>
          <IconeFechar tamanho={16} />
        </button>
      </header>

      {salvos === null ? (
        <div className="painel-da-barra-corpo">
          {erro === null ? <span className="hint">carregando…</span> : <div className="alert alert-error">{erro}</div>}
        </div>
      ) : subagentes.length === 0 ? (
        <div className="subagentes-vazio">
          <IconePessoas tamanho={22} className="text-muted" />
          <strong className="font-titulo text-[13px]">Nenhum subagente pronto</strong>
          <span className="text-support max-w-sm">
            Crie ajudantes com uma especialidade (revisar código, escrever testes, documentar). Sem nenhum, o orquestrador
            usa subagentes genéricos quando precisa.
          </span>
          <button type="button" className="btn btn-sm btn-outline" onClick={novo}>
            + Novo subagente
          </button>
        </div>
      ) : (
        <div className="subagentes-corpo">
          <div className="subagentes-lista">
            <ul className="custom-scrollbar" aria-label="Lista de subagentes">
              {subagentes.map((subagente) => {
                const modelo = MODELOS.find((opcao) => opcao.valor === subagente.modelo) ?? MODELOS[0];
                return (
                  <li key={subagente.chave}>
                    <button
                      type="button"
                      className="item-subagente"
                      aria-pressed={subagente.chave === escolhido}
                      onClick={() => setEscolhido(subagente.chave)}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`mono truncate ${subagente.nome === "" ? "text-muted italic" : "text-primary"}`}>
                          {subagente.nome === "" ? "sem-nome" : subagente.nome}
                        </span>
                        {problemas.get(subagente.chave) !== null && (
                          <span className="ponto-de-status ponto-pendente" title={problemas.get(subagente.chave) ?? undefined} />
                        )}
                        <span className="chip-de-modelo ml-auto">{modelo?.curto}</span>
                      </span>
                      <span className="truncate text-[11.5px] text-muted">
                        {subagente.descricao.trim() === "" ? "Descreva quando usar" : subagente.descricao}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-1.5 border-t border-border p-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost flex-1"
                  disabled={cheia}
                  aria-describedby={cheia ? idDoLimite : undefined}
                  onClick={novo}
                >
                  + Novo subagente
                </button>
                <span className={`mono ${cheia ? "text-warning" : "text-muted"}`}>
                  {subagentes.length} / {MAXIMO_DE_SUBAGENTES_PRONTOS}
                </span>
              </div>
              {cheia && (
                <span id={idDoLimite} className="text-center text-[11px] text-muted">
                  Limite de {MAXIMO_DE_SUBAGENTES_PRONTOS} atingido.
                </span>
              )}
            </div>
          </div>
          {atual !== null && (
            <EditorDoSubagente
              key={atual.chave}
              subagente={atual}
              problema={problemas.get(atual.chave) ?? null}
              aoMudar={alterar}
              aoRemover={remover}
              campoDoNome={campoDoNome}
            />
          )}
        </div>
      )}

      {salvos !== null && erro !== null && <div className="alert alert-error mx-4 mb-1">{erro}</div>}
      <div className="painel-da-barra-rodape">
        <span className="mr-auto text-support">Rodam com as mesmas permissões do orquestrador que os chamar.</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={aoFechar}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-sm btn-cta"
          onClick={() => void salvar()}
          disabled={salvando || !alterado || algumProblema}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </section>
  );
}
