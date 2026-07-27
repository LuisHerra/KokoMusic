@echo off
title KokoMusic Desktop Launcher
cd /d "%~dp0"
npx --prefix desktop electron desktop/main.js
