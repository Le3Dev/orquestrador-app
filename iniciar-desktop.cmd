@echo off
rem Abre o Orquestrador de agentes (aplicativo desktop, via Electron) a partir
rem do codigo-fonte. O proprio app sobe o servidor local, religa se ele cair e
rem carrega a tela dentro da janela. O Orquestrador nao abre no navegador.
rem
rem Na primeira execucao instala as dependencias e gera o build. Depois de
rem atualizar o codigo, apague as pastas dist e web\dist (ou rode npm run build)
rem para gerar o build de novo.
rem
rem Fechar a janela do app desliga o servidor e cancela os pedidos em andamento.
rem O historico fica em %APPDATA%\Orquestrador de Agentes\dados.

setlocal
cd /d "%~dp0"
title Orquestrador de agentes

if not exist "node_modules" (
  echo Primeira execucao: instalando dependencias...
  call npm install || goto falha
)
if not exist "web\node_modules" (
  call npm --prefix web install || goto falha
)
if not exist "dist\root.js" (
  echo Gerando o build...
  call npm run build || goto falha
)
if not exist "web\dist\index.html" (
  call npm run web:build || goto falha
)

rem Abre a janela do app (o electron\main.js cuida de subir o servidor).
call npm run desktop || goto falha
goto :eof

:falha
echo.
echo Nao foi possivel preparar ou abrir o aplicativo. Veja as mensagens acima.
pause
exit /b 1
