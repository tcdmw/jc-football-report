@echo off
rem py.cmd - prefer the project-local embedded Python, fallback to PATH python
setlocal
set "PY=%~dp0..\..\.runtime\python\python.exe"
if exist "%PY%" (
  "%PY%" %*
) else (
  python %*
)
