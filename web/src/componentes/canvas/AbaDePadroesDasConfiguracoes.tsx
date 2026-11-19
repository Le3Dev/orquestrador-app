import { useEffect, useId, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import {
  MAXIMO_DE_PERFIS_DE_INSTRUCOES,
  type PerfilDeInstrucoes,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
  TAMANHO_MAXIMO_DO_NOME_DO_PERFIL,
} from "../../shared/api/tipos";
import { dicaDasVariaveis, tamanhoDasInstrucoes } from "../../shared/instrucoes";
import { idiomaAtual, localeDoIdioma, textosAtuais, useTextos } from "../../shared/idioma/idioma";
import { textosDeConfiguracoes } from "../../shared/idioma/textos/configuracoes";
import { CampoDeInstrucoes } from "../CampoDeInstrucoes";
import { Dica } from "../Dica";

/** Um perfil na edição, com uma chave estável para a lista. */
interface PerfilEmEdicao extends PerfilDeInstrucoes {
  chave: string;
}

function semChave({ nome, texto }: PerfilEmEdicao): PerfilDeInstrucoes {
  return { nome, texto };
}

function comChaves(lista: readonly PerfilDeInstrucoes[]): PerfilEmEdicao[] {
  return lista.map((perfil, indice) => ({ ...perfil, chave: `salvo-${indice}` }));
}

/** Como o servidor compara os nomes: numa linha, aparado e sem diferenciar maiúsculas. */
function chaveDoNome(nome: string): string {
  return nome.replace(/\s+/g, " ").trim().toLocaleLowerCase(localeDoIdioma(idiomaAtual()));
}

/** O que impede salvar este perfil (em minúscula, para seguir "Para salvar,"), na ordem em que o servidor confere. */
function problemaDo(perfil: PerfilEmEdicao, todos: readonly PerfilEmEdicao[]): string | null {
  const t = textosAtuais(textosDeConfiguracoes).padroes;
  const nome = chaveDoNome(perfil.nome);
  if (nome === "") {
    return t.daUmNome;
  }
  if (todos.some((outro) => outro.chave !== perfil.chave && chaveDoNome(outro.nome) === nome)) {
    return t.trocarNome(perfil.nome.trim());
  }
  const tamanho = tamanhoDasInstrucoes(perfil.texto);
  if (tamanho === 0) {
    return t.escrevaTexto;
  }
  if (tamanho > TAMANHO_MAXIMO_DAS_INSTRUCOES) {
    return t.encurteTexto(TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString(localeDoIdioma(idiomaAtual())));
  }
  return null;
}

interface Props {
  /** Depois de salvar: a página recarrega o que depende das instruções (os indicadores dos terminais). */
  aoSalvar?: () => void;
}

/**
 * A aba Padrões: as instruções gerais (valem para todo orquestrador sem
 * instruções próprias) e os perfis de instruções (textos com nome que a ⚙ do
 * terminal e a criação copiam para as instruções do orquestrador). Salva só
 * `instrucoesPadrao` e `perfisDeInstrucoes`, o que mudou. Descartar e Salvar
 * ocupam sempre o mesmo lugar: sem mudança ficam invisíveis, e o layout não
 * se mexe. O modelo e a permissão padrão não entram: hoje só existem por
 * orquestrador, não como configuração global.
 */
export function AbaDePadroesDasConfiguracoes({ aoSalvar }: Props) {
  const t = useTextos(textosDeConfiguracoes).padroes;
  const [salvas, setSalvas] = useState<string | null>(null);
  const [instrucoes, setInstrucoes] = useState("");
  const [perfisSalvos, setPerfisSalvos] = useState<PerfilDeInstrucoes[]>([]);
  const [perfis, setPerfis] = useState<PerfilEmEdicao[]>([]);
  const proximaChave = useRef(0);
  const [focarEm, setFocarEm] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [recemSalvo, setRecemSalvo] = useState(false);
  const idDosPerfis = useId();
  const raiz = useRef<HTMLDivElement>(null);

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
          setPerfis(comChaves(lista));
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

  // Um perfil novo já abre com o cursor no nome.
  useEffect(() => {
    if (focarEm !== null) {
      raiz.current?.querySelector<HTMLInputElement>(`[data-perfil="${focarEm}"]`)?.focus();
      setFocarEm(null);
    }
  }, [focarEm]);

  const instrucoesAlteradas = salvas !== null && instrucoes !== salvas;
  const perfisAlterados = salvas !== null && JSON.stringify(perfis.map(semChave)) !== JSON.stringify(perfisSalvos);
  const alterado = instrucoesAlteradas || perfisAlterados;
  const problemas = new Map(perfis.map((perfil) => [perfil.chave, problemaDo(perfil, perfis)]));
  const algumProblema =
    [...problemas.values()].some((problema) => problema !== null) ||
    tamanhoDasInstrucoes(instrucoes) > TAMANHO_MAXIMO_DAS_INSTRUCOES;
  const cheia = perfis.length >= MAXIMO_DE_PERFIS_DE_INSTRUCOES;

  function editarInstrucoes(texto: string): void {
    setRecemSalvo(false);
    setInstrucoes(texto);
  }

  function novoPerfil(): void {
    const chave = `novo-${proximaChave.current++}`;
    setRecemSalvo(false);
    setPerfis((atuais) => [...atuais, { chave, nome: "", texto: "" }]);
    setFocarEm(chave);
  }

  function alterarPerfil(chave: string, alteracao: Partial<PerfilDeInstrucoes>): void {
    setRecemSalvo(false);
    setPerfis((atuais) => atuais.map((perfil) => (perfil.chave === chave ? { ...perfil, ...alteracao } : perfil)));
  }

  function removerPerfil(chave: string): void {
    setRecemSalvo(false);
    setPerfis((atuais) => atuais.filter((perfil) => perfil.chave !== chave));
  }

  function descartar(): void {
    setErro(null);
    setInstrucoes(salvas ?? "");
    setPerfis(comChaves(perfisSalvos));
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
      setRecemSalvo(true);
      aoSalvar?.();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  if (salvas === null) {
    return erro === null ? <span className="hint">{t.carregando}</span> : <div className="alert alert-error">{erro}</div>;
  }

  return (
    <div ref={raiz} className="cfgapp-padroes">
      <p className="alert alert-info cfgapp-nota">{t.nota}</p>

      <CampoDeInstrucoes
        rotulo={t.instrucoesGerais}
        ajuda={t.ajudaDasGerais(dicaDasVariaveis())}
        placeholder={t.placeholderGerais}
        valor={instrucoes}
        aoMudar={editarInstrucoes}
        linhas={8}
        dica={
          <Dica sobre={t.instrucoesGerais} titulo={t.dicaGeraisTitulo}>
            {t.dicaGeraisTexto}
          </Dica>
        }
      />

      <section className="cfgapp-perfis" aria-labelledby={idDosPerfis}>
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <h3 id={idDosPerfis} className="label">
              {t.perfis}
            </h3>
            <Dica sobre={t.perfis} titulo={t.dicaPerfisTitulo}>
              {t.dicaPerfisTexto}
            </Dica>
          </span>
          <span className="text-support">{t.perfisSuporte}</span>
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
                  placeholder={t.placeholderDoNome}
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
                placeholder={t.placeholderDoTexto}
                valor={perfil.texto}
                aoMudar={(texto) => alterarPerfil(perfil.chave, { texto })}
                linhas={4}
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

      {erro !== null && <div className="alert alert-error">{erro}</div>}

      {/* Sempre no fim da aba, colada à base da rolagem; sem mudança, só os botões somem (o espaço fica). */}
      <div className="cfgapp-acoes">
        <span className="hint" role="status">
          {recemSalvo && !alterado ? t.salvas : ""}
        </span>
        <div className="cfgapp-acoes-botoes" data-oculto={alterado ? undefined : ""}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={descartar}>
            {t.descartar}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-cta"
           
            onClick={() => void salvar()}
            disabled={salvando || algumProblema}
          >
            {salvando ? t.salvando : t.salvar}
          </button>
        </div>
      </div>
    </div>
  );
}
