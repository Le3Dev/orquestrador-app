import type { DadosDaConfiguracao, EsforcoDeRaciocinio, ModeloDoMotor, Motor } from "./api/tipos";
import { ROTULOS_DAS_PERMISSOES, ROTULOS_DOS_MODELOS, rotuloDoEsforcoNaCriacao } from "./formatacao";
import {
  ehModeloClaude,
  MODELO_PADRAO_DO_CLI,
  motorDoOrquestradorDe,
  motorDosSubagentesDe,
  ordemDeReservaDe,
  rotuloDoMotor,
} from "./modelos";

/** O nome do modelo do Claude sem versão; um modelo fora da lista volta como veio. */
function nomeDoModeloClaude(modelo: ModeloDoMotor): string {
  return ehModeloClaude(modelo) ? ROTULOS_DOS_MODELOS[modelo].nome : modelo;
}

/** Ex.: "Opus (esforço automático)". */
export function modeloComEsforco(modelo: ModeloDoMotor, esforco: EsforcoDeRaciocinio): string {
  return `${nomeDoModeloClaude(modelo)} (esforço ${rotuloDoEsforcoNaCriacao(esforco).toLowerCase()})`;
}

/**
 * Fora do Claude Code, o motor no lugar do modelo ("Codex", ou "Codex (gpt-5)" com um modelo escolhido): o
 * esforço não vale nos outros motores, então não entra.
 */
function motorComModelo(motor: Motor, modelo: ModeloDoMotor): string {
  return modelo === MODELO_PADRAO_DO_CLI ? rotuloDoMotor(motor) : `${rotuloDoMotor(motor)} (${modelo})`;
}

/**
 * A configuração numa frase, para o rodapé da criação e da ⚙ do terminal.
 * Ex.: "Somente leitura, Opus (esforço automático) com até 3 subagentes Opus."
 * Com um motor que não é o Claude Code, ele aparece no lugar do modelo ("Somente leitura, Codex com até 3
 * subagentes Codex."); com motores de reserva, termina com " Reserva: Codex, GitHub Copilot CLI."
 * Com a publicação de artefatos online ligada, termina com " Artefatos online ligados."; com o navegador do
 * agente, " Navegador do agente ligado."
 */
export function resumoDaConfiguracao(configuracao: DadosDaConfiguracao): string {
  const { quantidadeDeSubagentes: quantidade } = configuracao;
  const contagem = quantidade.modo === "automatica" ? `até ${quantidade.limite}` : `sempre ${quantidade.limite}`;
  const subagentes = quantidade.limite === 1 ? "subagente" : "subagentes";
  const motorDoOrquestrador = motorDoOrquestradorDe(configuracao);
  const motorDosSubagentes = motorDosSubagentesDe(configuracao);
  const doOrquestrador =
    motorDoOrquestrador === "claude-code"
      ? modeloComEsforco(configuracao.modeloDoOrquestrador, configuracao.esforcoDoOrquestrador)
      : motorComModelo(motorDoOrquestrador, configuracao.modeloDoOrquestrador);
  const dosSubagentes =
    motorDosSubagentes !== "claude-code"
      ? motorComModelo(motorDosSubagentes, configuracao.modeloDosSubagentes)
      : configuracao.esforcoDosSubagentes === "padrao"
        ? nomeDoModeloClaude(configuracao.modeloDosSubagentes)
        : modeloComEsforco(configuracao.modeloDosSubagentes, configuracao.esforcoDosSubagentes);
  const reserva = ordemDeReservaDe(configuracao);
  return (
    `${ROTULOS_DAS_PERMISSOES[configuracao.nivelDePermissao].nome}, ` +
    `${doOrquestrador} ` +
    `com ${contagem} ${subagentes} ${dosSubagentes}.` +
    (reserva.length > 0 ? ` Reserva: ${reserva.map(rotuloDoMotor).join(", ")}.` : "") +
    (configuracao.permitirArtefatosOnline ? " Artefatos online ligados." : "") +
    (configuracao.navegadorDoAgente === true ? " Navegador do agente ligado." : "")
  );
}
