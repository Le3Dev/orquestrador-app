import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Voltar e avançar dentro de uma página de artefato. A página roda num iframe
 * isolado (`sandbox="allow-scripts"`, sem `allow-same-origin`): o app não lê o
 * histórico dela. Por isso o app injeta no HTML um script pequeno que (1) avisa,
 * por postMessage, se dá para voltar e avançar, a cada navegação, e (2) obedece
 * aos comandos "voltar" e "avançar" que só o app (a janela pai) pode mandar.
 *
 * A Navigation API não serve: num iframe `srcdoc` (about:srcdoc) ela não lista
 * entradas (testado no Chromium do Electron 33). O script então conta o histórico
 * do próprio quadro: cada link de âncora (#secao), `history.pushState` e `replaceState`
 * da página entra numa pilha de endereços (`back`, `forward` e `go` da página também
 * são contados). O comando do app anda um passo de cada vez e só quando a pilha mostra
 * que há para onde ir: nunca além das entradas do próprio quadro, então o app não perde
 * a página em que está.
 *
 * O que sobe é só um objeto com três booleanos: nada da página chega ao app.
 */

const ORIGEM_DA_PAGINA = "orquestrador-artefato";
const ORIGEM_DO_APP = "orquestrador-app";

export interface EstadoDaNavegacao {
  /** A página do artefato avisou que está com o script e tem como andar no histórico. */
  suportado: boolean;
  podeVoltar: boolean;
  podeAvancar: boolean;
}

export const SEM_NAVEGACAO: EstadoDaNavegacao = { suportado: false, podeVoltar: false, podeAvancar: false };

/** O script injetado no HTML do artefato. Roda dentro do iframe, escrito sem dependência do app. */
export const SCRIPT_DE_NAVEGACAO = `(function () {
  var pai = window.parent;
  var historico = window.history;
  if (!pai || pai === window || !historico) { return; }
  var pilha = [location.href];
  var posicao = 0;
  var pendente = 0;
  var prazo = 0;
  function avisar() {
    try {
      pai.postMessage({
        origem: "${ORIGEM_DA_PAGINA}",
        suportado: true,
        podeVoltar: posicao > 0,
        podeAvancar: posicao < pilha.length - 1
      }, "*");
    } catch (erro) {}
  }
  function novaEntrada() {
    pilha = pilha.slice(0, posicao + 1);
    pilha.push(location.href);
    posicao = pilha.length - 1;
  }
  function mudou() {
    if (pendente !== 0) {
      posicao = Math.max(0, Math.min(pilha.length - 1, posicao + pendente));
      pilha[posicao] = location.href;
      pendente = 0;
      clearTimeout(prazo);
    } else if (location.href !== pilha[posicao]) {
      novaEntrada();
    } else {
      return;
    }
    avisar();
  }
  function andar(passo) {
    var alvo = posicao + passo;
    if (pendente !== 0 || alvo < 0 || alvo > pilha.length - 1) { return; }
    historico.go(passo);
  }
  var irPara = historico.go;
  historico.go = function (passo) {
    passo = Number(passo) || 0;
    if (passo !== 0) {
      pendente = passo;
      clearTimeout(prazo);
      prazo = setTimeout(function () { pendente = 0; }, 1000);
    }
    return irPara.call(historico, passo);
  };
  historico.back = function () { return historico.go(-1); };
  historico.forward = function () { return historico.go(1); };
  var empurrar = historico.pushState;
  var trocar = historico.replaceState;
  historico.pushState = function () {
    var resultado = empurrar.apply(historico, arguments);
    novaEntrada();
    avisar();
    return resultado;
  };
  historico.replaceState = function () {
    var resultado = trocar.apply(historico, arguments);
    pilha[posicao] = location.href;
    return resultado;
  };
  window.addEventListener("hashchange", mudou);
  window.addEventListener("popstate", mudou);
  window.addEventListener("message", function (evento) {
    var dados = evento.data;
    if (evento.source !== pai || !dados || dados.origem !== "${ORIGEM_DO_APP}") { return; }
    if (dados.acao === "voltar") { andar(-1); }
    else if (dados.acao === "avancar") { andar(1); }
    else if (dados.acao === "estado") { avisar(); }
  });
  avisar();
})();`;

/** `<script>` com o script de navegação: vai junto da política de segurança, no começo do HTML. */
export const TAG_DO_SCRIPT_DE_NAVEGACAO = `<script>${SCRIPT_DE_NAVEGACAO}</script>`;

/** O aviso que a página manda, ou nulo se a mensagem não é dela ou está malformada. */
export function lerAvisoDeNavegacao(dados: unknown): EstadoDaNavegacao | null {
  if (typeof dados !== "object" || dados === null) {
    return null;
  }
  const aviso = dados as Record<string, unknown>;
  if (
    aviso.origem !== ORIGEM_DA_PAGINA ||
    typeof aviso.suportado !== "boolean" ||
    typeof aviso.podeVoltar !== "boolean" ||
    typeof aviso.podeAvancar !== "boolean"
  ) {
    return null;
  }
  return { suportado: aviso.suportado, podeVoltar: aviso.podeVoltar, podeAvancar: aviso.podeAvancar };
}

function mesmoEstado(a: EstadoDaNavegacao, b: EstadoDaNavegacao): boolean {
  return a.suportado === b.suportado && a.podeVoltar === b.podeVoltar && a.podeAvancar === b.podeAvancar;
}

/**
 * O histórico do iframe do artefato: o estado (se dá para voltar e avançar) e
 * os comandos. `ligarQuadro` vai no `ref` do iframe e `aoCarregarQuadro` no
 * `onLoad` dele. Só vale a mensagem que vem da janela desse iframe
 * (`evento.source`); mensagens de outra janela ou de outro formato são ignoradas.
 */
export function useNavegacaoDoQuadro(): {
  estado: EstadoDaNavegacao;
  ligarQuadro: (quadro: HTMLIFrameElement | null) => void;
  aoCarregarQuadro: () => void;
  voltar: () => void;
  avancar: () => void;
} {
  const quadro = useRef<HTMLIFrameElement | null>(null);
  const [estado, setEstado] = useState<EstadoDaNavegacao>(SEM_NAVEGACAO);

  useEffect(() => {
    const aoReceber = (evento: MessageEvent) => {
      const atual = quadro.current;
      if (atual === null || evento.source === null || evento.source !== atual.contentWindow) {
        return;
      }
      const aviso = lerAvisoDeNavegacao(evento.data);
      if (aviso !== null) {
        setEstado((anterior) => (mesmoEstado(anterior, aviso) ? anterior : aviso));
      }
    };
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
  }, []);

  const mandar = useCallback((acao: "voltar" | "avancar" | "estado") => {
    // A origem do iframe é opaca (sem `allow-same-origin`): só `*` alcança. O comando não leva dado nenhum.
    quadro.current?.contentWindow?.postMessage({ origem: ORIGEM_DO_APP, acao }, "*");
  }, []);

  const ligarQuadro = useCallback((novo: HTMLIFrameElement | null) => {
    if (quadro.current !== novo) {
      // Outro quadro (outra versão, tela cheia) ou nenhum: o histórico do anterior não vale mais.
      setEstado(SEM_NAVEGACAO);
    }
    quadro.current = novo;
  }, []);

  const aoCarregarQuadro = useCallback(() => mandar("estado"), [mandar]);
  const voltar = useCallback(() => mandar("voltar"), [mandar]);
  const avancar = useCallback(() => mandar("avancar"), [mandar]);

  return { estado, ligarQuadro, aoCarregarQuadro, voltar, avancar };
}
