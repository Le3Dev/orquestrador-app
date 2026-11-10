import { memo } from "react";

import { HoraDaMensagem } from "./HoraDaMensagem";

export interface PropsDoBalaoOuvido {
  /** O id do enunciado: o mesmo enquanto ele está aberto e depois de fechado. */
  readonly id: string;
  /** O texto confirmado do enunciado (o enunciado inteiro, quando fechado). */
  readonly texto: string;
  /** A cauda ainda não confirmada, mostrada em cinza no fim; só no enunciado aberto. */
  readonly parcial?: string;
  readonly inicioMs: number;
  /** O fim do enunciado; sem ele (aberto), a hora é a do início. */
  readonly fimMs?: number;
  readonly pergunta: boolean;
  /** Ainda sendo dito: a marca "ouvindo" e a borda tracejada. */
  readonly aberto: boolean;
}

/**
 * Um enunciado ouvido pela escuta, como uma mensagem sua na conversa. É o mesmo
 * balão enquanto o enunciado está aberto e depois de fechado: com a mesma chave
 * (o id do enunciado), o React mantém o elemento e o texto só cresce no lugar.
 * Aberto, a marca é "ouvindo", a borda tracejada e a cauda parcial em cinza;
 * fechado, a marca é "ouvido" e, na pergunta detectada, também "pergunta".
 */
export const BalaoOuvido = memo(function BalaoOuvido({
  id,
  texto,
  parcial = "",
  inicioMs,
  fimMs,
  pergunta,
  aberto,
}: PropsDoBalaoOuvido) {
  const confirmado = texto.trim();
  const cauda = aberto ? parcial.trim() : "";
  const momentoMs = fimMs ?? inicioMs;
  return (
    <div
      className={`mensagem-do-usuario mensagem-ouvida${aberto ? " mensagem-ouvida-provisoria" : ""}`}
      data-testid={aberto ? "trecho-provisorio" : "trecho-ouvido"}
      data-enunciado={id}
      aria-live={aberto ? "polite" : undefined}
    >
      <p className="texto-longo">
        {confirmado !== "" && <span className="ouvido-confirmado">{confirmado}</span>}
        {confirmado !== "" && cauda !== "" && " "}
        {cauda !== "" && <span className="ouvido-parcial">{cauda}</span>}
      </p>
      <span className="marcas-da-mensagem-ouvida">
        <span
          className="marca-ouvida"
          title={aberto ? "Frase sendo ouvida agora pela escuta do áudio" : "Frase ouvida pela escuta do áudio"}
        >
          {aberto ? "ouvindo" : "ouvido"}
        </span>
        {pergunta && (
          <span className="marca-da-pergunta-ouvida" role="img" aria-label="Pergunta detectada na escuta">
            pergunta
          </span>
        )}
      </span>
      {Number.isFinite(momentoMs) && <HoraDaMensagem criadaEm={new Date(momentoMs).toISOString()} />}
    </div>
  );
});
