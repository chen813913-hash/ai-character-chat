@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 本地角色聊天工作台 - 关闭
cd /d "%~dp0"

echo ============================================
echo   正在停止本地角色聊天工作台
echo ============================================
echo.

set FOUND=0

rem ---- 按端口结束占用进程（5173 = dev，4173 = preview，含备用端口）----
for %%P in (5173 5174 5175 4173) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
        echo 发现端口 %%P 被进程 PID %%a 占用，正在结束...
        taskkill /PID %%a /F >nul 2>nul
        if not errorlevel 1 (
            echo   已结束 PID %%a
            set FOUND=1
        )
    )
)

echo.
if "!FOUND!"=="0" (
    echo 未发现运行中的服务，无需关闭。
) else (
    echo 服务已全部停止。
)

echo.
echo 提示：若浏览器页面还开着，直接关闭标签页即可。
echo ============================================
echo.
pause
