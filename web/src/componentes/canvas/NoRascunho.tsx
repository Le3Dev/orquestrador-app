import { type NodeProps, NodeResizer } from "@xyflow/react";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import {
  type DadosDaConfiguracao,
  type NivelDePermissao,
  type PastaDeProjeto,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
} from "../../shared/api/tipos";
import { useCanvas } from "../../shared/canvas/contexto";
import {
  ESCALA_DA_LETRA_PADRAO,
  opcoesDaEscalaDaLetra,
  TAMANHO_MINIMO_DO_TERMINAL,
} from "../../shared/canvas/layout";
import { ALCA_DO_TERMINAL, type NoRascunho as TipoDoNo } from "../../shared/canvas/nos";
import { ROTULOS_DAS_PERMISSOES } from "../../shared/formatacao";
import {
  ajudaDaPredefinicao,
  useEsforcosHerdados,
  useMotores,
  usePredefinicoes,
  usePreferencias,
} from "../../shared/hooks/useDadosDaConfiguracao";
import { localeDoIdioma, textosAtuais, useIdioma, useTextos } from "../../shared/idioma/idioma";
import { textosDeComponentesComuns } from "../../shared/idioma/textos/componentesComuns";
import { textosDeConfiguracoes } from "../../shared/idioma/textos/configuracoes";
import { textosDeRascunho } from "../../shared/idioma/textos/rascunho";
import { dicaDasVariaveis, tamanhoDasInstrucoes } from "../../shared/instrucoes";
import {
  comoModeloClaude,
  comPredefinicao,
  CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
  problemaDoModeloDoMotor,
} from "../../shared/modelos";
import { resumoDaConfiguracao } from "../../shared/resumoDaConfiguracao";
import { IconeAlerta, IconeFechar } from "../Icones";
import { PreviaDoPromptFinal } from "../PreviaDoPromptFinal";
import { IconeDaPermissao, Rotulo, SeletorDePerfil } from "./LinhasDaConfiguracao";
import { LinhaDaReserva, LinhaDoNavegador, LinhaDosPapeis } from "./LinhasDosMotores";
import { NavegadorDePastas } from "./NavegadorDePastas";
import { QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

const TAMANHO_MAXIMO_DO_NOME = 60;
const PERMISSOES: readonly NivelDePermissao[] = ["leitura", "edicao", "edicao_e_comandos"];

/** Nome exibido para um caminho: a última parte da pasta. */
function nomeDaPasta(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter((parte) => parte !== "");
  return partes[partes.length - 1] ?? caminho;
}

/**
 * O terminal que abre ao clicar em "Novo orquestrador": tudo o que dá para
 * escolher numa tela só, já num padrão bom, para começar rápido. Ao começar,
 * vira o terminal do Orquestrador no mesmo lugar.
 */
export function NoRascunho({ id, data, selected }: NodeProps<TipoDoNo>) {
  const t = useTextos(textosDeRascunho);
  const c = useTextos(textosDeComponentesComuns).configuracao;
  const avisos = useTextos(textosDeConfiguracoes).avisos;
  const locale = localeDoIdioma(useIdioma());
  const { acoes, servidor } = useCanvas();
  const idDoCampo = useId();
  const idDaPermissao = useId();
  const idDaLetra = useId();
  // No nó, e não no estado do formulário: o terminal criado herda daqui.
  const escalaDaLetra = data.escalaDaLetra ?? ESCALA_DA_LETRA_PADRAO;
  const [nome, setNome] = useState("");
  const [pasta, setPasta] = useState("");
  const [configuracao, setConfiguracao] = useState<DadosDaConfiguracao>(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR);
  const [opcoes, setOpcoes] = useState<{ raiz: string; pastas: PastaDeProjeto[] } | null>(null);
  // Pasta escolhida pelo navegador do computador, fora da lista de projetos.
  const [pastaExterna, setPastaExterna] = useState<PastaDeProjeto | null>(null);
  const [navegando, setNavegando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const predefinicoes = usePredefinicoes();
  const economico = predefinicoes.find((predefinicao) => predefinicao.nome === "economico");
  // Os perfis de instruções, para o "Aplicar perfil…"; sem eles (ou sem resposta), o select não aparece.
  const perfis = usePreferencias()?.perfisDeInstrucoes ?? [];

  // Tenta de novo quando o servidor volta: aberto com ele fora, o terminal
  // ficaria preso em "carregando pastas…".
  const carregou = opcoes !== null;
  useEffect(() => {
    if (carregou || !servidor.conectado) {
      return;
    }
    api
      .listarPastas()
      .then((resposta) => {
        setOpcoes(resposta);
        setErro(null);
      })
      .catch((falha: unknown) => setErro(mensagemDeErro(falha)));
  }, [carregou, servidor.conectado]);

  // O aviso de esforço depende dos modelos e da pasta escolhidos: a busca muda junto com eles.
  // O aviso só vale para o Claude Code: um modelo de outro motor não vai para a consulta.
  const { modeloDoOrquestrador, modeloDosSubagentes } = configuracao;
  const buscarEsforcoHerdado = useCallback(
    () =>
      api.lerEsforcoHerdado(
        comoModeloClaude(modeloDoOrquestrador, "opus"),
        comoModeloClaude(modeloDosSubagentes, "sonnet"),
        pasta,
      ),
    [modeloDoOrquestrador, modeloDosSubagentes, pasta],
  );
  const herdados = useEsforcosHerdados(buscarEsforcoHerdado);
  // Quais motores estão instalados; sem a resposta, nenhum é desabilitado.
  const motores = useMotores();

  function mudar<Campo extends keyof DadosDaConfiguracao>(campo: Campo, novo: DadosDaConfiguracao[Campo]): void {
    setConfiguracao((atual) => ({ ...atual, [campo]: novo }));
  }

  /** O nome de um caminho entre as opções: os projetos da raiz ou a pasta escolhida à mão. */
  function nomeDoCaminho(caminho: string): string {
    if (pastaExterna?.caminho === caminho) {
      return pastaExterna.nome;
    }
    if (opcoes !== null && caminho === opcoes.raiz) {
      return nomeDaPasta(caminho);
    }
    return opcoes?.pastas.find((opcao) => opcao.caminho === caminho)?.nome ?? "";
  }

  /** Sugere o nome da pasta como nome do orquestrador, sem apagar um nome digitado. */
  function sugerirNome(escolhida: string): void {
    const anterior = nomeDoCaminho(pasta).slice(0, TAMANHO_MAXIMO_DO_NOME);
    if (nome.trim() === "" || nome === anterior) {
      setNome(escolhida.slice(0, TAMANHO_MAXIMO_DO_NOME));
    }
  }

  function escolherPasta(caminho: string): void {
    sugerirNome(nomeDoCaminho(caminho));
    setPasta(caminho);
    setErro(null);
  }

  /** Confirma a pasta vinda do navegador do computador e a deixa selecionada. */
  function escolherPastaExterna(caminho: string): void {
    const externa = { nome: nomeDaPasta(caminho), caminho };
    sugerirNome(externa.nome);
    setPastaExterna(externa);
    setPasta(caminho);
    setErro(null);
    setNavegando(false);
  }

  const comandos = configuracao.nivelDePermissao === "edicao_e_comandos";
  // Commit e push são comandos git: sem permissão de rodar comandos, a opção não tem efeito.
  const commitSemComandos = configuracao.permitirCommitEPush && !comandos;
  const tamanho = tamanhoDasInstrucoes(configuracao.instrucoesPersonalizadas);
  const passouDoLimite = tamanho > TAMANHO_MAXIMO_DAS_INSTRUCOES;

  const problemaDoModelo = problemaDoModeloDoMotor(configuracao);
  const motivoParaNaoComecar =
    pasta === ""
      ? t.escolhaUmaPasta
      : nome.trim() === ""
        ? t.deUmNome
        : passouDoLimite
          ? t.encurteAsInstrucoes
          : problemaDoModelo !== null
            ? problemaDoModelo
            : !servidor.conectado
              ? t.servidorDesconectado
              : null;

  /**
   * O usuário preencheu algo que daria trabalho refazer: um nome digitado, uma
   * configuração fora do padrão ou uma pasta achada pelo "procurar…". Escolher
   * um projeto da lista, e o nome que vem dele, se refaz num clique e não conta.
   */
  const nomeDigitado = nome.trim() !== "" && nome !== nomeDoCaminho(pasta).slice(0, TAMANHO_MAXIMO_DO_NOME);
  const configuracaoAlterada = (Object.keys(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR) as (keyof DadosDaConfiguracao)[]).some(
    (campo) => JSON.stringify(configuracao[campo]) !== JSON.stringify(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR[campo]),
  );
  const preenchido = nomeDigitado || configuracaoAlterada || pastaExterna !== null;

  /** Sem nada preenchido, descarta direto; com algo, confirma antes de perder. */
  function descartar(): void {
    if (preenchido && !window.confirm(t.confirmarDescartar)) {
      return;
    }
    acoes.descartarRascunho(id);
  }

  async function comecar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    if (motivoParaNaoComecar !== null || criando) {
      return;
    }
    setErro(null);
    setCriando(true);
    try {
      acoes.orquestradorCriado(
        id,
        await api.criarOrquestrador({ nome: nome.trim(), pastaDeTrabalho: pasta, ...configuracao }),
      );
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setCriando(false);
    }
  }

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={TAMANHO_MINIMO_DO_TERMINAL.largura}
        minHeight={TAMANHO_MINIMO_DO_TERMINAL.altura}
        lineClassName="redimensionador-linha"
        handleClassName="redimensionador-alca"
      />
      <form className="janela-terminal janela-terminal-ativa" onSubmit={(evento) => void comecar(evento)}>
        <div className={`barra-do-terminal ${ALCA_DO_TERMINAL}`}>
          <span className="semaforo" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong className="font-titulo min-w-0 truncate text-[12.5px] font-semibold">
            {nome.trim() === "" ? t.novoOrquestrador : t.novoOrquestradorNome(nome.trim())}
          </strong>
          <span className="flex-1" />
          <button
            type="button"
            className="botao-icone nodrag"
            title={t.descartar}
            aria-label={t.descartarRascunho}
            onClick={descartar}
          >
            <IconeFechar tamanho={16} />
          </button>
        </div>

        <div className="conteudo-do-cartao" style={{ zoom: escalaDaLetra }}>
          <div className="corpo-do-terminal corpo-da-criacao custom-scrollbar nodrag nowheel">
            <section className="pasta-da-criacao" aria-label={t.pastaENome}>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Rotulo
                  htmlFor={`${idDoCampo}-pasta`}
                  titulo={t.pastaDeTrabalho}
                  discreto
                  dica={t.pastaDica}
                  explicacao={t.pastaExplicacao}
                />
                <div className="flex min-w-0 items-stretch gap-2">
                  <select
                    id={`${idDoCampo}-pasta`}
                    className="select campo-escuro min-w-0 flex-1 font-mono text-[12px]"
                    value={pasta}
                    title={pasta || undefined}
                    onChange={(evento) => escolherPasta(evento.target.value)}
                  >
                    <option value="" disabled>
                      {opcoes === null ? t.carregandoPastas : t.escolhaUmProjeto}
                    </option>
                    {opcoes?.pastas.map((opcao) => (
                      <option key={opcao.caminho} value={opcao.caminho}>
                        {opcao.nome}
                      </option>
                    ))}
                    {opcoes !== null && <option value={opcoes.raiz}>{t.todosOsProjetos}</option>}
                    {pastaExterna !== null && (
                      <option value={pastaExterna.caminho}>{t.pastaDoComputador(pastaExterna.nome)}</option>
                    )}
                  </select>
                  <button
                    type="button"
                    className="btn btn-outline botao-de-procurar shrink-0"
                    title={t.procurarDica}
                    onClick={() => setNavegando(true)}
                  >
                    {t.procurar}
                  </button>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Rotulo
                  htmlFor={`${idDoCampo}-nome`}
                  titulo={t.nome}
                  discreto
                  dica={t.nomeDica}
                  explicacao={t.nomeExplicacao}
                />
                <input
                  id={`${idDoCampo}-nome`}
                  className="input campo-escuro"
                  value={nome}
                  maxLength={TAMANHO_MAXIMO_DO_NOME}
                  onChange={(evento) => setNome(evento.target.value)}
                  placeholder={t.nomePlaceholder}
                  spellCheck={false}
                />
              </div>
            </section>

            <div className="linha-da-criacao mt-3.5">
              <Rotulo
                id={idDaPermissao}
                titulo={c.permissao}
                dica={c.permissaoDica}
                explicacao={t.permissaoExplicacao(ROTULOS_DAS_PERMISSOES.leitura.nome)}
                alinharAoTopo
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="permissoes-da-criacao" role="radiogroup" aria-labelledby={idDaPermissao}>
                  {PERMISSOES.map((nivel) => {
                    const escolhida = configuracao.nivelDePermissao === nivel;
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
                    ? c.avisoDeComandos
                    : ROTULOS_DAS_PERMISSOES[configuracao.nivelDePermissao].descricao}
                </span>
              </div>
            </div>

            <LinhaDosPapeis
              idDoCampo={idDoCampo}
              valor={configuracao}
              aoMudar={setConfiguracao}
              motores={motores}
              herdados={herdados}
            />

            <LinhaDaReserva valor={configuracao} aoMudar={setConfiguracao} motores={motores} />

            <div className="linha-da-criacao">
              <Rotulo
                titulo={c.quantidade}
                dica={c.quantidadeDica}
                explicacao={c.quantidadeExplicacao}
                alinharAoTopo
              />
              <QuantidadeDeSubagentes
                valor={configuracao.quantidadeDeSubagentes}
                aoMudar={(quantidade) => mudar("quantidadeDeSubagentes", quantidade)}
              />
            </div>


            <div className="linha-da-criacao">
              <Rotulo
                titulo={c.opcoes}
                dica={c.opcoesDica}
                explicacao={t.opcoesExplicacao(avisos.artefatosOnlineRotulo, avisos.artefatosOnlineAjuda)}
                alinharAoTopo
              />
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    role="switch"
                    className="interruptor"
                    aria-checked={configuracao.permitirCommitEPush}
                    onClick={() => mudar("permitirCommitEPush", !configuracao.permitirCommitEPush)}
                  >
                    <span className={`interruptor-trilho ${commitSemComandos ? "interruptor-sem-efeito" : ""}`} aria-hidden="true" />
                    {c.commitEPush}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    className="interruptor"
                    title={avisos.artefatosOnlineAjuda}
                    aria-checked={configuracao.permitirArtefatosOnline}
                    onClick={() => mudar("permitirArtefatosOnline", !configuracao.permitirArtefatosOnline)}
                  >
                    <span className="interruptor-trilho" aria-hidden="true" />
                    {avisos.artefatosOnlineRotulo}
                  </button>
                  {economico !== undefined && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost ml-auto shrink-0"
                      title={ajudaDaPredefinicao(economico)}
                      onClick={() => setConfiguracao((atual) => comPredefinicao(atual, economico.configuracao))}
                    >
                      {c.modoEconomico}
                    </button>
                  )}
                </div>
                {/* O aviso fica embaixo: o Modo econômico não muda de lugar quando ele aparece. */}
                {commitSemComandos && (
                  <span className="text-[11.5px] text-warning">
                    {c.soValeCom(ROTULOS_DAS_PERMISSOES.edicao_e_comandos.nome)}
                  </span>
                )}
              </div>
            </div>

            <LinhaDoNavegador valor={configuracao} aoMudar={setConfiguracao} />

            <div className="linha-da-criacao">
              <Rotulo
                id={idDaLetra}
                titulo={c.tamanhoDaLetra}
                dica={c.tamanhoDaLetraDica}
                explicacao={t.tamanhoDaLetraExplicacao}
              />
              <div className="permissoes-da-criacao w-fit" role="radiogroup" aria-labelledby={idDaLetra}>
                {opcoesDaEscalaDaLetra().map((opcao) => (
                  <label key={opcao.valor} className="opcao-da-permissao">
                    <input
                      type="radio"
                      name={`${idDaLetra}-escala`}
                      value={opcao.valor}
                      checked={escalaDaLetra === opcao.valor}
                      onChange={() => acoes.mudarEscalaDaLetra(id, opcao.valor)}
                    />
                    {opcao.titulo}
                  </label>
                ))}
              </div>
            </div>

            <div className="linha-da-criacao">
              <Rotulo
                htmlFor={`${idDoCampo}-instrucoes`}
                titulo={c.instrucoes}
                dica={c.instrucoesDica}
                explicacao={t.instrucoesExplicacao}
                alinharAoTopo
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <SeletorDePerfil
                  perfis={perfis}
                  textoAtual={configuracao.instrucoesPersonalizadas}
                  aoAplicar={(texto) => mudar("instrucoesPersonalizadas", texto)}
                />
                <textarea
                  id={`${idDoCampo}-instrucoes`}
                  className="textarea instrucoes-da-criacao custom-scrollbar"
                  rows={7}
                  value={configuracao.instrucoesPersonalizadas}
                  placeholder={c.instrucoesPlaceholder}
                  aria-invalid={passouDoLimite}
                  spellCheck
                  onChange={(evento) => mudar("instrucoesPersonalizadas", evento.target.value)}
                />
                <span className="hint">{dicaDasVariaveis()}</span>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <PreviaDoPromptFinal
                      configuracao={configuracao}
                      pastaDeTrabalho={pasta || undefined}
                      nome={nome.trim() || undefined}
                      comoLink
                    />
                  </div>
                  <span className={`mono shrink-0 text-[11px] ${passouDoLimite ? "text-error" : "text-muted"}`} aria-live="polite">
                    {tamanho.toLocaleString(locale)} / {TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString(locale)}
                  </span>
                </div>
                {passouDoLimite && (
                  <span className="text-[11px] text-error" role="alert">
                    {t.passouDoLimite(TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString(locale))}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="rodape-da-criacao nodrag">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {erro !== null ? (
                <p className="mono texto-longo line-clamp-3 text-[11.5px] text-error" role="alert">
                  ✗ {erro}
                </p>
              ) : motivoParaNaoComecar !== null ? (
                <span className="flex items-center gap-2 text-[12.5px] text-warning">
                  <IconeAlerta tamanho={15} className="shrink-0" />
                  {motivoParaNaoComecar}
                </span>
              ) : (
                <>
                  <span className="truncate text-[12.5px] text-primary">{resumoDaConfiguracao(configuracao)}</span>
                  <span className="mono truncate text-[11px] text-muted" title={pasta}>
                    {detalhes(configuracao, pasta)}
                  </span>
                </>
              )}
            </div>
            <button type="button" className="btn btn-ghost shrink-0" onClick={descartar}>
              {t.descartar}
            </button>
            <button
              type="submit"
              className="btn btn-cta botao-de-comecar"
              disabled={criando || motivoParaNaoComecar !== null}
            >
              <span className="truncate">
                {criando ? t.comecando : motivoParaNaoComecar === null ? t.comecarEm(nome.trim()) : t.comecar}
              </span>
              <span aria-hidden="true">⏎</span>
            </button>
          </div>
        </div>
      </form>

      {navegando && (
        <NavegadorDePastas
          caminhoInicial={pastaExterna?.caminho ?? opcoes?.raiz}
          aoEscolher={escolherPastaExterna}
          aoFechar={() => setNavegando(false)}
        />
      )}
    </>
  );
}

/** Ex.: "/p/meu-app · commit e push · instruções próprias". */
function detalhes(configuracao: DadosDaConfiguracao, pasta: string): string {
  const textos = textosAtuais(textosDeRascunho).detalhes;
  return [
    pasta,
    ...(configuracao.permitirCommitEPush && configuracao.nivelDePermissao === "edicao_e_comandos" ? [textos.commitEPush] : []),
    ...(configuracao.permitirArtefatosOnline ? [textos.artefatosOnline] : []),
    configuracao.instrucoesPersonalizadas.trim() === "" ? textos.instrucoesGerais : textos.instrucoesProprias,
  ].join(" · ");
}
