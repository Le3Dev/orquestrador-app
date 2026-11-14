import { useCallback, useEffect, useRef, useState } from "react";

import { apiDosArtefatos, type TracoGravado } from "./api/artefatos";
import { ErroDaApi, mensagemDeErro } from "./api/cliente";
import {
  DISTANCIA_MINIMA_ENTRE_PONTOS_PX,
  LIMITE_DO_DESFAZER,
  simplificarPontos,
  TOLERANCIA_DA_SIMPLIFICACAO_PX,
} from "./canvas/desenho";
import { lerDesenhoDaTelaCheia, salvarDesenhoDaTelaCheia } from "./canvas/layout";
import {
  interpretarLarguraDaPagina,
  interpretarTracoGravado,
  interpretarTracosGravados,
  MAXIMO_DE_TRACOS_NO_DESENHO,
} from "./desenhoNaPagina";

/** Quanto tempo a gravação espera por outro passo antes de ir ao servidor (os passos seguidos vão juntos). */
export const ATRASO_DA_GRAVACAO_MS = 300;

export type SituacaoDoDesenho = "carregando" | "pronto" | "erro";

export interface DesenhoDoArtefato {
  /** Os traços da versão (vazio enquanto carrega ou se a leitura falhou). */
  tracos: readonly TracoGravado[];
  /**
   * A largura da página (px CSS) quando o primeiro traço foi feito: enquanto houver
   * traços, a página é montada nela. Nula sem traços ou no desenho que não a tem (o migrado).
   */
  largura: number | null;
  /** Só com o desenho `pronto` dá para mexer nele: antes disso, gravar apagaria o que está no servidor. */
  situacao: SituacaoDoDesenho;
  podeDesfazer: boolean;
  /** O que deu errado ao ler ou gravar (a tela continua com os traços). */
  problema: string | null;
  /** `largura`: a da página agora; só vale se o desenho estava vazio (é o primeiro traço). */
  acrescentar: (traco: TracoGravado, largura: number | null) => void;
  apagar: (ids: readonly string[]) => void;
  desfazer: () => void;
  /** Grava agora o passo que estava esperando o atraso (ao fechar a tela cheia). */
  gravarJa: () => void;
  tentarDeNovo: () => void;
}

/** Um momento do desenho: os traços e a largura da página em que eles foram feitos. */
interface Momento {
  tracos: TracoGravado[];
  largura: number | null;
}

interface Lido extends Momento {
  chave: string;
  situacao: "pronto" | "erro";
  /** Os momentos anteriores, para o desfazer (a largura volta junto). */
  passados: Momento[];
}

const SEM_TRACOS: readonly TracoGravado[] = [];

function distancia(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * O traço que a página devolveu, pronto para guardar: a mão livre simplificada; a
 * linha, a seta e o retângulo sem tamanho (um clique sem arrastar) não entram.
 */
function acabamento(traco: TracoGravado): TracoGravado | null {
  const [de, ate] = traco.pontos;
  switch (traco.tipo) {
    case "caneta":
    case "marca-texto":
      return { ...traco, pontos: simplificarPontos(traco.pontos, TOLERANCIA_DA_SIMPLIFICACAO_PX) };
    case "texto":
      return traco;
    default:
      if (de === undefined || ate === undefined || distancia(de, ate) < DISTANCIA_MINIMA_ENTRE_PONTOS_PX) {
        return null;
      }
      return { ...traco, pontos: simplificarPontos(traco.pontos, 0) };
  }
}

/**
 * O desenho antigo do artefato (guardado no navegador, antes de o desenho ir para o
 * servidor), como traços gravados sem âncora: em coordenadas do documento.
 */
function desenhoAntigo(artefatoId: string): TracoGravado[] {
  return lerDesenhoDaTelaCheia(artefatoId)
    .slice(0, MAXIMO_DE_TRACOS_NO_DESENHO)
    .map((traco) => interpretarTracoGravado({ ...traco, ancora: null }))
    .filter((traco): traco is TracoGravado => traco !== null);
}

/**
 * O desenho sobre a página de uma versão do artefato, guardado no servidor. Cada
 * versão tem o seu: trocar de versão mostra os traços dela; versão nova começa
 * limpa. Cada passo (traço, borracha, desfazer) vai ao servidor depois de
 * `ATRASO_DA_GRAVACAO_MS` sem outro passo; ao trocar de versão, ao fechar a janela
 * ou com `gravarJa`, vai na hora. As gravações saem uma de cada vez, na ordem.
 * Falhou: o desenho fica na tela e o próximo passo tenta de novo (grava tudo).
 *
 * A largura da página vem com o primeiro traço e fica enquanto houver traços;
 * apagou tudo, ela volta a nula (a página flui de novo).
 *
 * Migração (uma vez): sem desenho no servidor na versão atual e com o desenho
 * antigo no navegador, o antigo vai para a versão atual (sem âncora e sem
 * largura) e sai do navegador quando o servidor aceita.
 */
export function useDesenhoDoArtefato(
  artefatoId: string,
  numero: number,
  { existe, ehAtual }: { existe: boolean; ehAtual: boolean },
): DesenhoDoArtefato {
  const [tentativa, setTentativa] = useState(0);
  const chave = `${artefatoId}\n${numero}\n${tentativa}`;
  const [lido, setLido] = useState<Lido | null>(null);
  const [problemaAoGravar, setProblemaAoGravar] = useState<string | null>(null);
  const [problemaAoLer, setProblemaAoLer] = useState<{ chave: string; mensagem: string } | null>(null);
  // Os passos podem chegar vários antes de um render: a conta parte daqui.
  const lidoAtual = useRef<Lido | null>(null);
  const ehAtualAgora = useRef(ehAtual);
  useEffect(() => {
    ehAtualAgora.current = ehAtual;
  });
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const pendente = useRef<{ artefatoId: string; numero: number; momento: Momento } | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trocar = useCallback((novo: Lido) => {
    lidoAtual.current = novo;
    setLido(novo);
  }, []);

  /** Uma gravação, depois das que já estão na fila. Resolve com `true` se o servidor aceitou. */
  const gravar = useCallback((id: string, versao: number, { tracos, largura }: Momento): Promise<boolean> => {
    const vez = fila.current.then(() =>
      apiDosArtefatos.salvarDesenho(id, versao, tracos, largura).then(
        () => {
          setProblemaAoGravar(null);
          return true;
        },
        (falha: unknown) => {
          setProblemaAoGravar(`Não foi possível gravar o desenho: ${mensagemDeErro(falha)}`);
          return false;
        },
      ),
    );
    fila.current = vez;
    return vez;
  }, []);

  const gravarJa = useCallback(() => {
    if (espera.current !== null) {
      clearTimeout(espera.current);
      espera.current = null;
    }
    const passo = pendente.current;
    pendente.current = null;
    if (passo !== null) {
      void gravar(passo.artefatoId, passo.numero, passo.momento);
    }
  }, [gravar]);

  const agendar = useCallback(
    (momento: Momento) => {
      pendente.current = { artefatoId, numero, momento };
      if (espera.current !== null) {
        clearTimeout(espera.current);
      }
      espera.current = setTimeout(gravarJa, ATRASO_DA_GRAVACAO_MS);
    },
    [artefatoId, numero, gravarJa],
  );

  // Trocou de versão ou a janela saiu: o passo que esperava vai agora (para a versão dele).
  useEffect(() => () => gravarJa(), [artefatoId, numero, gravarJa]);

  useEffect(() => {
    if (!existe) {
      return;
    }
    let ativo = true;
    apiDosArtefatos.lerDesenho(artefatoId, numero).then(
      (gravado) => {
        if (!ativo) {
          return;
        }
        let tracos = interpretarTracosGravados(gravado.tracos);
        let largura = tracos.length === 0 ? null : interpretarLarguraDaPagina(gravado.largura);
        const antigos = tracos.length === 0 && ehAtualAgora.current ? desenhoAntigo(artefatoId) : [];
        if (antigos.length > 0) {
          tracos = antigos;
          largura = null;
        }
        trocar({ chave, situacao: "pronto", tracos, largura, passados: [] });
        if (antigos.length > 0) {
          void gravar(artefatoId, numero, { tracos: antigos, largura: null }).then((aceito) => {
            if (aceito) {
              salvarDesenhoDaTelaCheia(artefatoId, []);
            }
          });
        }
      },
      (falha: unknown) => {
        if (!ativo) {
          return;
        }
        if (falha instanceof ErroDaApi && falha.status === 404) {
          // A versão não existe: o corpo já avisa; aqui fica só sem traço.
          trocar({ chave, situacao: "pronto", tracos: [], largura: null, passados: [] });
          return;
        }
        trocar({ chave, situacao: "erro", tracos: [], largura: null, passados: [] });
        setProblemaAoLer({ chave, mensagem: `Não foi possível carregar o desenho: ${mensagemDeErro(falha)}` });
      },
    );
    return () => {
      ativo = false;
    };
  }, [artefatoId, numero, existe, chave, gravar, trocar]);

  /**
   * Um passo sobre o desenho pronto da versão de agora: guarda o antes (desfazer),
   * mostra e grava. A largura: a de `larguraDoComeco` se o desenho estava vazio,
   * nula se ficou vazio, a mesma nos outros casos.
   */
  const mudar = useCallback(
    (calcular: (tracos: TracoGravado[]) => TracoGravado[] | null, larguraDoComeco: number | null = null) => {
      const atual = lidoAtual.current;
      if (atual === null || atual.chave !== chave || atual.situacao !== "pronto") {
        return;
      }
      const depois = calcular(atual.tracos);
      if (depois === null) {
        return;
      }
      const largura =
        depois.length === 0 ? null : atual.tracos.length === 0 ? interpretarLarguraDaPagina(larguraDoComeco) : atual.largura;
      const antes: Momento = { tracos: atual.tracos, largura: atual.largura };
      trocar({ ...atual, tracos: depois, largura, passados: [...atual.passados, antes].slice(-LIMITE_DO_DESFAZER) });
      agendar({ tracos: depois, largura });
    },
    [chave, trocar, agendar],
  );

  const acrescentar = useCallback(
    (traco: TracoGravado, largura: number | null) =>
      mudar((tracos) => {
        const pronto = acabamento(traco);
        if (pronto === null || tracos.length >= MAXIMO_DE_TRACOS_NO_DESENHO || tracos.some(({ id }) => id === pronto.id)) {
          return null;
        }
        return [...tracos, pronto];
      }, largura),
    [mudar],
  );

  const apagar = useCallback(
    (ids: readonly string[]) =>
      mudar((tracos) => {
        const restantes = tracos.filter(({ id }) => !ids.includes(id));
        return restantes.length === tracos.length ? null : restantes;
      }),
    [mudar],
  );

  const desfazer = useCallback(() => {
    const atual = lidoAtual.current;
    const anterior = atual?.passados.at(-1);
    if (atual === null || atual.chave !== chave || anterior === undefined) {
      return;
    }
    trocar({ ...atual, ...anterior, passados: atual.passados.slice(0, -1) });
    agendar(anterior);
  }, [chave, trocar, agendar]);

  const tentarDeNovo = useCallback(() => setTentativa((anterior) => anterior + 1), []);

  const daVez = lido?.chave === chave ? lido : null;
  return {
    tracos: daVez?.tracos ?? SEM_TRACOS,
    largura: daVez?.largura ?? null,
    situacao: daVez?.situacao ?? "carregando",
    podeDesfazer: (daVez?.passados.length ?? 0) > 0,
    problema: (problemaAoLer?.chave === chave ? problemaAoLer.mensagem : null) ?? problemaAoGravar,
    acrescentar,
    apagar,
    desfazer,
    gravarJa,
    tentarDeNovo,
  };
}
