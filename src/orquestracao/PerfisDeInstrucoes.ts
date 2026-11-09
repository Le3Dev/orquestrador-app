import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { normalizarInstrucoes, TAMANHO_MAXIMO_DAS_INSTRUCOES } from "./InstrucoesPersonalizadas";

/** Quantos perfis de instruções as preferências guardam. */
export const MAXIMO_DE_PERFIS_DE_INSTRUCOES = 20;
export const TAMANHO_MAXIMO_DO_NOME_DO_PERFIL = 40;

/**
 * Um texto de instruções guardado com um nome, para preencher as instruções
 * personalizadas de qualquer Orquestrador. Aplicar copia o texto: não há
 * vínculo, e editar o perfil depois não muda quem já o usou.
 */
export interface DadosDoPerfilDeInstrucoes {
  nome: string;
  /** Mesmo limite e normalização das instruções personalizadas, que ele preenche. */
  texto: string;
}

function invalido(mensagem: string): never {
  throw new ErroDeOrquestracao("dados_invalidos", mensagem);
}

function perfilValido(valor: unknown, posicao: number): DadosDoPerfilDeInstrucoes {
  if (typeof valor !== "object" || valor === null) {
    invalido(`O perfil de instruções ${posicao} é inválido.`);
  }
  const dados = valor as Record<string, unknown>;
  if (typeof dados.nome !== "string") {
    invalido(`O nome do perfil de instruções ${posicao} deve ser um texto.`);
  }
  const nome = dados.nome.replace(/\s+/g, " ").trim();
  if (nome === "") {
    invalido(`Dê um nome ao perfil de instruções ${posicao}.`);
  }
  if (nome.length > TAMANHO_MAXIMO_DO_NOME_DO_PERFIL) {
    invalido(`O nome do perfil "${nome}" deve ter até ${TAMANHO_MAXIMO_DO_NOME_DO_PERFIL} caracteres.`);
  }
  if (typeof dados.texto !== "string") {
    invalido(`O texto do perfil "${nome}" deve ser um texto.`);
  }
  const texto = normalizarInstrucoes(dados.texto);
  if (texto === "") {
    invalido(`Preencha o texto do perfil "${nome}".`);
  }
  if (texto.length > TAMANHO_MAXIMO_DAS_INSTRUCOES) {
    invalido(
      `O texto do perfil "${nome}" deve ter até ${TAMANHO_MAXIMO_DAS_INSTRUCOES} caracteres (hoje tem ${texto.length}).`,
    );
  }
  return { nome, texto };
}

/**
 * Valida e normaliza os perfis vindos de fora (tela, arquivo gravado).
 * Ausentes valem lista vazia: arquivos gravados antes deles seguem válidos.
 * Nomes repetidos (sem diferenciar maiúsculas) são recusados: no select
 * ficariam iguais.
 */
export function perfisDeInstrucoesValidos(valor: unknown): DadosDoPerfilDeInstrucoes[] {
  const lista: unknown = valor ?? [];
  if (!Array.isArray(lista)) {
    invalido("Os perfis de instruções devem ser uma lista.");
  }
  if (lista.length > MAXIMO_DE_PERFIS_DE_INSTRUCOES) {
    invalido(`São no máximo ${MAXIMO_DE_PERFIS_DE_INSTRUCOES} perfis de instruções.`);
  }
  const perfis = lista.map((item, indice) => perfilValido(item, indice + 1));
  const chave = (perfil: DadosDoPerfilDeInstrucoes) => perfil.nome.toLocaleLowerCase("pt-BR");
  const repetido = perfis.find((perfil, indice) =>
    perfis.some((outro, anterior) => anterior < indice && chave(outro) === chave(perfil)),
  );
  if (repetido !== undefined) {
    invalido(`Já existe um perfil de instruções chamado "${repetido.nome}".`);
  }
  return perfis;
}
