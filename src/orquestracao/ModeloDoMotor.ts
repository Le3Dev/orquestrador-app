import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ehModeloClaude, ModeloClaude } from "./ModeloClaude";
import { Motor, rotuloDoMotor } from "./Motor";

/**
 * O modelo de um papel (Orquestrador ou Subagentes), validado pelo motor do
 * papel. Objeto de valor: é só o texto, imutável, e quem o cria é
 * `modeloDoMotorValido`, que confere se ele serve ao motor.
 *
 * - `claude-code`: um apelido de `ModeloClaude` (fable, opus, sonnet, haiku).
 * - `codex` e `copilot`: `MODELO_PADRAO_DO_CLI` (o modelo que o próprio CLI já
 *   tem configurado) ou o id de um modelo, repassado ao CLI como veio.
 */
export type ModeloDoMotor = string;

/** O modelo que o próprio CLI do motor usa quando nenhum é pedido. */
export const MODELO_PADRAO_DO_CLI = "padrao";

/** Letras, números e `. _ : -`, de 1 a 64 caracteres: seguro para ir como argumento do CLI. */
const ID_DE_MODELO = /^[A-Za-z0-9._:-]{1,64}$/;

/** Qual papel recebe o modelo: muda só o padrão do Claude Code, que tem um modelo por papel. */
export type PapelDoModelo = "orquestrador" | "subagentes";

export function ehModeloDoMotor(motor: Motor, valor: unknown): valor is ModeloDoMotor {
  if (motor === "claude-code") {
    return ehModeloClaude(valor);
  }
  return typeof valor === "string" && ID_DE_MODELO.test(valor);
}

/**
 * O modelo, se serve ao motor; senão `dados_invalidos` com a mensagem para o
 * usuário. No Claude Code a mensagem é a de sempre.
 */
export function modeloDoMotorValido(motor: Motor, valor: unknown): ModeloDoMotor {
  if (!ehModeloDoMotor(motor, valor)) {
    throw new ErroDeOrquestracao(
      "dados_invalidos",
      motor === "claude-code"
        ? "Modelo inválido. Use opus, sonnet ou haiku."
        : `Modelo inválido para o ${rotuloDoMotor(motor)}. Use "${MODELO_PADRAO_DO_CLI}" ou o id de um modelo ` +
            "(letras, números, ponto, hífen, sublinhado e dois-pontos, até 64 caracteres).",
    );
  }
  return valor;
}

/**
 * O modelo de um papel quando o motor dele muda e nenhum modelo foi escolhido
 * junto: o do próprio CLI nos motores novos; no Claude Code, o de sempre de
 * cada papel (Opus para o Orquestrador, Sonnet para os Subagentes).
 */
export function modeloPadraoDoMotor(motor: Motor, papel: PapelDoModelo): ModeloDoMotor {
  if (motor !== "claude-code") {
    return MODELO_PADRAO_DO_CLI;
  }
  return papel === "orquestrador" ? "opus" : "sonnet";
}

/**
 * O modelo como apelido do Claude Code, para quem monta os argumentos do
 * `claude`. Um modelo que não é do Claude (o papel está em outro motor) cai em
 * `reserva`: nunca vai um id estranho para o `--model` do Claude Code.
 */
export function comoModeloClaude(modelo: ModeloDoMotor, reserva: ModeloClaude = "sonnet"): ModeloClaude {
  return ehModeloClaude(modelo) ? modelo : reserva;
}
