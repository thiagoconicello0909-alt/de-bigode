@echo off
title TRPC Checker
chcp 65001 >nul

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

node checker.js
pause