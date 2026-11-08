import { type KeyboardEvent, useId, useRef, useState } from "react";

import { mensagemDeErro } from "../../shared/api/cliente";
import type { PerguntaDoApp } from "../../shared/api/tipos";

interface Props {
  perguntas: readonly PerguntaDoApp[];
  /** Já há uma mensagem (ou um pedido) depois da que perguntou: o cartão fica travado como respondido. */
  respondida: boolean;
  /** O Claude está respondendo, ou o servidor está fora do ar: nada pode ser escolhido. */
  desabilitado: boolean;
  /** Envia a resposta como a próxima mensagem do usuário, pelo mesmo envio do campo; lança se o servidor recusar. */
  aoResponder: (texto: string) => Promise<void>;
}

/** O que o usuário escolheu numa pergunta: rótulos das opções e o texto do "Outro…", se confirmado. */
interface Escolha {
  opcoes: readonly string[];
  outro: string | null;
}

const SEM_ESCOLHA: Escolha = { opcoes: [], outro: null };

type Etapa = { tipo: "pronto" } | { tipo: "enviando" } | { tipo: "enviada" } | { tipo: "erro"; mensagem: string };

/** As escolhas de uma pergunta, na ordem das opções, com o "Outro…" por último. */
function escolhidas(pergunta: PerguntaDoApp, escolha: Escolha): string[] {
  const marcadas = pergunta.opcoes.map((opcao) => opcao.rotulo).filter((rotulo) => escolha.opcoes.includes(rotulo));
  return escolha.outro === null ? marcadas : [...marcadas, escolha.outro];
}

/**
 * A mensagem com a resposta: uma linha por pergunta, `<pergunta> → <escolha>`,
 * com as várias escolhas de uma pergunta separadas por ", ".
 */
function textoDaResposta(perguntas: readonly PerguntaDoApp[], escolhas: readonly Escolha[]): string {
  return perguntas
    .map((pergunta, indice) => `${pergunta.pergunta} → ${escolhidas(pergunta, escolhas[indice] ?? SEM_ESCOLHA).join(", ")}`)
    .join("\n");
}

/**
 * Perguntas do Claude com opções clicáveis, como no VS Code: um botão por
 * opção e o campo "Outro…" para escrever a resposta. Uma pergunta só, de
 * escolha única, responde no clique; com escolha múltipla ou várias
 * perguntas, o usuário marca e envia tudo junto pelo "Responder". A resposta
 * vai como a próxima mensagem do usuário, e o cartão trava em seguida.
 */
export function CartaoDePergunta({ perguntas, respondida, desabilitado, aoResponder }: Props) {
  const id = useId();
  const [escolhas, setEscolhas] = useState<readonly Escolha[]>(() => perguntas.map(() => SEM_ESCOLHA));
  const [rascunhos, setRascunhos] = useState<readonly string[]>(() => perguntas.map(() => ""));
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "pronto" });
  // Trava síncrona: dois cliques no mesmo instante não enviam duas vezes.
  const enviandoAgora = useRef(false);

  // Uma pergunta só, de escolha única: o clique já responde.
  const imediata = perguntas.length === 1 && perguntas[0]?.multipla === false;
  const travado = respondida || etapa.tipo === "enviando" || etapa.tipo === "enviada";
  const bloqueado = travado || desabilitado;
  const completa = perguntas.every((pergunta, indice) => escolhidas(pergunta, escolhas[indice] ?? SEM_ESCOLHA).length > 0);

  async function enviar(novas: readonly Escolha[]): Promise<void> {
    if (bloqueado || enviandoAgora.current) {
      return;
    }
    enviandoAgora.current = true;
    setEscolhas(novas);
    setEtapa({ tipo: "enviando" });
    try {
      await aoResponder(textoDaResposta(perguntas, novas));
      setEtapa({ tipo: "enviada" });
    } catch (falha) {
      enviandoAgora.current = false;
      setEtapa({ tipo: "erro", mensagem: mensagemDeErro(falha) });
    }
  }

  function trocarEscolha(indice: number, escolha: Escolha): readonly Escolha[] {
    const novas = escolhas.map((atual, posicao) => (posicao === indice ? escolha : atual));
    setEscolhas(novas);
    return novas;
  }

  function escolherOpcao(indice: number, rotulo: string): void {
    if (bloqueado) {
      return;
    }
    if (imediata) {
      void enviar([{ opcoes: [rotulo], outro: null }]);
      return;
    }
    const pergunta = perguntas[indice];
    const atual = escolhas[indice] ?? SEM_ESCOLHA;
    const marcada = atual.opcoes.includes(rotulo);
    if (pergunta?.multipla === true) {
      trocarEscolha(indice, {
        ...atual,
        opcoes: marcada ? atual.opcoes.filter((item) => item !== rotulo) : [...atual.opcoes, rotulo],
      });
    } else {
      // Escolha única: a opção substitui a anterior (e o "Outro…"); clicar de novo desmarca.
      trocarEscolha(indice, marcada ? SEM_ESCOLHA : { opcoes: [rotulo], outro: null });
    }
  }

  function usarOutro(indice: number): void {
    const texto = (rascunhos[indice] ?? "").trim();
    if (bloqueado || texto === "") {
      return;
    }
    if (imediata) {
      void enviar([{ opcoes: [], outro: texto }]);
      return;
    }
    const atual = escolhas[indice] ?? SEM_ESCOLHA;
    trocarEscolha(indice, perguntas[indice]?.multipla === true ? { ...atual, outro: texto } : { opcoes: [], outro: texto });
    setRascunhos((atuais) => atuais.map((rascunho, posicao) => (posicao === indice ? "" : rascunho)));
  }

  function aoTeclarNoOutro(evento: KeyboardEvent<HTMLInputElement>, indice: number): void {
    if (evento.key === "Enter" && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      usarOutro(indice);
    }
  }

  const situacao =
    etapa.tipo === "enviando" ? " · enviando…" : travado ? " · respondida" : "";

  return (
    <div
      className={`cartao-de-pergunta ${travado ? "cartao-de-pergunta-respondida" : ""}`}
      role="group"
      aria-label={perguntas.length === 1 ? "Pergunta do Claude" : "Perguntas do Claude"}
    >
      <span className="rotulo-tecnico">
        {perguntas.length === 1 ? "pergunta do claude" : `${perguntas.length} perguntas do claude`}
        {situacao}
      </span>
      {perguntas.map((pergunta, indice) => {
        const escolha = escolhas[indice] ?? SEM_ESCOLHA;
        const rascunho = rascunhos[indice] ?? "";
        const idDaPergunta = `${id}-pergunta-${indice}`;
        return (
          <div
            key={`${indice}:${pergunta.pergunta}`}
            className="pergunta-do-cartao"
            role="group"
            aria-labelledby={idDaPergunta}
          >
            <p id={idDaPergunta} className="texto-da-pergunta texto-longo">
              {pergunta.pergunta}
            </p>
            {pergunta.multipla && <p className="hint">escolha uma ou mais</p>}
            <div className="opcoes-da-pergunta">
              {pergunta.opcoes.map((opcao, posicao) => {
                const marcada = escolha.opcoes.includes(opcao.rotulo);
                const idDaDescricao = `${idDaPergunta}-opcao-${posicao}`;
                return (
                  <button
                    key={`${posicao}:${opcao.rotulo}`}
                    type="button"
                    className={`opcao-da-pergunta ${marcada ? "opcao-marcada" : ""}`}
                    aria-label={opcao.rotulo}
                    aria-describedby={opcao.descricao === null ? undefined : idDaDescricao}
                    aria-pressed={imediata ? undefined : marcada}
                    disabled={bloqueado}
                    onClick={() => escolherOpcao(indice, opcao.rotulo)}
                  >
                    <span className="rotulo-da-opcao">{opcao.rotulo}</span>
                    {opcao.descricao !== null && (
                      <span id={idDaDescricao} className="descricao-da-opcao">
                        {opcao.descricao}
                      </span>
                    )}
                  </button>
                );
              })}
              {escolha.outro !== null && (
                <button
                  type="button"
                  className="opcao-da-pergunta opcao-marcada"
                  aria-label={`Outro: ${escolha.outro}`}
                  aria-pressed
                  title="Clique para desmarcar"
                  disabled={bloqueado}
                  onClick={() => trocarEscolha(indice, { ...escolha, outro: null })}
                >
                  <span className="rotulo-da-opcao">{escolha.outro}</span>
                  <span className="descricao-da-opcao">outra resposta</span>
                </button>
              )}
            </div>
            {!travado && (
              <div className="outro-da-pergunta">
                <input
                  type="text"
                  className="input campo-do-outro"
                  placeholder="Outro…"
                  aria-label={`Outra resposta para: ${pergunta.pergunta}`}
                  value={rascunho}
                  disabled={bloqueado}
                  onChange={(evento) => {
                    const valor = evento.target.value;
                    setRascunhos((atuais) => atuais.map((atual, posicao) => (posicao === indice ? valor : atual)));
                  }}
                  onKeyDown={(evento) => aoTeclarNoOutro(evento, indice)}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  disabled={bloqueado || rascunho.trim() === ""}
                  onClick={() => usarOutro(indice)}
                >
                  {imediata ? "enviar" : "usar"}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {!imediata && !travado && (
        <div className="acoes-da-pergunta">
          <button
            type="button"
            className="btn btn-sm btn-cta"
            disabled={bloqueado || !completa}
            title={completa ? undefined : "Escolha uma resposta para cada pergunta"}
            onClick={() => void enviar(escolhas)}
          >
            Responder
          </button>
        </div>
      )}
      {etapa.tipo === "erro" && (
        <span className="hint-error texto-longo" role="alert">
          Não foi possível enviar a resposta: {etapa.mensagem}
        </span>
      )}
    </div>
  );
}
