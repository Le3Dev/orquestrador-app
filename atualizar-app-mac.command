#!/bin/zsh -l
# Gera o app do Mac a partir do código desta pasta e instala (ou atualiza) em
# /Applications/Orquestrador de Agentes.app. Dois cliques no Finder.
#
# Não puxa nada do git: rode depois de atualizar o código (git pull / merge).
# O histórico fica em ~/Library/Application Support/Orquestrador de Agentes e
# não é tocado; só o app em /Applications é trocado.
#
# O app não tem assinatura da Apple (só a local, "ad-hoc"). Por isso o script
# tira a marca de quarentena; se o macOS ainda reclamar, abra uma vez com o
# botão direito > Abrir.

cd "${0:A:h}" || exit 1
unset ELECTRON_RUN_AS_NODE

NOME="Orquestrador de Agentes"
GERADO="dist_electron/mac-arm64/$NOME.app"
DESTINO="/Applications/$NOME.app"

falha() {
  echo
  echo "Não foi possível gerar ou instalar o app. Veja as mensagens acima."
  read -k 1 "?Aperte uma tecla para fechar."
  exit 1
}

if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Não achei o Node.js. Instale o Node 22 ou mais novo (https://nodejs.org) e tente de novo."
  falha
fi

echo "Instalando dependências..."
npm install || falha
npm --prefix web install || falha

echo "Gerando o app..."
npm run dist:mac || falha

while pgrep -xq "$NOME"; do
  echo
  read -k 1 "?O app está aberto. Feche o $NOME e aperte uma tecla para continuar."
  echo
done

echo "Instalando em $DESTINO..."
rm -rf "$DESTINO" || falha
ditto "$GERADO" "$DESTINO" || falha
xattr -cr "$DESTINO"

echo "Pronto. Abrindo o app."
open "$DESTINO"
