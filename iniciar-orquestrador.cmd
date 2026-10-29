@echo off
rem Sobe o Orquestrador de agentes numa janela propria, fora das sessoes do
rem Claude Code: la, um servidor em segundo plano pode ser encerrado quando a
rem memoria do computador fica baixa.
rem
rem Fechar esta janela (ou Ctrl+C) desliga o servidor e cancela os pedidos em
rem andamento. O historico continua salvo em .\dados.

setlocal
cd /d "%~dp0"
title Orquestrador de agentes - http://localhost:3200

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

rem Abre o navegador alguns segundos depois, quando o servidor ja estiver no ar.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3200"

rem O vigia sobe o servidor e o religa sozinho se ele cair por erro.
node scripts\manter-no-ar.cjs
echo.
echo O servidor foi encerrado.
pause
goto :eof

:falha
echo.
echo Nao foi possivel preparar o projeto. Veja as mensagens acima.
pause
exit /b 1
