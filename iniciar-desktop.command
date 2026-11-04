#!/bin/zsh -l
# Abre o Orquestrador de agentes como APP DESKTOP no macOS (dois cliques no
# Finder). É o par do iniciar-desktop.cmd do Windows. O próprio app sobe o
# servidor local; se já houver um no ar (a versão no navegador), usa esse.
#
# Rodando pelo código, o app abre sem pedir licença
# (ORQUESTRADOR_SEM_LICENCA=1; o app empacotado continua pedindo a chave).
# Fechar esta janela do Terminal fecha o app. O histórico fica em ./dados.

cd "${0:A:h}" || exit 1

# Herdada de um terminal do VS Code, faria o Electron rodar como Node puro.
unset ELECTRON_RUN_AS_NODE

falha() {
  echo
  echo "Não foi possível preparar o projeto. Veja as mensagens acima."
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

if [ ! -d node_modules ]; then
  echo "Primeira execução: instalando dependências..."
  npm install || falha
fi
if [ ! -d web/node_modules ]; then
  npm --prefix web install || falha
fi

# Refaz o build só do que mudou desde a última vez.
if [ ! -f dist/root.js ] || [ -n "$(find src -newer dist/root.js -print -quit)" ]; then
  echo "Gerando o build do servidor..."
  npx tsc -p tsconfig.build.json || falha
fi
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/index.html -newer web/dist/index.html -print -quit)" ]; then
  echo "Gerando o build da tela..."
  npm run web:build || falha
fi

ORQUESTRADOR_SEM_LICENCA="${ORQUESTRADOR_SEM_LICENCA:-1}" npm run desktop
