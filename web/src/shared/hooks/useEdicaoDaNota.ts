import { useCallback, useEffect, useRef, useState } from "react";

import { type AlteracaoDaNota, api, mensagemDeErro } from "../api/cliente";
import type { DadosDaNota } from "../api/tipos";

/** Espera depois da última tecla para salvar a nota. */
export const ESPERA_PARA_SALVAR_A_NOTA_MS = 600;

/**
 * "pendente": mudou e o salvamento está agendado; "salvando": a requisição
 * está no ar; "erro": a última tentativa falhou e a mudança está só na tela.
 */
export type SituacaoDoSalvamento = "salvo" | "pendente" | "salvando" | "erro";

interface ConteudoDaNota {
  titulo: string;
  texto: string;
}

/** O que mudou da versão do servidor para a da tela; nulo quando nada mudou. */
function alteracaoEntre(naTela: ConteudoDaNota, noServidor: ConteudoDaNota): AlteracaoDaNota | null {
  const alteracao: AlteracaoDaNota = {};
  if (naTela.titulo !== noServidor.titulo) {
    alteracao.titulo = naTela.titulo;
  }
  if (naTela.texto !== noServidor.texto) {
    alteracao.texto = naTela.texto;
  }
  return alteracao.titulo === undefined && alteracao.texto === undefined ? null : alteracao;
}

export interface EdicaoDaNota {
  titulo: string;
  texto: string;
  situacao: SituacaoDoSalvamento;
  /** Mensagem da última falha ao salvar; nula depois de um salvamento que deu certo. */
  erro: string | null;
  mudarTexto: (texto: string) => void;
  /**
   * Troca o título e salva na hora. Em branco não vale (o servidor exige de 1
   * a 120 caracteres): devolve falso e o título continua o de antes.
   */
  renomear: (titulo: string) => boolean;
  /** Salva já o que estiver pendente: ao perder o foco ou em "tentar de novo". */
  salvarAgora: () => void;
  /** Esquece o salvamento agendado: a nota foi apagada. */
  descartarPendencias: () => void;
}

/**
 * A edição de uma nota, com salvamento automático.
 *
 * O texto em edição fica no estado do próprio nó: digitar re-renderiza só a
 * nota, e o servidor recebe o conteúdo um instante depois da última tecla
 * (ou ao perder o foco), num único PATCH com o que mudou. Uma requisição por
 * vez: o que mudar enquanto uma está no ar vai na seguinte.
 */
export function useEdicaoDaNota(inicial: DadosDaNota, aoSalvar: (nota: DadosDaNota) => void): EdicaoDaNota {
  const notaId = inicial.id;
  const [titulo, setTitulo] = useState(inicial.titulo);
  const [texto, setTexto] = useState(inicial.texto);
  const [situacao, setSituacao] = useState<SituacaoDoSalvamento>("salvo");
  const [erro, setErro] = useState<string | null>(null);
  // Os salvamentos leem daqui, e não do estado: a espera e a resposta do
  // servidor terminam fora da renderização.
  const naTela = useRef<ConteudoDaNota>({ titulo: inicial.titulo, texto: inicial.texto });
  const noServidor = useRef<ConteudoDaNota>({ titulo: inicial.titulo, texto: inicial.texto });
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const salvando = useRef(false);
  const salvarDeNovo = useRef(false);
  const avisarSalvo = useRef(aoSalvar);

  useEffect(() => {
    avisarSalvo.current = aoSalvar;
  }, [aoSalvar]);

  const cancelarEspera = useCallback(() => {
    if (espera.current !== null) {
      clearTimeout(espera.current);
      espera.current = null;
    }
  }, []);

  const salvar = useCallback(async (): Promise<void> => {
    cancelarEspera();
    if (salvando.current) {
      salvarDeNovo.current = true;
      return;
    }
    salvando.current = true;
    try {
      for (;;) {
        salvarDeNovo.current = false;
        const alteracao = alteracaoEntre(naTela.current, noServidor.current);
        if (alteracao === null) {
          setSituacao("salvo");
          setErro(null);
          return;
        }
        setSituacao("salvando");
        const nota = await api.alterarNota(notaId, alteracao);
        // A base passa a ser o que foi enviado, e não a resposta: se o
        // servidor ajustar algo (espaços, por exemplo), a nota não fica
        // "pendente" para sempre.
        noServidor.current = { ...noServidor.current, ...alteracao };
        avisarSalvo.current(nota);
        setErro(null);
        if (!salvarDeNovo.current) {
          // Se mudou durante a requisição, o próximo salvamento já está agendado.
          setSituacao(alteracaoEntre(naTela.current, noServidor.current) === null ? "salvo" : "pendente");
          return;
        }
      }
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setSituacao("erro");
    } finally {
      salvando.current = false;
    }
  }, [cancelarEspera, notaId]);

  const salvarSePendente = useCallback(() => {
    if (espera.current !== null) {
      void salvar();
    }
  }, [salvar]);

  // Desmontar com um salvamento agendado (a nota sumiu do canvas) não perde o texto.
  useEffect(() => salvarSePendente, [salvarSePendente]);

  const mudarTexto = useCallback(
    (novo: string) => {
      naTela.current = { ...naTela.current, texto: novo };
      setTexto(novo);
      setSituacao("pendente");
      cancelarEspera();
      espera.current = setTimeout(() => {
        espera.current = null;
        void salvar();
      }, ESPERA_PARA_SALVAR_A_NOTA_MS);
    },
    [cancelarEspera, salvar],
  );

  const renomear = useCallback(
    (novo: string): boolean => {
      const limpo = novo.trim();
      if (limpo === "") {
        return false;
      }
      naTela.current = { ...naTela.current, titulo: limpo };
      setTitulo(limpo);
      void salvar();
      return true;
    },
    [salvar],
  );

  const salvarAgora = useCallback(() => void salvar(), [salvar]);

  return { titulo, texto, situacao, erro, mudarTexto, renomear, salvarAgora, descartarPendencias: cancelarEspera };
}
