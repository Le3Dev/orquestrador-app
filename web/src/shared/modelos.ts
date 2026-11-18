import type {
  DadosDaConfiguracao,
  EsforcoDeRaciocinio,
  ModeloClaude,
  ModeloDoMotor,
  Motor,
  PreferenciasDoChat,
} from "./api/tipos";

/** Um modelo do Claude como aparece no seletor do chat. */
export interface ModeloNoSeletor {
  modelo: ModeloClaude;
  nome: string;
  /** Versão de referência; a da última resposta prevalece quando é da mesma família. */
  versao: string;
  descricao: string;
}

export const MODELOS_DO_CHAT: readonly ModeloNoSeletor[] = [
  { modelo: "fable", nome: "Fable", versao: "5.2", descricao: "Para seus desafios mais difíceis" },
  { modelo: "opus", nome: "Opus", versao: "5.5", descricao: "Para trabalhos complexos e tarefas do dia a dia" },
  { modelo: "sonnet", nome: "Sonnet", versao: "5.5", descricao: "Mais eficiente para tarefas mais simples" },
  { modelo: "haiku", nome: "Haiku", versao: "5.5", descricao: "Mais rápido para respostas rápidas" },
];

export const ESFORCOS_DO_CHAT: readonly { esforco: EsforcoDeRaciocinio; rotulo: string }[] = [
  { esforco: "padrao", rotulo: "Padrão" },
  { esforco: "baixo", rotulo: "Baixo" },
  { esforco: "medio", rotulo: "Médio" },
  { esforco: "alto", rotulo: "Alto" },
  { esforco: "extra_alto", rotulo: "Extra alto" },
  { esforco: "maximo", rotulo: "Máximo" },
  { esforco: "ultracode", rotulo: "Ultracode" },
];

export const PREFERENCIAS_PADRAO_DO_CHAT: PreferenciasDoChat = {
  modelo: "sonnet",
  esforco: "medio",
  permitirArtefatosOnline: false,
};

/**
 * A configuração com que um Orquestrador nasce — a mesma do formulário de
 * criação (`NoRascunho`) e a usada quando o chat abre um Orquestrador novo.
 */
export const CONFIGURACAO_PADRAO_DO_ORQUESTRADOR: DadosDaConfiguracao = {
  motorDoOrquestrador: "claude-code",
  modeloDoOrquestrador: "sonnet",
  esforcoDoOrquestrador: "medio",
  motorDosSubagentes: "claude-code",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "medio",
  ordemDeReserva: [],
  navegadorDoAgente: false,
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  permitirArtefatosOnline: false,
  instrucoesPersonalizadas: "",
};

/* ---------------- Motores ----------------
 * Cada papel (Orquestrador e Subagentes) roda num motor: o Claude Code (o original e o padrão), o Codex ou o
 * GitHub Copilot CLI. Os modelos, a reserva e o esforço dependem do motor. */

export const MOTORES: readonly Motor[] = ["claude-code", "codex", "copilot"];
export const MOTOR_PADRAO: Motor = "claude-code";

/** O nome do motor como o usuário o conhece. */
export const ROTULOS_DOS_MOTORES: Readonly<Record<Motor, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot CLI",
};

/** O motor numa frase curta: "limite do Claude atingido". */
const NOMES_CURTOS_DOS_MOTORES: Readonly<Record<Motor, string>> = {
  "claude-code": "Claude",
  codex: "Codex",
  copilot: "Copilot",
};

export function ehMotor(valor: unknown): valor is Motor {
  return typeof valor === "string" && (MOTORES as readonly string[]).includes(valor);
}

/** O nome de um motor; um valor que a tela não conhece (servidor mais novo) volta como veio. */
export function rotuloDoMotor(motor: string): string {
  return ehMotor(motor) ? ROTULOS_DOS_MOTORES[motor] : motor;
}

export function nomeCurtoDoMotor(motor: string): string {
  return ehMotor(motor) ? NOMES_CURTOS_DOS_MOTORES[motor] : motor;
}

/** O modelo que o próprio CLI usa quando nenhum é pedido (codex e copilot). */
export const MODELO_PADRAO_DO_CLI = "padrao";
export const ROTULO_DO_MODELO_PADRAO_DO_CLI = "Padrão do CLI";
/** Letras, números e `. _ : -`, de 1 a 64 caracteres: como o servidor confere o id de um modelo. */
export const PADRAO_DO_ID_DE_MODELO = /^[A-Za-z0-9._:-]{1,64}$/;

export type PapelDoModelo = "orquestrador" | "subagentes";

export function ehModeloClaude(modelo: string): modelo is ModeloClaude {
  return MODELOS_DO_CHAT.some((item) => item.modelo === modelo);
}

/**
 * O modelo de um papel quando o motor dele muda e nenhum foi escolhido junto (a mesma regra do servidor): o do
 * próprio CLI nos motores novos; no Claude Code, o de sempre de cada papel (Opus no Orquestrador, Sonnet nos Subagentes).
 */
export function modeloPadraoDoMotor(motor: Motor, papel: PapelDoModelo): ModeloDoMotor {
  if (motor !== "claude-code") {
    return MODELO_PADRAO_DO_CLI;
  }
  return papel === "orquestrador" ? "opus" : "sonnet";
}

/** O modelo serve ao motor? No Claude Code, um apelido conhecido; nos outros, "padrao" ou um id bem formado. */
export function modeloServeAoMotor(motor: Motor, modelo: string): boolean {
  return motor === "claude-code" ? ehModeloClaude(modelo) : PADRAO_DO_ID_DE_MODELO.test(modelo);
}

/**
 * O que impede de salvar ou começar por causa do modelo: nos motores que não são o Claude Code, o modelo precisa ser
 * "padrao" ou um id bem formado (o servidor recusa o resto). Nulo quando está tudo certo.
 */
export function problemaDoModeloDoMotor(configuracao: DadosDaConfiguracao): string | null {
  const papeis: readonly { nome: string; motor: Motor; modelo: string }[] = [
    { nome: "do orquestrador", motor: motorDoOrquestradorDe(configuracao), modelo: configuracao.modeloDoOrquestrador },
    { nome: "dos subagentes", motor: motorDosSubagentesDe(configuracao), modelo: configuracao.modeloDosSubagentes },
  ];
  for (const { nome, motor, modelo } of papeis) {
    if (motor !== "claude-code" && !PADRAO_DO_ID_DE_MODELO.test(modelo)) {
      return modelo.trim() === ""
        ? `Informe o modelo ${nome} (ou escolha o padrão do CLI).`
        : `O modelo ${nome} só aceita letras, números, ponto, hífen, sublinhado e dois-pontos (até 64 caracteres).`;
    }
  }
  return null;
}

/** O modelo como apelido do Claude (para as rotas que só falam Claude); outro modelo cai em `reserva`. */
export function comoModeloClaude(modelo: string, reserva: ModeloClaude): ModeloClaude {
  return ehModeloClaude(modelo) ? modelo : reserva;
}

/** Quanto da configuração diz respeito aos motores: as ausências valem o padrão (Claude Code, sem reserva). */
export function motorDoOrquestradorDe(configuracao: Pick<DadosDaConfiguracao, "motorDoOrquestrador">): Motor {
  return configuracao.motorDoOrquestrador ?? MOTOR_PADRAO;
}

export function motorDosSubagentesDe(configuracao: Pick<DadosDaConfiguracao, "motorDosSubagentes">): Motor {
  return configuracao.motorDosSubagentes ?? MOTOR_PADRAO;
}

export function ordemDeReservaDe(configuracao: Pick<DadosDaConfiguracao, "ordemDeReserva">): readonly Motor[] {
  return configuracao.ordemDeReserva ?? [];
}

/** Os dois papéis no Claude Code: só aí o esforço, o Modo econômico e o aviso do esforço herdado valem. */
export function usaSoOClaudeCode(configuracao: DadosDaConfiguracao): boolean {
  return motorDoOrquestradorDe(configuracao) === "claude-code" && motorDosSubagentesDe(configuracao) === "claude-code";
}

/**
 * Troca o motor de um papel: o modelo volta ao padrão do motor novo (o do motor anterior não serve a ele, como no
 * servidor); o motor que passa a ser o do Orquestrador sai da reserva.
 */
export function comMotorDoPapel(
  configuracao: DadosDaConfiguracao,
  papel: PapelDoModelo,
  motor: Motor,
): DadosDaConfiguracao {
  const atual = papel === "orquestrador" ? motorDoOrquestradorDe(configuracao) : motorDosSubagentesDe(configuracao);
  if (atual === motor) {
    return configuracao;
  }
  if (papel === "subagentes") {
    return {
      ...configuracao,
      motorDosSubagentes: motor,
      modeloDosSubagentes: modeloPadraoDoMotor(motor, "subagentes"),
    };
  }
  return {
    ...configuracao,
    motorDoOrquestrador: motor,
    modeloDoOrquestrador: modeloPadraoDoMotor(motor, "orquestrador"),
    ordemDeReserva: ordemDeReservaDe(configuracao).filter((reserva) => reserva !== motor),
  };
}

/**
 * Aplica uma predefinição (Modo econômico) só na tela, quando não há servidor para fazê-lo: as predefinições falam
 * em modelos do Claude, então os dois papéis voltam ao Claude Code (como o servidor faz) e o motor que perdeu o
 * posto sai da reserva.
 */
export function comPredefinicao(
  configuracao: DadosDaConfiguracao,
  alteracoes: Partial<DadosDaConfiguracao>,
): DadosDaConfiguracao {
  return {
    ...configuracao,
    motorDoOrquestrador: "claude-code",
    motorDosSubagentes: "claude-code",
    ordemDeReserva: ordemDeReservaDe(configuracao).filter((motor) => motor !== "claude-code"),
    ...alteracoes,
  };
}

/**
 * O modelo de um papel como a tela o mostra: "Opus 5.5" no Claude Code; "Padrão do CLI" ou o id nos outros motores.
 */
export function nomeDoModeloDoMotor(motor: Motor, modelo: ModeloDoMotor, modeloUsado: string | null = null): string {
  if (motor === "claude-code") {
    return ehModeloClaude(modelo) ? nomeComVersao(modelo, modeloUsado) : modelo;
  }
  return modelo === MODELO_PADRAO_DO_CLI ? ROTULO_DO_MODELO_PADRAO_DO_CLI : modelo;
}

export function modeloNoSeletor(modelo: ModeloClaude): ModeloNoSeletor {
  return MODELOS_DO_CHAT.find((item) => item.modelo === modelo) ?? MODELOS_DO_CHAT[1]!;
}

export function rotuloDoEsforco(esforco: EsforcoDeRaciocinio): string {
  return ESFORCOS_DO_CHAT.find((item) => item.esforco === esforco)?.rotulo ?? esforco;
}

/**
 * A versão no identificador do modelo, se for da família pedida:
 * "claude-opus-5-5" → "5.5"; "claude-haiku-4-5-20251001" → "4.5";
 * "claude-opus-4-20250514" → "4". Outra família ou formato desconhecido: nulo.
 */
export function versaoDoModeloUsado(modeloUsado: string | null, modelo: ModeloClaude): string | null {
  if (modeloUsado === null) {
    return null;
  }
  const encontrado = new RegExp(`(?:^|-)${modelo}-(\\d+)(?:-(\\d{1,2}))?(?=-|$)`).exec(modeloUsado.toLowerCase());
  if (encontrado === null) {
    return null;
  }
  const [, principal, secundaria] = encontrado;
  return secundaria === undefined ? (principal ?? null) : `${principal}.${secundaria}`;
}

/** Ex.: "Opus 5.5" — com a versão da última resposta, quando é da mesma família. */
export function nomeComVersao(modelo: ModeloClaude, modeloUsado: string | null): string {
  const item = modeloNoSeletor(modelo);
  return `${item.nome} ${versaoDoModeloUsado(modeloUsado, modelo) ?? item.versao}`;
}
