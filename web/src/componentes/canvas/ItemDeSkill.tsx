import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { acharNoTexto, linhaCurta } from "./dadosDoPlugin";
import { IconeSetaDireita } from "./IconesDasIlhas";
import { IconeConfirmar, IconeCopiar } from "./IconesDoMarketplace";

/** Quanto tempo o botão diz "Copiado" antes de voltar a "Copiar". */
const DURACAO_DO_COPIADO_MS = 1500;

/** Quantos caracteres antes da palavra achada o resumo mostra, para a palavra caber na linha. */
const MARGEM_DO_TRECHO = 24;

interface Props {
  /** O nome sem o prefixo do plugin: é o que aparece na linha. */
  nome: string;
  /** O nome como o Claude Code o chama (`plugin:nome`): aparece só na linha aberta, com o botão Copiar. */
  nomeCompleto: string;
  descricao: string;
  /** De onde a skill vem, em uma frase ("Da sua conta Claude, só leitura"). */
  origem: string;
  /** O que está no campo de busca: a palavra achada ganha destaque. */
  termo?: string;
}

/** O texto com a palavra achada em destaque (sem laranja: o laranja é só ação e foco). */
function comDestaque(texto: string, termo: string, margem?: number): ReactNode {
  const trecho = termo === "" ? null : acharNoTexto(texto, termo, margem);
  if (trecho === null) {
    return texto;
  }
  return (
    <>
      {trecho.antes}
      <mark className="mk-achado">{trecho.achado}</mark>
      {trecho.depois}
    </>
  );
}

/**
 * Uma skill numa linha: o nome amigável e uma linha da descrição, em inglês como vem. Clicar (ou Enter, ou
 * Espaço) abre a descrição inteira, o nome completo com "Copiar" e a origem. Com a busca, se a palavra só casou
 * na descrição, a linha mostra o trecho em volta dela. Usada na lista de Instaladas e dentro do plugin aberto.
 */
export function ItemDeSkill({ nome, nomeCompleto, descricao, origem, termo = "" }: Props) {
  const id = useId();
  const [aberta, setAberta] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  const descricaoLimpa = descricao.replace(/\s+/g, " ").trim();
  const semDescricao = descricaoLimpa === "";
  const casouNoNome = acharNoTexto(nome, termo) !== null;
  const resumo = semDescricao
    ? "Sem descrição."
    : !casouNoNome && acharNoTexto(descricaoLimpa, termo, MARGEM_DO_TRECHO) !== null
      ? comDestaque(descricaoLimpa, termo, MARGEM_DO_TRECHO)
      : linhaCurta(nome, descricao);

  const copiar = () => {
    // Sem permissão para a área de transferência, o botão só não confirma: o nome continua à vista para copiar à mão.
    navigator.clipboard?.writeText(nomeCompleto).then(
      () => {
        setCopiado(true);
        clearTimeout(temporizador.current);
        temporizador.current = setTimeout(() => setCopiado(false), DURACAO_DO_COPIADO_MS);
      },
      () => undefined,
    );
  };

  return (
    <li className="mk-skill-linha" data-aberta={aberta}>
      <button
        type="button"
        id={`${id}-botao`}
        className="mk-skill-botao"
        aria-expanded={aberta}
        aria-controls={aberta ? `${id}-corpo` : undefined}
        onClick={() => setAberta((atual) => !atual)}
      >
        <span className="mk-skill-nome" title={nomeCompleto}>
          {comDestaque(nome, termo)}
        </span>
        <span className="mk-skill-resumo">{resumo}</span>
        <IconeSetaDireita tamanho={14} className="mk-chev" />
      </button>
      {aberta && (
        <div id={`${id}-corpo`} className="mk-skill-corpo" role="region" aria-labelledby={`${id}-botao`}>
          {!semDescricao && <p className="mk-skill-texto">{comDestaque(descricaoLimpa, termo)}</p>}
          <dl className="mk-skill-ficha">
            <dt>Nome completo</dt>
            <dd>
              <span className="mono">{nomeCompleto}</span>
              <button type="button" className="btn btn-ghost mk-copiar" onClick={copiar}>
                {copiado ? <IconeConfirmar tamanho={13} /> : <IconeCopiar tamanho={13} />}
                {copiado ? "Copiado" : "Copiar"}
              </button>
              <span className="sr-only" role="status">
                {copiado ? "Nome copiado" : ""}
              </span>
            </dd>
            <dt>Origem</dt>
            <dd>{origem}</dd>
          </dl>
        </div>
      )}
    </li>
  );
}
