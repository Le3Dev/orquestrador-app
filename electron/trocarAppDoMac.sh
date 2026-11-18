#!/bin/bash
# Troca do app do Mac pela versão gerada (electron/atualizacaoDoMac.js).
#
# O app copia este arquivo para a pasta temporária e o roda desacoplado (nohup)
# antes de fechar. Argumentos:
#   $1  pid do app que está fechando (a troca espera ele sair)
#   $2  app instalado, que será trocado (ex.: /Applications/Orquestrador de Agentes.app)
#   $3  app gerado pelo `npm run dist:mac` (dist_electron/mac-arm64/...)
#   $4  backup do app instalado (na pasta temporária, com a data no nome)
#
# Se a cópia do app novo falhar, o backup volta para o lugar e o app antigo
# reabre. ORQUESTRADOR_TROCA_REABRIR=0 troca sem abrir o app depois (a troca
# feita quando o usuário fecha o app). ORQUESTRADOR_TROCA_ABRIR troca o comando
# que reabre o app (só para os testes, que não podem abrir nada de verdade).

PID="$1"
ATUAL="$2"
NOVO="$3"
BACKUP="$4"
ABRIR_COM="${ORQUESTRADOR_TROCA_ABRIR:-open}"
REABRIR="${ORQUESTRADOR_TROCA_REABRIR:-1}"

abrir() {
  if [ "$REABRIR" = "0" ]; then
    echo "O app fechou pelo usuário: não reabre."
    return 0
  fi
  "$ABRIR_COM" "$1"
}

echo "$(date '+%Y-%m-%d %H:%M:%S') troca do app: esperando o pid $PID fechar."

# Até 5 minutos (o servidor leva alguns segundos para desligar).
for _ in $(seq 1 600); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$PID" 2>/dev/null; then
  echo "O app não fechou a tempo; a troca foi cancelada e nada foi alterado."
  exit 1
fi

if [ ! -d "$NOVO" ]; then
  echo "O app gerado não existe em $NOVO; nada foi alterado. Reabrindo o app atual."
  abrir "$ATUAL"
  exit 1
fi

mkdir -p "$(dirname "$BACKUP")"
if ! mv "$ATUAL" "$BACKUP"; then
  echo "Não foi possível mover $ATUAL para o backup; nada foi alterado. Reabrindo o app atual."
  abrir "$ATUAL"
  exit 1
fi

if ditto "$NOVO" "$ATUAL"; then
  xattr -cr "$ATUAL" 2>/dev/null
  echo "App trocado (backup do anterior em $BACKUP). Abrindo a versão nova."
  abrir "$ATUAL"
  exit 0
fi

echo "A cópia do app novo falhou; restaurando o backup e reabrindo o app anterior."
rm -rf "$ATUAL"
mv "$BACKUP" "$ATUAL"
abrir "$ATUAL"
exit 1
