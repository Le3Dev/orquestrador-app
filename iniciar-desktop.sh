#!/usr/bin/env bash
# Abre o Orquestrador de agentes como APP DESKTOP no Linux (no terminal:
# ./iniciar-desktop.sh). É o par do iniciar-desktop.command do Mac e do
# iniciar-desktop.cmd do Windows. O próprio app sobe o servidor local dentro
# dele, religa se cair e carrega a tela na janela. O Orquestrador não abre no
# navegador.
#
# Na primeira execução instala as dependências e gera o build; depois refaz o
# build só do que mudou. Rodando pelo código, o app abre sem pedir licença.
# Fechar este terminal fecha o app. O histórico fica em
# ~/.config/Orquestrador de Agentes/dados (ou $XDG_CONFIG_HOME, se definido).

cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" || exit 1

# Herdada de um terminal do VS Code, faria o Electron rodar como Node puro.
unset ELECTRON_RUN_AS_NODE

falha() {
  echo
  echo "Não foi possível preparar ou abrir o aplicativo. Veja as mensagens acima."
  read -r -n 1 -p "Aperte uma tecla para fechar."
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

# Abre a janela do app (o electron/main.js cuida de subir o servidor).
npm run desktop || falha
