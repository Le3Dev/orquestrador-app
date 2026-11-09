import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type AlteracaoDaNota, api, mensagemDeErro } from "../api/cliente";
import type { DadosDaNota } from "../api/tipos";
import { type Ponto, posicaoParaNovoTerminal, TAMANHO_DA_NOTA } from "../canvas/layout";
import { ehNota, minimizarOuRestaurar, type NoDoCanvas, novaNota, sincronizarNotas } from "../canvas/nos";
import { type AcoesDasNotas, criarLojaDasNotas, type ValorDasNotas } from "../canvas/notas";

export interface NotasDoCanvas {
  /** Para o `ProvedorDasNotas`. Estável: nunca re-renderiza as notas. */
  valor: ValorDasNotas;
  /**
   * "+ notas": cria a nota no servidor e a abre no centro da tela, com o foco
   * no texto. Com `dados`, ela já nasce com título e texto; com `posicao` (no
   * canvas), abre ali, e não no centro.
   */
  criarNota: (dados?: AlteracaoDaNota, posicao?: Ponto) => Promise<void>;
  /**
   * Põe no canvas uma nota que já foi criada no servidor, no lugar e no
   * tamanho dados, sem foco e sem mexer na seleção (é como um modelo de
   * canvas recria as notas dele). Devolve o id do nó.
   */
  mostrarNota: (nota: DadosDaNota, posicao: Ponto, tamanho?: { largura: number; altura: number }) => string;
  /** Por que a última nota não pôde ser criada. */
  erro: string | null;
  descartarErro: () => void;
}

/**
 * As notas do canvas: carrega a lista do servidor ao abrir (e tenta de novo
 * quando ele volta, se falhou), cria, minimiza e tira do canvas as apagadas.
 *
 * O conteúdo vai para a loja das notas, não para o estado do canvas: só o
 * que é de layout (posição, tamanho, minimizada) fica nos nós.
 */
export function useNotas(
  setNos: Dispatch<SetStateAction<NoDoCanvas[]>>,
  centroDaTela: () => Ponto,
  conectado: boolean,
): NotasDoCanvas {
  const [loja] = useState(criarLojaDasNotas);
  const [carregadas, setCarregadas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Criadas nesta sessão: uma lista que saiu antes da criação não pode tirá-las do canvas ao voltar.
  const criadasAgora = useRef(new Set<string>());

  useEffect(() => {
    if (carregadas || !conectado) {
      return;
    }
    let ativo = true;
    api
      .listarNotas()
      .then((lista) => {
        if (!ativo) {
          return;
        }
        loja.carregar(lista);
        // As que não existem mais saem do canvas (e do layout); as que não têm layout ganham posição no centro.
        setNos((atuais) =>
          sincronizarNotas(
            atuais,
            lista.map((nota) => nota.id),
            criadasAgora.current,
            (ocupadas) => posicaoParaNovoTerminal(centroDaTela(), TAMANHO_DA_NOTA, ocupadas),
          ),
        );
        setCarregadas(true);
      })
      .catch((falha: unknown) => {
        if (ativo) {
          loja.falhouAoCarregar(mensagemDeErro(falha));
        }
      });
    return () => {
      ativo = false;
    };
  }, [carregadas, conectado, loja, setNos, centroDaTela]);

  const criarNota = useCallback(async (dados?: AlteracaoDaNota, posicao?: Ponto): Promise<void> => {
    setErro(null);
    try {
      const nota = await api.criarNota(dados);
      criadasAgora.current.add(nota.id);
      loja.guardar(nota);
      loja.pedirFoco(nota.id);
      setNos((atuais) => {
        const onde =
          posicao ??
          posicaoParaNovoTerminal(
            centroDaTela(),
            TAMANHO_DA_NOTA,
            atuais.filter(ehNota).map((no) => no.position),
          );
        // Só os selecionados mudam: os outros nós continuam o mesmo objeto e não re-renderizam.
        const anteriores = atuais.map((no) => (no.selected === true ? { ...no, selected: false } : no));
        return [...anteriores, { ...novaNota(nota.id, onde), selected: true }];
      });
    } catch (falha) {
      setErro(`Não foi possível criar a nota: ${mensagemDeErro(falha)}`);
    }
  }, [centroDaTela, loja, setNos]);

  const mostrarNota = useCallback(
    (nota: DadosDaNota, posicao: Ponto, tamanho?: { largura: number; altura: number }): string => {
      criadasAgora.current.add(nota.id);
      loja.guardar(nota);
      const no = novaNota(nota.id, posicao, tamanho?.largura, tamanho?.altura);
      setNos((atuais) => [...atuais, no]);
      return no.id;
    },
    [loja, setNos],
  );

  const acoes = useMemo<AcoesDasNotas>(
    () => ({
      minimizarOuRestaurar: (notaId) =>
        setNos((atuais) =>
          atuais.map((no) => (ehNota(no) && no.data.notaId === notaId ? minimizarOuRestaurar(no) : no)),
        ),
      notaApagada: (notaId) => {
        criadasAgora.current.delete(notaId);
        setNos((atuais) => atuais.filter((no) => !ehNota(no) || no.data.notaId !== notaId));
        loja.esquecer(notaId);
      },
    }),
    [loja, setNos],
  );

  const valor = useMemo<ValorDasNotas>(() => ({ loja, acoes }), [loja, acoes]);
  const descartarErro = useCallback(() => setErro(null), []);

  return { valor, criarNota, mostrarNota, erro, descartarErro };
}
