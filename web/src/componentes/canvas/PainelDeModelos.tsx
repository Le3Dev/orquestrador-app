import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import {
  type ConteudoDoModeloDeCanvas,
  type DadosDoModeloDeCanvas,
  type ItemDoModelo,
  MAXIMO_DE_MODELOS_DE_CANVAS,
  TAMANHO_MAXIMO_DO_NOME_DO_MODELO,
} from "../../shared/api/tipos";
import {
  type ArranjoDaSelecao,
  descreverContagem,
  lerArquivoDeModelo,
  nomeDoArquivoDoModelo,
  resumirModelo,
  type ResultadoDoItem,
} from "../../shared/canvas/modelos";
import { IconeFechar, IconeModelo } from "../Icones";
import { NavegadorDePastas } from "./NavegadorDePastas";

/** Os ícones oferecidos; o campo ao lado aceita qualquer outro emoji. */
export const ICONES_DOS_MODELOS = ["🧩", "🚀", "🛠️", "🧪", "📋", "🌐", "🐛", "💡"] as const;

/** As cores oferecidas, com o nome para quem usa leitor de tela. */
export const CORES_DOS_MODELOS = [
  { valor: "#d97757", nome: "laranja" },
  { valor: "#e0b252", nome: "amarelo" },
  { valor: "#6bbf73", nome: "verde" },
  { valor: "#5aa9e6", nome: "azul" },
  { valor: "#a78bfa", nome: "roxo" },
  { valor: "#e06c9f", nome: "rosa" },
] as const;

/** Quanto esperar antes de liberar o endereço do arquivo baixado (o download já começou). */
const ESPERA_PARA_LIBERAR_O_DOWNLOAD_MS = 10_000;

/** Baixa o texto como arquivo, como o "salvar como" dos artefatos (o app desktop pergunta onde salvar). */
function baixar(texto: string, nome: string): void {
  const endereco = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = endereco;
  link.download = nome;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(endereco), ESPERA_PARA_LIBERAR_O_DOWNLOAD_MS);
}

/** O texto do arquivo escolhido (pelo FileReader, que todo navegador e o jsdom têm). */
function lerTexto(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(typeof leitor.result === "string" ? leitor.result : "");
    leitor.onerror = () => rejeitar(new Error("Não foi possível ler o arquivo."));
    leitor.readAsText(arquivo);
  });
}

/** O ícone do modelo num quadrado da cor dele. */
function SeloDoModelo({ icone, cor, tamanho = 30 }: { icone: string; cor: string; tamanho?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-md border"
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: Math.round(tamanho * 0.52),
        background: `color-mix(in srgb, ${cor} 22%, transparent)`,
        borderColor: `color-mix(in srgb, ${cor} 70%, transparent)`,
      }}
    >
      {icone}
    </span>
  );
}

/** Nome, ícone e cor: o que se escolhe ao salvar e ao editar um modelo. */
export interface IdentidadeDoModelo {
  nome: string;
  icone: string;
  cor: string;
}

function CamposDoModelo({
  valor,
  aoMudar,
  focarNome = false,
}: {
  valor: IdentidadeDoModelo;
  aoMudar: (valor: IdentidadeDoModelo) => void;
  focarNome?: boolean;
}) {
  const idDoNome = useId();
  const campoDoNome = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focarNome) {
      campoDoNome.current?.focus();
    }
  }, [focarNome]);
  const outroIcone = !(ICONES_DOS_MODELOS as readonly string[]).includes(valor.icone);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1" htmlFor={idDoNome}>
        <span className="label">Nome</span>
        <input
          ref={campoDoNome}
          id={idDoNome}
          className="input campo-escuro"
          value={valor.nome}
          maxLength={TAMANHO_MAXIMO_DO_NOME_DO_MODELO}
          placeholder="Ex.: Backend com prévia"
          onChange={(evento) => aoMudar({ ...valor, nome: evento.target.value })}
        />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="label mb-1">Ícone</legend>
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Ícone do modelo">
          {ICONES_DOS_MODELOS.map((icone) => (
            <button
              key={icone}
              type="button"
              role="radio"
              aria-checked={valor.icone === icone}
              aria-label={`Ícone ${icone}`}
              className={`grid h-8 w-8 place-items-center rounded-md border text-[16px] ${
                valor.icone === icone ? "border-active bg-surface-3" : "border-border hover:bg-surface-3"
              }`}
              onClick={() => aoMudar({ ...valor, icone })}
            >
              {icone}
            </button>
          ))}
          <input
            className={`input campo-escuro h-8 text-center ${outroIcone ? "border-active" : ""}`}
            style={{ width: "6rem" }}
            aria-label="Outro emoji"
            placeholder="outro"
            maxLength={16}
            value={outroIcone ? valor.icone : ""}
            onChange={(evento) => aoMudar({ ...valor, icone: evento.target.value.trim() === "" ? ICONES_DOS_MODELOS[0] : evento.target.value.trim() })}
          />
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="label mb-1">Cor</legend>
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Cor do modelo">
          {CORES_DOS_MODELOS.map((cor) => (
            <button
              key={cor.valor}
              type="button"
              role="radio"
              aria-checked={valor.cor === cor.valor}
              aria-label={`Cor ${cor.nome}`}
              title={cor.nome}
              className="h-7 w-7 rounded-full border-2"
              style={{
                background: cor.valor,
                borderColor: valor.cor === cor.valor ? "var(--primary)" : "transparent",
                boxShadow: valor.cor === cor.valor ? `0 0 0 2px ${cor.valor}` : undefined,
              }}
              onClick={() => aoMudar({ ...valor, cor: cor.valor })}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** As pastas e os comandos que o modelo leva, para o usuário ver antes de salvar ou importar. */
function DetalhesDoModelo({ itens }: { itens: readonly ItemDoModelo[] }) {
  const resumo = resumirModelo(itens);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-primary" data-testid="contagem-do-modelo">
        {descreverContagem(resumo)}
      </p>
      {resumo.pastas.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label">Pastas</span>
          <ul className="mono flex flex-col gap-0.5 text-[11.5px] text-secondary" aria-label="Pastas do modelo">
            {resumo.pastas.map((pasta) => (
              <li key={pasta} className="truncate" title={pasta}>
                {pasta}
              </li>
            ))}
          </ul>
        </div>
      )}
      {resumo.comandos.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label">Comandos de terminal (não são executados)</span>
          <ul className="mono flex flex-col gap-0.5 text-[11.5px] text-warning" aria-label="Comandos do modelo">
            {resumo.comandos.map((comando, indice) => (
              <li key={`${indice}-${comando}`} className="truncate" title={comando}>
                $ {comando}
              </li>
            ))}
          </ul>
        </div>
      )}
      {resumo.semPasta > 0 && (
        <p className="text-support">
          {resumo.semPasta === 1
            ? "1 item está sem pasta: ao recriar, o app pede uma pasta para ele."
            : `${resumo.semPasta} itens estão sem pasta: ao recriar, o app pede uma pasta para eles.`}
        </p>
      )}
    </div>
  );
}

interface PropsDoDialogo {
  arranjo: ArranjoDaSelecao;
  /** Salva no servidor; o diálogo mostra o erro se falhar. */
  aoSalvar: (conteudo: ConteudoDoModeloDeCanvas) => Promise<void>;
  aoFechar: () => void;
}

/**
 * "Salvar como modelo" (barra do grupo): nome, ícone e cor do modelo, o que
 * vai nele e o que fica de fora (artefatos, rascunhos). Num portal sobre a
 * tela inteira, como o navegador de pastas.
 */
export function DialogoDeNovoModelo({ arranjo, aoSalvar, aoFechar }: PropsDoDialogo) {
  const [identidade, setIdentidade] = useState<IdentidadeDoModelo>({
    nome: "",
    icone: ICONES_DOS_MODELOS[0],
    cor: CORES_DOS_MODELOS[0].valor,
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const semItens = arranjo.itens.length === 0;

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape" && !evento.defaultPrevented) {
        evento.preventDefault();
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      await aoSalvar({ ...identidade, nome: identidade.nome.trim(), itens: arranjo.itens });
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setSalvando(false);
    }
  }

  return createPortal(
    <div
      className="fundo-que-esmaece fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 nodrag nowheel nopan"
      onClick={aoFechar}
      role="presentation"
    >
      <div
        className="surgir flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border-forte bg-surface shadow-2xl"
        onClick={(evento) => evento.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Salvar como modelo"
      >
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-3">
          <SeloDoModelo icone={identidade.icone} cor={identidade.cor} tamanho={26} />
          <strong className="font-titulo text-[13px] font-semibold">Salvar como modelo</strong>
          <span className="flex-1" />
          <button type="button" className="botao-icone" title="Fechar" aria-label="Fechar" onClick={aoFechar}>
            <IconeFechar tamanho={16} />
          </button>
        </div>
        <form
          className="custom-scrollbar flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            void salvar();
          }}
        >
          <CamposDoModelo valor={identidade} aoMudar={setIdentidade} focarNome />
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="label">O que vai no modelo</span>
            <DetalhesDoModelo itens={arranjo.itens} />
            <p className="text-support">
              Vão o arranjo, os nomes, as configurações e instruções dos orquestradores, o texto das notas e os
              endereços das prévias. Nunca vão as conversas, os worktrees nem o histórico.
            </p>
            {arranjo.ignorados.length > 0 && (
              <div className="alert alert-warning" role="status">
                Ficam de fora: {arranjo.ignorados.join("; ")}.
              </div>
            )}
          </div>
          {erro !== null && (
            <div className="alert alert-error" role="alert">
              {erro}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={aoFechar}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-cta"
              disabled={salvando || semItens || identidade.nome.trim() === ""}
            >
              {salvando ? "Salvando…" : "Salvar modelo"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

interface PropsDoPainel {
  aoFechar: () => void;
  /**
   * Recria o modelo no canvas, perto do centro da tela; `pasta` vale para os
   * orquestradores e terminais sem pasta. Devolve como foi cada item.
   */
  aoRecriar: (modelo: ConteudoDoModeloDeCanvas, pasta: string | null) => Promise<ResultadoDoItem[]>;
}

/** O que o painel mostra no lugar da lista: o resumo de um arquivo importado, à espera da confirmação. */
interface Importacao {
  arquivo: string;
  conteudo: ConteudoDoModeloDeCanvas;
}

interface Resultado {
  nome: string;
  itens: ResultadoDoItem[];
}

/**
 * Modelos de canvas, logo abaixo da barra do canvas: a lista (ícone, cor,
 * nome e quantos itens), recriar, editar (nome, ícone, cor), exportar e
 * apagar, e importar um arquivo exportado. Importar mostra o resumo e só
 * salva depois de confirmar; não recria nada sozinho.
 */
export function PainelDeModelos({ aoFechar, aoRecriar }: PropsDoPainel) {
  const [modelos, setModelos] = useState<DadosDoModeloDeCanvas[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string; valor: IdentidadeDoModelo } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [semCaminhos, setSemCaminhos] = useState(true);
  const [importacao, setImportacao] = useState<Importacao | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pedindoPasta, setPedindoPasta] = useState<DadosDoModeloDeCanvas | null>(null);
  const seletorDeArquivo = useRef<HTMLInputElement>(null);
  const painel = useRef<HTMLElement>(null);

  useEffect(() => {
    let atual = true;
    api
      .listarModelosDeCanvas()
      .then((lista) => {
        if (atual) {
          setModelos(lista);
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

  // Esc fecha, como nos outros painéis da barra: só o dado no painel (ou sem foco).
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.key === "Escape" && !evento.defaultPrevented && noPainel && pedindoPasta === null) {
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, pedindoPasta]);

  async function recriar(modelo: DadosDoModeloDeCanvas, pasta: string | null): Promise<void> {
    setErro(null);
    setResultado(null);
    setOcupado(modelo.id);
    try {
      const itens = await aoRecriar(modelo, pasta);
      setResultado({ nome: modelo.nome, itens });
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(null);
    }
  }

  function pedirRecriar(modelo: DadosDoModeloDeCanvas): void {
    if (resumirModelo(modelo.itens).semPasta > 0) {
      setPedindoPasta(modelo);
      return;
    }
    void recriar(modelo, null);
  }

  async function salvarEdicao(): Promise<void> {
    if (editando === null) {
      return;
    }
    setErro(null);
    setOcupado(editando.id);
    try {
      const alterado = await api.alterarModeloDeCanvas(editando.id, { ...editando.valor, nome: editando.valor.nome.trim() });
      setModelos((atuais) => atuais?.map((modelo) => (modelo.id === alterado.id ? alterado : modelo)) ?? null);
      setEditando(null);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(null);
    }
  }

  async function apagar(modelo: DadosDoModeloDeCanvas): Promise<void> {
    if (!window.confirm(`Apagar o modelo "${modelo.nome}"? O que já foi recriado no canvas continua lá.`)) {
      return;
    }
    setErro(null);
    setOcupado(modelo.id);
    try {
      await api.removerModeloDeCanvas(modelo.id);
      setModelos((atuais) => atuais?.filter((outro) => outro.id !== modelo.id) ?? null);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(null);
    }
  }

  async function exportar(modelo: DadosDoModeloDeCanvas): Promise<void> {
    setErro(null);
    try {
      const arquivo = await api.exportarModeloDeCanvas(modelo.id, semCaminhos);
      baixar(JSON.stringify(arquivo, null, 2), nomeDoArquivoDoModelo(modelo.nome));
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  async function escolherArquivo(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0];
    evento.target.value = "";
    if (arquivo === undefined) {
      return;
    }
    setErro(null);
    setResultado(null);
    try {
      const conteudo = await api.conferirImportacaoDeModelo(lerArquivoDeModelo(await lerTexto(arquivo)));
      setImportacao({ arquivo: arquivo.name, conteudo });
    } catch (falha) {
      setErro(`Não foi possível importar "${arquivo.name}": ${mensagemDeErro(falha)}`);
    }
  }

  async function confirmarImportacao(): Promise<void> {
    if (importacao === null) {
      return;
    }
    setErro(null);
    setOcupado("importacao");
    try {
      const salvo = await api.criarModeloDeCanvas(importacao.conteudo);
      setModelos((atuais) => [...(atuais ?? []), salvo]);
      setImportacao(null);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(null);
    }
  }

  const cheia = modelos !== null && modelos.length >= MAXIMO_DE_MODELOS_DE_CANVAS;

  return (
    <section ref={painel} className="painel-flutuante painel-da-barra mt-2 w-[34rem]" aria-label="Modelos de canvas">
      <header className="painel-da-barra-cabecalho">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[14px]">Modelos de canvas</h2>
          <span className="text-support">
            Arranjos salvos para recriar com um clique. Para salvar um, selecione as telas e use &quot;Salvar como
            modelo&quot; na barra do grupo.
          </span>
        </div>
        <button type="button" className="botao-icone shrink-0" aria-label="Fechar modelos" onClick={aoFechar}>
          <IconeFechar tamanho={16} />
        </button>
      </header>

      <div className="painel-da-barra-corpo custom-scrollbar">
        {resultado !== null && (
          <div
            className={`alert ${resultado.itens.some((item) => item.erro !== null) ? "alert-warning" : "alert-success"}`}
            role="status"
            aria-label="Resultado da recriação"
          >
            <div className="flex flex-col gap-1">
              <strong>
                &quot;{resultado.nome}&quot;: {resultado.itens.filter((item) => item.erro === null).length} de{" "}
                {resultado.itens.length} itens recriados, parados (nenhum pedido foi enviado).
              </strong>
              {resultado.itens
                .filter((item) => item.erro !== null)
                .map((item, indice) => (
                  <span key={`${indice}-${item.rotulo}`} className="text-[12px]">
                    ✗ {item.rotulo}: {item.erro}
                  </span>
                ))}
            </div>
          </div>
        )}
        {erro !== null && (
          <div className="alert alert-error" role="alert">
            {erro}
          </div>
        )}

        {importacao !== null ? (
          <section className="flex flex-col gap-3" aria-label="Resumo da importação">
            <div className="flex items-center gap-2">
              <SeloDoModelo icone={importacao.conteudo.icone} cor={importacao.conteudo.cor} />
              <div className="flex min-w-0 flex-col">
                <strong className="truncate font-titulo text-[13px]">{importacao.conteudo.nome}</strong>
                <span className="mono truncate text-muted">{importacao.arquivo}</span>
              </div>
            </div>
            <DetalhesDoModelo itens={importacao.conteudo.itens} />
            <p className="text-support">
              Importar só guarda o modelo na lista: nada é criado no canvas até você clicar em Recriar, e nenhum
              comando é executado.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setImportacao(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-sm btn-cta"
                disabled={ocupado !== null || cheia}
                onClick={() => void confirmarImportacao()}
              >
                Salvar modelo
              </button>
            </div>
          </section>
        ) : modelos === null ? (
          erro === null && <span className="hint">carregando…</span>
        ) : modelos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <IconeModelo tamanho={22} className="text-muted" />
            <strong className="font-titulo text-[13px]">Nenhum modelo ainda</strong>
            <span className="text-support max-w-sm">
              Arrume orquestradores, notas, prévias e terminais no canvas, selecione as telas (arraste no vazio ou
              Ctrl+A) e clique em &quot;Salvar como modelo&quot;.
            </span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Lista de modelos">
            {modelos.map((modelo) => {
              const resumo = resumirModelo(modelo.itens);
              const emEdicao = editando?.id === modelo.id ? editando : null;
              return (
                <li key={modelo.id} className="flex flex-col gap-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center gap-2.5">
                    <SeloDoModelo icone={modelo.icone} cor={modelo.cor} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <strong className="truncate font-titulo text-[13px]">{modelo.nome}</strong>
                      <span className="mono truncate text-[11.5px] text-muted">
                        {descreverContagem(resumo)}
                        {resumo.semPasta > 0 ? " · sem pasta" : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-cta shrink-0"
                      disabled={ocupado !== null}
                      aria-label={`Recriar ${modelo.nome}`}
                      title="Cria tudo perto do centro da tela, no mesmo arranjo, com os orquestradores parados"
                      onClick={() => pedirRecriar(modelo)}
                    >
                      {ocupado === modelo.id && emEdicao === null ? "Recriando…" : "Recriar"}
                    </button>
                  </div>
                  {emEdicao !== null ? (
                    <div className="flex flex-col gap-3 border-t border-border pt-2.5">
                      <CamposDoModelo
                        valor={emEdicao.valor}
                        aoMudar={(valor) => setEditando({ id: modelo.id, valor })}
                        focarNome
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditando(null)}>
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-cta"
                          disabled={ocupado !== null || emEdicao.valor.nome.trim() === ""}
                          onClick={() => void salvarEdicao()}
                        >
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        aria-label={`Renomear ${modelo.nome}`}
                        onClick={() =>
                          setEditando({ id: modelo.id, valor: { nome: modelo.nome, icone: modelo.icone, cor: modelo.cor } })
                        }
                      >
                        Renomear
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        aria-label={`Exportar ${modelo.nome}`}
                        onClick={() => void exportar(modelo)}
                      >
                        Exportar
                      </button>
                      <span className="flex-1" />
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost text-error"
                        aria-label={`Apagar ${modelo.nome}`}
                        disabled={ocupado !== null}
                        onClick={() => void apagar(modelo)}
                      >
                        Apagar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="painel-da-barra-rodape">
        <label className="mr-auto flex items-center gap-1.5 text-[12px] text-secondary">
          <input type="checkbox" checked={semCaminhos} onChange={(evento) => setSemCaminhos(evento.target.checked)} />
          Exportar sem comandos, caminhos e tokens
        </label>
        <span className={`mono ${cheia ? "text-warning" : "text-muted"}`}>
          {modelos?.length ?? 0} / {MAXIMO_DE_MODELOS_DE_CANVAS}
        </span>
        <input
          ref={seletorDeArquivo}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Arquivo do modelo"
          onChange={(evento) => void escolherArquivo(evento)}
        />
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={cheia}
          onClick={() => seletorDeArquivo.current?.click()}
        >
          Importar…
        </button>
      </div>

      {pedindoPasta !== null && (
        <NavegadorDePastas
          aoEscolher={(pasta) => {
            const modelo = pedindoPasta;
            setPedindoPasta(null);
            void recriar(modelo, pasta);
          }}
          aoFechar={() => setPedindoPasta(null)}
        />
      )}
    </section>
  );
}
