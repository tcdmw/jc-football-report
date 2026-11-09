# run.ps1 — 本地一套：v4 工具链 + 两轨 Python 模型，一条命令跑完
# 用法:  .\run.ps1            跑全链（默认 batch = data/test/meta_1146_11.json）
#        .\run.ps1 -Batch xxx 指定批次
# 退出码: 0 全部通过 / 3 有检查未通过（详见各步输出）

param(
  [string]$Batch = "data/test/meta_1146_11.json",
  [string]$Preds = "data/out/preds.json"
)

$ErrorLocally = 0
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Host "✗ 未找到 node，无法运行 v4 工具链" -ForegroundColor Red; exit 2 }

$Py = Join-Path (Split-Path -Parent $Root) ".runtime/python/python.exe"
if (-not (Test-Path -LiteralPath $Py)) {
  $c = Get-Command python -ErrorAction SilentlyContinue
  if ($c) { $Py = $c.Source } else { $Py = $null }
}
if (-not $Py) {
  Write-Host "! 未找到 Python，两个 Python 轨将跳过（v4 工具链不受影响）" -ForegroundColor Yellow
}

function Step($name, $exe, $argsArr) {
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  & $exe @argsArr
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Host "  ✗ $name 退出码 $code" -ForegroundColor Yellow
    $script:ErrorLocally = 3
  }
  return $code
}

# 1) 采集解析
Step "collect 解析页面原文" $Node @("tools/collect.mjs", "data/raw", $Batch, "data/out/matches.json") | Out-Null

# 2) 主模型轨（Node）
Step "analyze 双输入建模" $Node @("tools/analyze.mjs", "data/out/matches.json", $Preds) | Out-Null

# 3) 回测结算（注意参数顺序：preds 在前，results 在后）
Step "backtest 自主结算" $Node @("tools/backtest.mjs", $Preds, "data/test/results_1146_11.json") | Out-Null

# 4) 自检
Step "verify 五项校验" $Node @("tools/verify.mjs") | Out-Null

# 5) Python 轨 A：football-engine（独立强度注入）
if ($Py) {
  $env:PYTHONIOENCODING = "utf-8"
  Step "engine 轨建模" $Py @("tools/bridge_engine.py", "data/out/matches.json", "data/out/engine_preds.json") | Out-Null
  # 6) Python 轨 B：football_lottery_prediction（受输入维度限制，容错不阻断）
  Step "lottery 轨建模" $Py @("tools/bridge_lottery.py", "data/out/matches.json", "data/out/lottery_preds.json") | Out-Null
}

Write-Host "`n=== 产物 ===" -ForegroundColor Cyan
Get-ChildItem -LiteralPath "data/out" -File | ForEach-Object { "  {0,8}  {1}" -f $_.Length, $_.Name }

if ($ErrorLocally -ne 0) {
  Write-Host "`n结果: 有步骤未通过（exit 3），不代表跑通；请按上面各步输出定位。" -ForegroundColor Yellow
} else {
  Write-Host "`n结果: 全部步骤 exit 0。" -ForegroundColor Green
}
exit $ErrorLocally
