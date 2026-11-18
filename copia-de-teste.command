#!/bin/zsh
# Dois cliques no Finder: abre a cópia de teste do app com o código desta pasta
# (isolada do app instalado). Para fechar: rode este arquivo de novo e responda
# "f", ou use `node scripts/copiaDeTeste.cjs fechar` no terminal.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if node scripts/copiaDeTeste.cjs listar | grep -q "código: $PWD\$"; then
  echo "A cópia desta pasta já está aberta."
  printf "Digite f e Enter para fechar, ou só Enter para sair: "
  read resposta
  if [ "$resposta" = "f" ]; then
    node scripts/copiaDeTeste.cjs fechar
  fi
else
  node scripts/copiaDeTeste.cjs abrir
fi

echo ""
echo "Pode fechar esta janela do Terminal (a cópia continua aberta)."
