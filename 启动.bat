@echo off
chcp 65001 >nul
setlocal
title 本地角色聊天工作台 - 启动
cd /d "%~dp0"

echo ============================================
echo   本地角色聊天工作台
echo ============================================
echo.

rem ---- 检查 Node.js / npm ----
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 后再运行本脚本。
    echo       下载地址：https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 npm，请确认 Node.js 安装完整。
    echo.
    pause
    exit /b 1
)

rem ---- 首次运行自动装依赖 ----
if not exist "node_modules" (
    echo 首次运行，正在安装依赖，可能需要几分钟，请耐心等待...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
    echo.
    echo 依赖安装完成。
    echo.
)

echo 正在启动开发服务器...
echo 浏览器会自动打开： http://localhost:5173
echo.
echo 停止服务：关闭本窗口，或双击运行 关闭.bat
echo ============================================
echo.

rem ---- 启动 Vite 开发服务器（阻塞运行）----
call npm run dev

echo.
echo 服务已停止。
pause
