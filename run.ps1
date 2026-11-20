# run.ps1 — 本地一套：v4 工具链 + 两轨 Python 模型，一条命令跑完
# 用法:  .\run.ps1                         跑全链（默认 batch = data/test/meta_1146_11.json）
#        .\run.ps1 -Batch xxx              指定批次 meta
#        .\run.ps1 -Batch xxx -BatchNo 57  显式指定批次号（伤停审计文件用）
#        .\run.ps1 -Batch xxx -RawDir raw56 显式指定 raw 目录（映射与伤停用）
# 链路: collect → dqd 映射/情报 → dqd 伤停 → analyze → backtest → verify → 双 Python 轨
# 退出码: 0 全部通过 / 3 有检查未通过（详见各步输出）

param(
  [string]$Batch = "data/test/meta_1146_11.json",
  [string]$Preds = "data/out/preds.json",
  [string]$BatchNo = "",
  [string]$RawDir = ""
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

# --- 定位本批 raw 目录（映射与伤停都要用）---
$rd = $RawDir
if (-not $rd) {
  # 本批 raw 目录 = data 下最近被写入的 rawNN（collect.mjs 的 source 只写父目录，靠不住）
  $latest = Get-ChildItem -LiteralPath "data" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^raw\d+$' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) { $rd = $latest.Name }
}
$mn = $BatchNo
if (-not $mn -and $rd -and ($rd -match '^raw(\d+)$')) { $mn = [string]([int]$Matches[1] + 1) }

# 1.2) 懂球帝映射 + 情报（写 <raw>/_dqd_consensus.json，伤停靠它把 titanId 换成 dqdMatchId）
if ($Py -and $rd) {
  $env:PYTHONIOENCODING = "utf-8"
  Write-Host "  (懂球帝映射：meta=$Batch raw=$rd)" -ForegroundColor DarkGray
  Step "dqd 映射+情报" $Py @("tools/fetch_dqd_consensus.py", $Batch, "data/$rd") | Out-Null
}

# 1.5) 懂球帝伤停 -> injuryAdj（必须在 analyze 之前，否则 λ 不带修正）
if ($Py) {
  if ($mn) {
    $env:PYTHONIOENCODING = "utf-8"
    Write-Host "  (伤停批次号 $mn，raw 目录 $rd)" -ForegroundColor DarkGray
    $injArgs = @("tools/fetch_dqd_injury.py", "$mn", "--matches", "data/out/matches.json")
    if ($rd) { $injArgs += @("--consensus", "data/$rd/_dqd_consensus.json") }
    Step "dqd 伤停 -> injuryAdj" $Py $injArgs | Out-Null
  } else {
    Write-Host "`n=== dqd 伤停 ===" -ForegroundColor Cyan
    Write-Host "  ! 未能确定批次号，已跳过（可用 -BatchNo <n> 或 -RawDir rawNN 指定）" -ForegroundColor Yellow
  }
}

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
