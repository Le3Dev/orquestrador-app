import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConfiguracaoDoOrquestrador, DadosDaConfiguracao } from "../../../orquestracao/ConfiguracaoDoOrquestrador";
import { Motor } from "../../../orquestracao/Motor";
import { PedidoDeTurno } from "../../../orquestracao/MotorDeAgentes";
import { PastaDeTrabalho } from "../../../orquestracao/PastaDeTrabalho";

/** Só para os testes: pastas temporárias de um pedido (a de trabalho e a de artefatos), já criadas. */
export interface PastasDeTeste {
  raiz: string;
  trabalho: string;
  artefatos: string;
}

export function criarPastasDeTeste(): PastasDeTeste {
  const raiz = mkdtempSync(path.join(tmpdir(), "orq-teste-"));
  const trabalho = path.join(raiz, "trabalho");
  const artefatos = path.join(raiz, "artefatos");
  mkdirSync(trabalho, { recursive: true });
  mkdirSync(artefatos, { recursive: true });
  return { raiz, trabalho, artefatos };
}

export function configuracaoDeTeste(alteracoes: Partial<DadosDaConfiguracao> = {}): ConfiguracaoDoOrquestrador {
  const motorDoOrquestrador = alteracoes.motorDoOrquestrador ?? "copilot";
  const motorDosSubagentes = alteracoes.motorDosSubagentes ?? "copilot";
  return ConfiguracaoDoOrquestrador.de({
    motorDoOrquestrador,
    motorDosSubagentes,
    // O Claude Code usa apelidos de modelo; os outros motores, `padrao` (o modelo do próprio CLI).
    modeloDoOrquestrador: motorDoOrquestrador === "claude-code" ? "opus" : "padrao",
    modeloDosSubagentes: motorDosSubagentes === "claude-code" ? "sonnet" : "padrao",
    quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
    nivelDePermissao: "edicao_e_comandos",
    ...alteracoes,
  });
}

/** Um pedido de turno completo para os testes dos motores; `sobrepor` troca qualquer campo. */
export function pedidoDeTeste(
  pastas: PastasDeTeste,
  motor: Motor = "copilot",
  sobrepor: Partial<PedidoDeTurno> = {},
): PedidoDeTurno {
  return {
    orquestradorId: "orq-1",
    sessaoId: "",
    sessaoIniciada: false,
    motor,
    contextoDaTroca: null,
    texto: "Faça o trabalho.",
    configuracao: configuracaoDeTeste({ motorDoOrquestrador: motor, motorDosSubagentes: motor }),
    modo: "execucao",
    pastaDeTrabalho: PastaDeTrabalho.qualquer(pastas.trabalho),
    anexos: [],
    pastaDosAnexos: null,
    pastaDeArtefatos: pastas.artefatos,
    instrucoes: null,
    revogarInstrucoesAnteriores: false,
    subagentesProntos: [],
    ...sobrepor,
  };
}
