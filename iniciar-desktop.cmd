@echo off
rem Abre o Orquestrador de agentes como APP DESKTOP (janela unica, via Electron).
rem O proprio app sobe o servidor local em segundo plano e carrega a tela dentro
rem da janela. Para a versao em navegador, use iniciar-orquestrador.cmd.
rem
rem Fechar a janela do app desliga o servidor e cancela os pedidos em andamento.
rem O historico continua salvo em .\dados.

setlocal
cd /d "%~dp0"
title Orquestrador de agentes (desktop)

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

rem Lanca a janela do Electron (o main.js cuida de subir o servidor).
call npm run desktop
goto :eof

:falha
echo.
echo Nao foi possivel preparar o projeto. Veja as mensagens acima.
pause
exit /b 1
