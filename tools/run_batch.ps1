# run_batch.ps1 — 参数化批次编排：采集校验 -> collect -> analyze(双轨Node) -> engine(Python)
# 用法:
#   .\tools\run_batch.ps1 -RawDir data/raw_test -Meta data/test/_fetch_manifest.json -Index test
# 产物: data/out/matches<Index>.json, preds<Index>.json, engine<Index>.json
# 退出码: 0 全部干净；3 存在阻断/问题（详见各步输出）
param(
  [Parameter(Mandatory = $true)][string]$RawDir,
  [Parameter(Mandatory = $true)][string]$Meta,
  [Parameter(Mandatory = $true)][string]$Index,
  [string]$Node = "node",
  [string]$Py = ".\tools\py.cmd"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $Root

$matchesOut = "data/out/matches$Index.json"
$predsOut   = "data/out/preds$Index.json"
$engineOut  = "data/out/engine$Index.json"

function Invoke-Step($name, $exe, $argList) {
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  & $exe @argList | Out-Host
  $code = $LASTEXITCODE
  Write-Host "  [$name 退出码 $code]" -ForegroundColor Yellow
  return $code
}

# 0) 采集完整性（不通过则停止，采集不完整不允许进入建模）
$c0 = Invoke-Step "check_fetch 采集完整性" $Node @("tools/check_fetch.mjs", $RawDir, $Meta)
if ($c0 -ne 0) {
  Write-Host "`n✗ 采集不完整，已停止。请先补齐 $RawDir 再运行。" -ForegroundColor Red
  exit 3
}

# 1) collect 解析
$c1 = Invoke-Step "collect 解析" $Node @("tools/collect.mjs", $RawDir, $Meta, $matchesOut)

# 2) analyze 主模型（退出码 3 = 含阻断，属如实阻断，不中断）
$c2 = Invoke-Step "analyze 双输入建模" $Node @("tools/analyze.mjs", $matchesOut, $predsOut)

# 3) engine 第二轨
$env:PYTHONIOENCODING = "utf-8"
$c3 = Invoke-Step "engine 独立模型第二轨" $Py @("tools/bridge_engine.py", $matchesOut, $engineOut)

# 4) 亚盘退盘/升盘方向核对（退出码 4 = 模型方向与多数退盘冲突，告警不阻断）
$c4 = Invoke-Step "check_line 亚盘实时变化核对" $Node @("tools/check_line.mjs", $RawDir, $Meta, $predsOut, $engineOut, $matchesOut)

# 5) 盘口同态检索 · 实习记录（每批必跑，只记录不决策；失败不影响主链）
#    赛后补 results<Index>.json 后执行: node tools/analog_journal.mjs settle <Index>
$c5 = Invoke-Step "analog 盘口同态实习记录" $Node @("tools/analog_journal.mjs", "record", "--batch", "$Index")
if ($c5 -ne 0) { Write-Host "  (同态实习记录失败，不影响主链；历史库可能不存在，先跑 tools/analog_hc.mjs build)" -ForegroundColor DarkYellow }

# 5b) 盘口冻结台账记录（只记录不决策；变化家数≤20% 且绝对值中位未变才入库）
#     赛后补 results<Index>.json 后执行: node tools/freeze_journal.mjs settle <Index>
$c6 = Invoke-Step "freeze 盘口冻结台账记录" $Node @("tools/freeze_journal.mjs", "record", "$Index")
if ($c6 -ne 0) { Write-Host "  (冻结台账记录失败，不影响主链)" -ForegroundColor DarkYellow }

Write-Host "`n=== 产物 ===" -ForegroundColor Cyan
foreach ($f in $matchesOut, $predsOut, $engineOut) {
  if (Test-Path -LiteralPath $f) { Write-Host ("  {0,8}  {1}" -f (Get-Item -LiteralPath $f).Length, $f) }
}

$worst = ($c0, $c1, $c2, $c3 | Measure-Object -Maximum).Maximum
if ($c4 -eq 4) {
  Write-Host "`n警告: check_line 发现“模型方向 vs 多数退盘”冲突，写报告前以盘口变化为准，勿只看即时盘。" -ForegroundColor Magenta
}
if ($worst -eq 0) {
  Write-Host "`n结果: 全链干净，无阻断。" -ForegroundColor Green
} else {
  Write-Host "`n结果: 存在阻断/问题（退出码 3），阻断为规则内如实拦截，请查看上方 analyze/engine 明细。" -ForegroundColor Yellow
}
# 阻断类退出码优先；无阻断但有盘口冲突告警时返回 4，否则返回 worst
if ($worst -ne 0) { exit $worst }
exit $c4
