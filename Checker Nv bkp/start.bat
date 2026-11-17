@echo off
title TRPC Checker
chcp 65001 >nul
cd /d "%~dp0"

node --version >nul 2>&1 || (echo [ERRO] Instale Node.js & pause & exit /b 1)
python --version >nul 2>&1 || (echo [ERRO] Instale Python & pause & exit /b 1)

python -c "import tls_client" >nul 2>&1 || (
    echo [INFO] Instalando tls-client...
    python -m pip install tls-client
)

if not exist "node_modules\" (
    echo [INFO] Instalando dependencias...
    call npm install || (echo [ERRO] npm install falhou & pause & exit /b 1)
)

set "CASA=79"
set /p CASA=Casa [79]: 

for %%N in (1 2 3) do (
    if not exist "contas_%%N.txt" (
        echo [ERRO] contas_%%N.txt nao existe
        pause
        exit /b 1
    )
)

echo.
echo  casa %CASA% ^| 3 shards
echo.

start "SHARD 1 - casa %CASA%" cmd /k "node rodar.js %CASA% contas_1.txt"

echo  aguardando TLSProxy...
set /a T=0
:espera
timeout /t 3 >nul
set /a T+=1
curl.exe -s -m 2 http://127.0.0.1:3334/health >nul 2>&1 && goto segue
if %T% lss 40 goto espera
echo  [AVISO] proxy nao respondeu em 120s, seguindo assim mesmo
:segue

start "SHARD 2 - casa %CASA%" cmd /k "node rodar.js %CASA% contas_2.txt"
start "SHARD 3 - casa %CASA%" cmd /k "node rodar.js %CASA% contas_3.txt"

echo.
echo  tres shards no ar. Pode fechar esta janela.
timeout /t 5 >nul