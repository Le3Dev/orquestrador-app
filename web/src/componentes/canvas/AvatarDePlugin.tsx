import type { CSSProperties } from "react";

import { iniciaisDe } from "./dadosDoPlugin";
import { IconeSeloOficial } from "./IconesDoMarketplace";

/** As quatro cores do avatar: só tokens do tema, e o laranja fica para as ações. */
const CORES_DO_AVATAR = ["--info", "--success", "--warning", "--claude-cinza-claro"] as const;

/** A mesma cor sempre para o mesmo nome. */
function corDoAvatar(nome: string): string {
  let hash = 0;
  for (const letra of nome) {
    hash = (hash * 31 + letra.charCodeAt(0)) >>> 0;
  }
  return CORES_DO_AVATAR[hash % CORES_DO_AVATAR.length] ?? CORES_DO_AVATAR[0];
}

/** O quadrado com as iniciais do plugin: 40 na lista, 48 no diálogo e 64 no detalhe. */
export function AvatarDePlugin({ nome, tamanho = 40 }: { nome: string; tamanho?: number }) {
  const estilo = { "--c": `var(${corDoAvatar(nome)})`, "--s": `${tamanho}px` } as CSSProperties;
  return (
    <span className="mk-avatar" style={estilo} aria-hidden="true">
      {iniciaisDe(nome)}
    </span>
  );
}

/** O selo de plugin do marketplace oficial da Anthropic. */
export function SeloOficial() {
  return (
    <span className="mk-selo" title="Do marketplace oficial da Anthropic">
      <IconeSeloOficial />
      Oficial
    </span>
  );
}
