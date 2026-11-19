import { useEffect, useId, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import {
  MAXIMO_DE_PERFIS_DE_INSTRUCOES,
  type PerfilDeInstrucoes,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
  TAMANHO_MAXIMO_DO_NOME_DO_PERFIL,
} from "../../shared/api/tipos";
import { idiomaAtual, localeDoIdioma, textosAtuais, useTextos } from "../../shared/idioma/idioma";
import { textosDePaineis } from "../../shared/idioma/textos/paineis";
import { dicaDasVariaveis, tamanhoDasInstrucoes } from "../../shared/instrucoes";
import { CampoDeInstrucoes } from "../CampoDeInstrucoes";
import { Dica } from "../Dica";

/** Um perfil na edição, com uma chave estável para a lista. */
interface PerfilEmEdicao extends PerfilDeInstrucoes {
  chave: string;
}

function semChave({ nome, texto }: PerfilEmEdicao): PerfilDeInstrucoes {
  return { nome, texto };
}

/** Como o servidor compara os nomes: numa linha, aparado e sem diferenciar maiúsculas. */
function chaveDoNome(nome: string): string {
  return nome.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

/**
 * O que impede salvar este perfil (em minúscula, para seguir "Para salvar,"),
 * na mesma ordem em que o servidor confere.
 */
function problemaDo(perfil: PerfilEmEdicao, todos: readonly PerfilEmEdicao[]): string | null {
  const p = textosAtuais(textosDePaineis).instrucoes.problemas;
  const nome = chaveDoNome(perfil.nome);
  if (nome === "") {
    return p.deUmNome;
  }
  if (todos.some((outro) => outro.chave !== perfil.chave && chaveDoNome(outro.nome) === nome)) {
    return p.nomeRepetido(perfil.nome.trim());
  }
  const tamanho = tamanhoDasInstrucoes(perfil.texto);
  if (tamanho === 0) {
    return p.escrevaOTexto;
  }
  if (tamanho > TAMANHO_MAXIMO_DAS_INSTRUCOES) {
    return p.encurteOTexto(TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString(localeDoIdioma(idiomaAtual())));
  }
  return null;
}

interface Props {
  aoFechar: () => void;
  /** Depois de salvar: a página recarrega o que depende das instruções (os indicadores dos terminais). */
  aoSalvar: () => void;
}

/**
 * Instruções gerais, logo abaixo da barra do canvas: valem para todo
 * orquestrador sem instruções próprias. Embaixo, os perfis de instruções:
 * textos com nome que a ⚙ do terminal e a criação copiam para as instruções
 * do orquestrador. Salva só `instrucoesPadrao` e `perfisDeInstrucoes` (o que
 * mudou); os subagentes prontos têm o painel deles.
 */
export function PainelDeInstrucoesGerais({ aoFechar, aoSalvar }: Props) {
  const t = useTextos(textosDePaineis).instrucoes;
  const [salvas, setSalvas] = useState<string | null>(null);
  const [instrucoes, setInstrucoes] = useState("");
  const [perfisSalvos, setPerfisSalvos] = useState<PerfilDeInstrucoes[]>([]);
  const [perfis, setPerfis] = useState<PerfilEmEdicao[]>([]);
  const proximaChave = useRef(0);
  const [focarEm, setFocarEm] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const idDosPerfis = useId();

  useEffect(() => {
    let atual = true;
    api
      .lerPreferencias()
      .then((preferencias) => {
        if (atual) {
          // Servidor anterior aos perfis: lista vazia.
          const lista = preferencias.perfisDeInstrucoes ?? [];
          setSalvas(preferencias.instrucoesPadrao);
          setInstrucoes(preferencias.instrucoesPadrao);
          setPerfisSalvos(lista);
          setPerfis(lista.map((perfil, indice) => ({ ...perfil, chave: `salvo-${indice}` })));
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

  // Um perfil novo já abre com o cursor no nome.
  useEffect(() => {
    if (focarEm !== null) {
      painel.current?.querySelector<HTMLInputElement>(`[data-perfil="${focarEm}"]`)?.focus();
      setFocarEm(null);
    }
  }, [focarEm]);

  const instrucoesAlteradas = salvas !== null && instrucoes !== salvas;
  const perfisAlterados = salvas !== null && JSON.stringify(perfis.map(semChave)) !== JSON.stringify(perfisSalvos);
  const problemas = new Map(perfis.map((perfil) => [perfil.chave, problemaDo(perfil, perfis)]));
  const algumProblema = [...problemas.values()].some((problema) => problema !== null);
  const cheia = perfis.length >= MAXIMO_DE_PERFIS_DE_INSTRUCOES;

  function novoPerfil(): void {
    const chave = `novo-${proximaChave.current++}`;
    setPerfis((atuais) => [...atuais, { chave, nome: "", texto: "" }]);
    setFocarEm(chave);
  }

  function alterarPerfil(chave: string, alteracao: Partial<PerfilDeInstrucoes>): void {
    setPerfis((atuais) => atuais.map((perfil) => (perfil.chave === chave ? { ...perfil, ...alteracao } : perfil)));
  }

  function removerPerfil(chave: string): void {
    setPerfis((atuais) => atuais.filter((perfil) => perfil.chave !== chave));
  }

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      const preferencias = await api.alterarPreferencias({
        ...(instrucoesAlteradas ? { instrucoesPadrao: instrucoes } : {}),
        ...(perfisAlterados ? { perfisDeInstrucoes: perfis.map(semChave) } : {}),
      });
      setSalvas(preferencias.instrucoesPadrao);
      setPerfisSalvos(preferencias.perfisDeInstrucoes ?? []);
      aoSalvar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section ref={painel} className="painel-flutuante painel-da-barra mt-2 w-[40rem]" aria-label={t.rotulo}>
      <div className="painel-da-barra-corpo custom-scrollbar">
        {salvas === null && erro === null ? (
          <span className="hint">{t.carregando}</span>
        ) : (
          <>
            <CampoDeInstrucoes
              rotulo={t.rotulo}
              ajuda={t.ajudaDasGerais(dicaDasVariaveis())}
              placeholder={t.exemploDasGerais}
              valor={instrucoes}
              aoMudar={setInstrucoes}
              linhas={10}
              dica={
                <Dica sobre={t.rotulo} titulo={t.dicaTitulo}>
                  {t.dicaTexto}
                </Dica>
              }
            />

            <section className="flex flex-col gap-3 border-t border-border pt-3" aria-labelledby={idDosPerfis}>
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <h3 id={idDosPerfis} className="label">
                    {t.perfis}
                  </h3>
                  <Dica sobre={t.perfis} titulo={t.perfisDicaTitulo}>
                    {t.perfisDicaTexto}
                  </Dica>
                </span>
                <span className="text-support">{t.perfisAjuda}</span>
              </div>

              {perfis.map((perfil, indice) => {
                const problema = problemas.get(perfil.chave) ?? null;
                return (
                  <fieldset
                    key={perfil.chave}
                    className="flex flex-col gap-2 rounded-md border border-border p-3"
                    aria-label={t.perfilN(indice + 1)}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        data-perfil={perfil.chave}
                        className="input campo-escuro min-w-0 flex-1"
                        aria-label={t.nomeDoPerfil}
                        value={perfil.nome}
                        placeholder={t.nomeExemplo}
                        maxLength={TAMANHO_MAXIMO_DO_NOME_DO_PERFIL}
                        onChange={(evento) => alterarPerfil(perfil.chave, { nome: evento.target.value })}
                      />
                      <button type="button" className="btn btn-sm btn-danger shrink-0" onClick={() => removerPerfil(perfil.chave)}>
                        {t.apagar}
                      </button>
                    </div>
                    <CampoDeInstrucoes
                      rotulo={t.textoDoPerfil}
                      ajuda={dicaDasVariaveis()}
                      placeholder={t.textoExemplo}
                      valor={perfil.texto}
                      aoMudar={(texto) => alterarPerfil(perfil.chave, { texto })}
                      linhas={5}
                    />
                    {problema !== null && <span className="text-[11px] text-warning">{t.paraSalvar(problema)}</span>}
                  </fieldset>
                );
              })}

              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-sm btn-outline" disabled={cheia} onClick={novoPerfil}>
                  {t.novoPerfil}
                </button>
                <span className={`mono ${cheia ? "text-warning" : "text-muted"}`}>
                  {perfis.length} / {MAXIMO_DE_PERFIS_DE_INSTRUCOES}
                </span>
              </div>
            </section>
          </>
        )}
        {erro !== null && <div className="alert alert-error">{erro}</div>}
      </div>
      <div className="painel-da-barra-rodape">
        <button type="button" className="btn btn-sm btn-ghost" onClick={aoFechar}>
          {t.cancelar}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-cta"
          onClick={() => void salvar()}
          disabled={salvando || !(instrucoesAlteradas || perfisAlterados) || algumProblema}
        >
          {salvando ? t.salvando : t.salvar}
        </button>
      </div>
    </section>
  );
}
