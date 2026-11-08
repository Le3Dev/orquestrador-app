/**
 * Nome para um Orquestrador novo que não repete nenhum dos existentes (sem
 * diferenciar maiúsculas): o próprio nome do projeto, se livre; senão
 * "<projeto> 2", "<projeto> 3"… (o primeiro número livre).
 */
export function nomeLivre(projeto: string, nomesExistentes: readonly string[]): string {
  const chave = (nome: string) => nome.trim().toLowerCase();
  const usados = new Set(nomesExistentes.map(chave));
  if (!usados.has(chave(projeto))) {
    return projeto;
  }
  let numero = 2;
  while (usados.has(chave(`${projeto} ${numero}`))) {
    numero += 1;
  }
  return `${projeto} ${numero}`;
}
