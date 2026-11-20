---
name: jc-football-report
description: 本机双轨足球赛前预测与复盘。球探 titan007 浏览器采集 + 结构化亚盘/大小球，Node 独立模型与 football-engine DixonColes 双轨并跑，低样本阻断，输出 Markdown 赛前报告并可 backtest 复盘。Use when the user asks for 足球预测、赛前分析、盘口分析、大小球 or 复盘。
---

# 本机双轨足球预测

在 Windows 本机用一套可复算工具链完成赛前预测：浏览器采集球探页面与澳门结构化盘口，用**盘口之外的独立信息**（主客分离得失球）跑两个独立模型，方向一致才下结论、分歧采信定价方、样本不足即阻断，输出 Markdown 报告；赛后用真实比分 backtest 复盘。

## 铁律

1. **数字只来自工具输出**，禁止手算或估算；每个进模型的数字能追到源文件。
2. **缺独立输入或低样本即阻断，绝不降级出方向**：主队主场 P 或客队客场 P < 3 拒跑（analyze 自检 2b、bridge_engine 同口径）。
3. **让球方向只认结构化 `{id}.handicap.json`**，禁止用页面"相同盘路"区的"初盘:受让…"文字或自然语言推断（会把主让反判成受让）。
4. **不只看即时盘，必须看亚盘初盘→即时的退盘/升盘实时变化**：用 `{id}.line.json` 统计多家退盘/升盘家数。模型押让球方、但多数公司（≥2/3）一边倒退盘、几乎无反向升盘、且让球已下移到半球并有公司退到平/半时，判定 HDA 冲突，采信盘口、下调/取消该方向；若只退一档、仍让半球以上，则仅作让球(rq)深盘风险，不翻转胜负。**升降盘不机械等同信心强弱**：退盘≠没信心、升盘≠信心暴增，资金热/诱盘（散户一边倒、庄家平衡或诱导）也会推动盘口，须用整体实力/近期状态/体能等基本面交叉，由 check_line 输出“一致/背离/中性/盘口退平/数据不足”，背离时不追。
5. **大小球按实际盘口下结论**：模型 o25 是固定 2.5 累积概率，实际盘常升到 3–4 或降盘，须以实际盘口水位（低水方被看好）和盘口升降为准，不能直接套用模型 2.5。让球退盘与大小球盘口是两个独立口径，分开判断。
6. **比分不给单值**，只给带概率的 top 分布；单点最高比分与大小球累积概率口径不同，不矛盾。
7. **回测先于下一轮结论**：先复盘上一轮已完赛场次，再做新批次。
8. **伤停/必发按证据接入，不硬接无证据字段**：engine 的 `injury` 标量是无实测证据的死字段（engine 注释明确警告"缺阵人数→单一injury"不可凭空接线），伤停只采集具体球员/位置/原因作参考，不写 injury；`rest_days` 是 engine 已生效字段，按近期战绩日期计算后注入；必发数据（成交价/成交量/比例/冷热指数/大注买卖）是真实资金参考，用来和欧赔归一化概率交叉，注意区分散户资金与大注倾向，不把它当稳赚信号。
9. 报告只做定价与情报分析，不承诺收益；本 skill 只沉淀方法，不保存具体赔率结论。
10. **盘口同态检索按「实习制」运行：每批必跑、逐场记账、只记录不决策**。`run_batch.ps1` 每批自动执行 `analog_journal.mjs record --batch N`；赛后用 `settle N` 把同态结论与真实比分一起写入 `data/analog_journal.jsonl`；`report` 自动判定转正。无前视实测（2026-11-18）只有 **0.50 盘**达「启用」（17 场 70.6%），0.25/0.75/1.25/1.75 为「观察」，0.00 与 1.00 为「禁用」。**无论启用与否都不得翻转模型方向**：启用组最多用于降仓或加信心，未启用组只在报告里写「实习观察」，不影响决策。样本只允许取编号更早的批次（严禁前视，否则成绩虚高）。水位维度不可用——库内每场只采一家公司一个时点，凡称"同盘口同水位"的结论都不成立。
11. **交付前必须跑 `python tools/factcheck.py <批次号>` 并全项对齐，否则不许交付**。该脚本从源文件重取一遍会进报告的数字（欧赔/澳门让球/多公司退升盘/战绩/λ/HDA/比分/engine），并按**队名**在本批 engine 文件里定位，防止读到上一批残留文件。任何一条"报告值 ≠ 源值"必须改报告而不是改脚本；脚本自身若与 `check_line` 结论冲突，先查脚本。历史事故：2026-11-21 报告误用上一批 `data/out/engine_preds.json` 写出 66.4% / 15.6%，与本批真实 44.7% / 42.2% 相差 20 个百分点。

## 工具（tools/）

| 文件 | 职责 |
| --- | --- |
| `fetch_batch.py` | 浏览器全自动采集：给清单与输出目录，逐场写 `{id}.txt`、`{id}.handicap.json`、`{id}.line.json`（多家亚盘初盘/即时）、`{id}.1x2.json`（百家欧赔初盘/即时平均胜平负），在 computer_use 环境跑，`import seed_browser_use`；欧赔为增强项，失败不阻断 |
| `fetch_dqd.py` | **懂球帝情报采集**：滚动「全球」赛程页，按 `dqd_aliases.json` 处理同队异译，自动匹配 titan007 id→懂球帝 match id，逐场写 `{id}.dqd.json`（状态伤停、必发冷热分布、必发大注倾向）；computer_use 环境跑，缺数据如实留空不阻断。**赛事名对照：欧女杯 = 女足欧冠**；但女足欧冠、部分小国杯赛在懂球帝赛程流里只出"前瞻"爆料条、不出比赛条目，拿不到 match id，伤停必然缺失，报告须写"未覆盖"而非零伤停 |
| `fetch_dqd_consensus.py` | **懂球帝专家数据全量采集（纯 HTTP，无需浏览器）**：赛程页解析 `li id="id<matchId>"` → 队名匹配 meta → 调 `lottery.dongqiudi.com/api/getMatchTips` 拿 23 个模块（专家方案分布/伤停/必发分布与成交/冷门预警/欧亚对比/裁判/阵型/AI预测），写 `<rawDir>/<titanId>.dqd_tips.json` + `_dqd_consensus.json`。**赛前赛后都能跑**，但赛程页 `date` 参数不生效（固定返回当前比赛日约 250 场切片），历史日期与小赛事拿不到 id |
| `review_consensus.mjs` | **专家共识复盘对照（情绪参考，不参与决策）**：读各 raw 的 `_dqd_consensus.json` + `*.dqd_tips.json`，用页面积分判实际，统计「专家最大占比选项」在竞彩胜平负 / 总进球大小 / 竞彩让球的命中率，并列出上下盘共识。**定位只有一条：记录"大众押哪边、押得多整齐"，不用于改写方向/让球/大小球，也不做反向信号** |
| `fetch_plans.py` | **外部方案资料采集（赛前必跑）**：抓球探 `www.titan007.com` 首页按比赛分组的分析师方案（标题/分析师/战绩标签/玩法/查看人数），`--deep` 逐条打开 `ba2.titan007.com` 方案页补抓公开分析段与付费标记，写 `<rawDir>/_plans.json`。**仅覆盖在售赛事，赛后无法回溯**，故必须赛前跑 |
| `review_plans.mjs` | **复盘读外部方案资料**：读 `<rawDir>/_plans.json` + meta + results，逐场输出方案数、玩法分布、分析师与战绩、公开分析段在「伤停/战意/体能/交锋/水位/大球/小球」七维的覆盖，并与实际比分并列；付费隐藏的推荐结论不可见，不做命中判定 |
| `fetch_post_plans.py` | **赛后外部方案采集（复盘必跑）**：按比赛 ID 进 `ba2.titan007.com/linkmatch/1/<id>.html` 抓该场全部分析师方案，再逐条抽取**赛后公开的推荐选项 + 「推」标记**（正文仍锁，不绕过），写 `data/test/post_plansN.json`。与 `fetch_plans.py` 互补：后者只能赛前扫首页在售，本脚本赛后可回溯。必须在 `computer_use_tool(plane="bu")` 内 subprocess 调起 |
| `fetch_dqd_post.py` | **赛后懂球帝专家分布采集（复盘必跑第二源）**：读 `getMatchTips` 的 `ExpertPlan`（该场**全部专家方案的聚合分布**，`is_unlock=1` 免费可见，1119 批两场 79/95 条），再用真实比分与盘口逐项判对错，写 `data/test/post_dqdN.json`。纯 requests，不需要浏览器。注意口径：懂球帝是**亚盘上/下盘**，净胜正好 2 在 2.0 盘为走盘，与球探"胜 2 球及以上"口径不同，不可混算 |
| `fetch_dqd_injury.py` | **懂球帝伤停→λ修正（能力补齐①）**：`python tools/fetch_dqd_injury.py <批次号...>`，读 `matchesN.json` + `<raw>/_dqd_consensus.json` 的 titanId→dqdMatchId，拉 `getMatchTips` 的 `TeamDesInjury`（`team_A/team_B` 自然语言：姓名＋位置＋出场/进球/助攻＋因伤/成疑），解析后写回 `matchesN.json` 的 `injuryAdj`，`analyze.mjs` 直接透传。口径：位置权重 前锋0.55/中场0.40/后卫0.28/门将0.18，出场权重 min(出场,12)/12，产出加成 1+0.12*(进球+助攻)，伤缺全额/成疑半额；**攻防拆分**——前锋中场缺阵降己方进攻，后卫门将缺阵抬高对手进攻，`adj=0.30*(差值)` 夹 ±0.35。`TeamDesInjury` 常为 null（女足、小国队），此时写 `source:"empty"` 明示无数据，不猜。**run.ps1 已固化为第 1.5 步**：第 1.2 步先跑 `fetch_dqd_consensus.py <meta> data/rawNN` 写 `_dqd_consensus.json`（titanId→dqdMatchId 映射），再跑伤停（`--matches data/out/matches.json --consensus data/rawNN/_dqd_consensus.json`，因为 run.ps1 的产物是不带批次号的 `matches.json`）。覆盖率实测：196 场历史里仅 18 场有 mid、3 场有真实伤停，故**只能"有则用"，报告中必须区分"无数据"与"双方均无伤停"** |
| `check_standings.mjs` 的 `motivationGap` | **战意不对称量化（能力补齐②）**：在杯赛形势基础上加 `MW={strong:2,medium:1}` 打分，输出 `{homeScore,awayScore,gap,label,level,rotationRisk,note}`，`level` 为 强不对称/弱不对称/对等。判"已无戏"用**落后第2名的分差**（不是相邻名次）：出线区外且落后≥4分、仅剩≤3场 → 降为 medium。`rotationRisk` 只认"留力/锁定/控制节奏"，"为荣誉"不算风险。**仅作叙事与可疑点，不改方向不改盘口** |
| `check_fetch.mjs` | 赛前采集完整性校验：txt/handicap 齐全且字段非空，PASS/FAIL，失败 exit 3 |
| `factcheck.py` | **交付前事实核对（报告必跑闸门）**：`python tools/factcheck.py <批次号>`，从 `matchesN/predsN/engine_predsN` + `data/raw(N-1)/` 的 1x2/handicap/line 重取一遍所有会进报告的数字（欧赔初/即时、澳门让球、多公司退升盘与绝对值中位、两队战绩、比率链、ana λ/HDA/比分、engine xG/HDA/input），逐项打印清单。engine 按 `home`+`away` **队名**匹配，匹配不到报「可能读了别的批次」；命中 `engine.skipped` 则显示「主动跳过」而非误报。凡「报告值 ≠ 源值」必须改报告；脚本与 `check_line` 冲突时先查脚本。历史事故：1121 批误用上一批 `engine_preds.json`（布拉格斯巴达）写出 66.4%/15.6%，本批真实为 44.7%/42.2% |
| `verify.mjs` | **带赛果的综合自检**：数据完整性、页面比分与赛果基线交叉校验、让球分档、Brier；用法 `node tools/verify.mjs <matchesN> <predsN> <resultsN>`（三个参数都必须显式传，默认值写死为旧批次 `results_1146_11.json`）。退出码 0 = 通过，3 = 存在阻断/不一致。**需要 results，赛前无赛果时用不了**，赛前闸门用 `factcheck.py` |
| `check_line.mjs` | 亚盘退盘/升盘实时变化核对：统计各场退/升/平家数与让球强弱，与双轨模型方向比对，HDA 冲突 exit 4、rq 退盘仅提示；第 5 参数可选传 matches.json，传入则做“盘口×基本面”交叉（实力/状态/体能三维投票，必发资金独立标注），输出一致/背离/中性/盘口退平/数据不足；无 line.json 或不传第5参向后兼容 |
| `test_fund_check.mjs` | 盘口×基本面交叉的端到端测试（合成文件黑盒跑 CLI，覆盖升盘/退盘背离、数据不足），改动交叉逻辑后先跑它 |
| `check_025.mjs` | 0.25（平/半）盘专用下盘/平局统计（check_handicap 的 0.25 特例，保留兼容） |
| `check_handicap.mjs` | **通用让球结算**：支持任意盘口（0/0.25/0.5/0.75/1/1.25…），quarter 盘按五档（全赢/赢半/走盘/输半/全输）精确结算；赛前列平局赔率热度，复盘对比市场让球方概率 vs 实际全赢率；第4参数可指定目标盘口 |
| `test_settle.mjs` | 结算函数单元回归测试（27 条断言覆盖常见盘口），改动结算逻辑后先跑它 |
| `analog_hc.mjs` | **盘口同态检索（第四轨，只作复核）**：`build` 从 matches 批次 + raw 的 handicap + results 建 `data/analog_lib.json`；`stat` 看盘口分桶；`<rawDir> <meta>` 检索同盘口历史场次，输出五档结算/大小球/胜平负/比分前三/明细。**水位层当前不可用**（历史库每场只采一家公司一个时点，水位不可比），实际只按「盘口相同」匹配；内置盘口组启用表，命中率 <50% 的盘口组标「不采纳」，样本 < min（默认 5）明示不参与决策 |
| `analog_backtest.mjs` | 同态检索的**无前视回测**（只用编号更早的批次做样本），输出总体命中率、按盘口/按样本量分层；库增长后必须重跑并回填 `analog_core.mjs` 的 `TIER_GUIDE`，禁止沿用旧值 |
| `analog_core.mjs` | 同态检索**共享核心**：盘口组启用表 `TIER_GUIDE`、达标判定 `isEligible`、三层匹配 `matchTiers`、五档结算与汇总 `analyze`。analog_hc 与 analog_journal 都引用它，改口径只改这里 |
| `analog_journal.mjs` | **同态实习台账**：`record --batch N`（run_batch 自动调用，写 `data/test/analogN.json`）、`settle N`（赛后结算追加 `data/analog_journal.jsonl`）、`report`（实习成绩 + 转正判定）、**`md --batch N --out`（生成报告用的「同态实习」小节，落盘 `analogN.md`）**。门槛/启用表按当前标准实时重算 |
| `freeze_journal.mjs` | **盘口冻结台账（只记录、不决策）**：`record <批次号>` 读 `matchesN` + `data/raw(N-1)` 的 `*.line.json`，判定冻结（变化家数 ≤20% 且绝对值中位未变，样本 ≥8 家）并写 `data/freeze_journal.json`；`settle <批次号>` 读 `resultsN` 按让球方结算（赢/走/输）；`report` 汇总上盘不输率，**样本 <15 只记录**。语义：冻结=没有公司愿意加深让球，**不等于定价充分**，不得据此加信心；`check_line.mjs` 已同步输出「冻结」标记 |
| `check_rise_rules.mjs` | **盘口形态经验规则回溯**：`node tools/check_rise_rules.mjs [--detail] [--dist]`，全库扫描有 `line.json`+`results` 的配对，按 `0.75→1.0 / 0.75未动 / 0.5→0.75 / 0.25未动 / 升到0.5` 五组统计上盘全赢·赢半·走·输半·全输。**每组样本 <15 场一律标注「观察中」，不得写进方向建议或投注结论**；`--dist` 打印形态分布用于发现样本缺口 |
| `collect.mjs` | 解析 txt + 读 handicap，识别竞彩"暂无数据/未开盘"；积分段同时输出主客拆分得失球（模型输入）与 `team.overall` 整体实力（排名/积分/胜率/整体进失球/净胜球，参考数据）；另输出 `restDays`（近期战绩日期算的赛程间隔）与 `dqdIntel`（懂球帝伤停/必发，参考），输出 matches |
| `analyze.mjs` | 主模型轨（Node，调 scripts/analyze.js），含低样本自检 2b，输出 preds |
| `bridge_engine.py` | 第二轨 football-engine DixonColes，独立强度注入 + 低样本拒跑，把 `restDays` 注入 TeamRating.rest_days（engine 已生效字段）；经 `py.cmd` 运行 |
| `bridge_lottery.py` | **已废弃（旧第一轨）**：曾把 collect 的盘口送入 `football_lottery_prediction`。当前第一轨是 `analyze.mjs` + `scripts/analyze.js`，本文件仅为兼容历史批次保留。**新批次一律不得调用**，调用会跑到另一套引擎上，产出与 ana 轨不同源 |
| `backtest.mjs` / `backtest_all.mjs` | 自主结算（让球 net=(主-客)-hc，主让为正）/ 多批聚合 |
| `build_results.mjs` | 按真实比分生成 backtest 所需 results |
| `run_batch.ps1` | 参数化编排：check_fetch→collect→analyze→engine→check_line 一条命令 |
| `py.cmd` | 优先用项目内嵌 Python（`.runtime/python`） |
| 其余脚本（不登记） | `review_line/review_ou/review_settle/review_agg`、`probe_standings/probe_national`、`summary_hc/summary_pred33`、`build_handicap13`、`scan_025`、`collect_plans_history/judge_hist_plans/dqd_dist_join/dqd_dist_judge/backtest_dqd_hist` 均属**历史批次一次性分析**，未接入 `run_batch.ps1`，不作为日常流程入口 |

## 赛前流程

1. **定位 ID**：在即时比分页 `live.titan007.com/oldIndexall.aspx`，用 `a[onclick*="analysis"]` 所在行文本匹配队名，取 ID。
2. **写清单**：JSON 格式 `{matches:[{no,id,lg,kickoff,home,away}]}`，home 用页面 `主队(主)` 标签能匹配的名称。此清单即 meta，贯穿采集与 collect。
3. **全自动采集**（computer_use 环境）：
   `python tools/fetch_batch.py <清单> <data/rawN>` → 每场 txt + handicap.json + `_fetch_report.json`。
   3b. **懂球帝情报采集**（可选但建议，computer_use 环境）：
   `python tools/fetch_dqd.py <清单> <data/rawN>` → 每场 `{id}.dqd.json`（伤停 + 必发），未匹配/无数据的场如实记录。
   3c. **外部方案资料采集**（赛前必跑，computer_use 环境）：
   `python tools/fetch_plans.py <清单> <data/rawN> --deep` → `<rawN>/_plans.json`（球探分析师方案 + 公开分析段）。
   漏跑则赛后无法补（首页只覆盖在售赛事），该批复盘只能标「外部方案资料缺失」。
   3d. **懂球帝专家数据采集**（纯 HTTP，可在 PowerShell 直接用内嵌 Python 跑，不必进 computer_use）：
   `.runtime\python\python.exe tools/fetch_dqd_consensus.py <清单> <data/rawN>` → 每场 `<id>.dqd_tips.json` + `_dqd_consensus.json`。
   赛前是当前比赛日，命中率最高；赛后只能覆盖仍在"当前切片"内的场次。
4. **一条命令建模**：
   `.\tools\run_batch.ps1 -RawDir data/rawN -Meta <清单> -Index N`
   自动跑 check_fetch→collect→analyze→engine→check_line→**analog（同态实习记录）**，产出 `matchesN/predsN/engineN` 与 `data/test/analogN.json`；退出码 0 干净，3 含阻断/问题，4 含 HDA 退盘冲突（告警不阻断，写报告前先处理）。
5. **写 Markdown 报告**：逐场给方向（一致/分歧采信依据、退盘冲突是否修正）、让球、大小球（实际盘口）、参考比分分布，如实标注每场工具参与度与阻断；让球盘场次可跑 `check_handicap.mjs`（赛前模式）看平局赔率/热度，复合盘提示防下盘。
   ★ **固定插入「同态实习」小节**。报告固定结构：一 结论速览 → 二 盘口与水位 → 三 双轨与让球打穿概率 → **四 同态实习** → 五 逐场判断 → 六 口径与缺口。
   用 `node tools/analog_journal.mjs md --batch N --out` 生成表格片段（同时落盘 `data/test/analogN.md`），**直接粘贴进报告，不手写任何数字**。
   小节标题必须带「实习期，不参与决策」；未达门槛场次一律标「仅记录」；达门槛也只写「可作降仓/加信心的旁证」，**绝不改写方向或大小球**。

## 赛后复盘流程

1. 即时比分页取完场全场比分（状态单元格="完"）。
2. `build_results.mjs` 生成 `resultsN.json`（key=no，value=[gh,ga]）。
3. `node tools/backtest.mjs data/out/predsN.json data/test/resultsN.json` 逐批；`backtest_all.mjs` 聚合命中率、Brier。
4. 让球结算复核：`node tools/check_handicap.mjs data/rawN <meta> data/test/resultsN.json [盘口]`，按五档精确结算，对比市场让球方概率 vs 实际全赢率，验证 0.25/0.75 等盘口的下盘经验是否成立，不凭经验直接套用。
5. 把命中率与盘口隐含对照，识别系统性偏差（如平局漏判、深盘两极、冷门），更新经验与阈值。
6. 外部方案资料对照：`node tools/review_plans.mjs data/rawN <meta> data/test/resultsN.json`，把赛前采集的方案结构（数量/玩法分布/分析师战绩/公开段维度覆盖）与实际比分并列，作为独立第四方参照；若该批未采集，报告须明确标注缺失、不得用事后数据杜撰。
7. 专家共识对照（**情绪参考，不参与决策**）：`node tools/review_consensus.mjs data/rawN ...`，输出「专家最大占比选项」在胜平负/大小球/让球上的命中率，并与模型轨道横向对比。**它只回答"大众押哪边、押得多整齐"，不作为任何方向的加减信心依据，也不做反向信号**——「共识与盘口退盘同向共振」只记录、不翻转方向（1117 批 3/3 错、1119 批赫根 93% 押下盘全错，两个反例已证）。
8. **同态实习结算**：`node tools/analog_journal.mjs settle N` 把该批同态结论与真实比分一并入账，再 `node tools/analog_journal.mjs report` 看实习总成绩与转正判定。启用表随库增长会失真，成绩与本表冲突时以无前视回测（`analog_backtest.mjs --min 5`）为准并更新 `TIER_GUIDE`。
8b. **冻结台账结算（每批必做）**：`node tools/freeze_journal.mjs settle N`，再 `node tools/freeze_journal.mjs report` 看冻结场上盘不输率。**只记录不决策**：样本 <15 一律标注「仅记录」，不得据此改写方向或让球；达到 15 场后再评估是否立为负向信号。赛前 `record` 由 `check_line.mjs` 的「冻结」标记配合人工确认，报告里出现冻结场时须写明「冻结≠定价充分」。
9. **赛后外部方案复核（每次复盘必做，球探 + 懂球帝两源）**：
   - **球探**：`python tools/fetch_post_plans.py <meta> data/test/post_plansN.json`（须在 `computer_use_tool(plane="bu")` 内 subprocess 调起）。按比赛 ID 进 `https://ba2.titan007.com/linkmatch/1/<matchId>.html` 抓该场全部分析师方案，抽取赛后公开的「推荐选项 + 推」标记（正文仍锁，不绕过付费墙）。
   - **懂球帝**：`.runtime\python\python.exe tools\fetch_dqd_post.py <meta> <rawDir> data/test/post_dqdN.json`。读 `getMatchTips` 的 `ExpertPlan`——**该场全部专家方案的聚合分布**（本批两场 79 / 95 条，`is_unlock=1` 免费可见），再用真实比分与盘口逐项判对错。
     **定位是情绪参考，不是信号**：它只说明"大众押哪边、一致性有多高"，**不参与方向 / 让球 / 大小球判断，也不做反向指标**。脚本输出里带 `role: sentiment_only` 字段防止下游误用。
   - **两源口径必须分开写，不得混算**：球探是整数让球表述（"胜 2 球及以上"含 2 球），懂球帝是亚盘上/下盘（净胜正好 2 在 2.0 盘为**走盘**）。同一赛果在两个口径下可能一个"中"、一个"走"。
   这一步的价值：球探方案是**单个分析师的明确推荐**，可与模型逐项对错；它与盘口同向时能暴露「模型孤立」的情形——1119 批两场模型全错、分析师几乎全中，就是靠这一步才看出来的。懂球帝共识则是**情绪温度计**，只用来看"是不是所有人都挤在一侧"，不进决策链。
10. **赛果必须结合过程，不只看比分**：每场补三样——①关键事件（红牌/点球/VAR），现场分析页 `https://live.titan007.com/detail/<id>cn.htm` 的「重要事件」区（牌型靠事件图标 `title="紅牌"` 判定）②技术统计（射门/射正/xG/控球）③事件时点与比分变化的对应（如「84 分钟仍 1-1，红牌后才连丢 2 球」）。
    只看最终比分会把「红牌造成的末段崩盘」误判成「模型方向错误」或「盘口信号真假」。**赛前判断的对错，应在"无意外事件时的自然演化"口径下评价**，并单独标注该场是否受不可预测因素影响。

## 数据源（球探，浏览器通道）

- 即时比分：`https://live.titan007.com/oldIndexall.aspx`
- 分析师方案（按比赛分组，在售）：`https://www.titan007.com/`；方案正文 `https://ba2.titan007.com/<分析师ID>/<文章ID>.html`。公开段可读（分析师+战绩标签、玩法、比赛信息、分析铺垫段、对赛往绩、同场其它方案与查看人数）；**推荐结论约 170-190 字付费隐藏**，不绕过；账号「被解锁」页 `https://users.titan007.com/user/mypage.aspx?k=9`
- 懂球帝方案详情（已完赛免费全文）：`https://www.dongqiudi.com/project/<方案ID>`；**无列表入口**（`/project` 403、`/project/list` 空），只能按 id 直达
- 懂球帝**专家数据接口**（核心，纯 HTTP，免费，赛后可用）：`https://lottery.dongqiudi.com/api/getMatchTips?match_id=<id>&mtoken=`，返回 `data.data` 数组含 ExpertPlan（专家方案分布，`is_unlock=1`）、TeamDesInjury、Bf_Distribute、Bf_Transaction、DarkAlarm、OddsDiff、Referee、Formation、Forecast、GoalDistri、AigcMatchPredictions 等 23 个模块。**必须用 `r.content.decode("utf-8")` 取内容**，requests 默认猜编码会乱码
- 懂球帝赛程页（取 matchId）：`https://m.dongqiudi.com/match/12?date=YYYY-MM-DD`，SSR，正则 `<li id="id(\d+)" class="match-calendar-item"`，主队在 `.match-item-a`、时间联赛与比分在 `.match-item-c`、客队在 `.match-item-b`。**date 参数不生效**，固定返回当前比赛日约 250 场热门切片
- 懂球帝比赛详情：`https://m.dongqiudi.com/matchDetail/<matchId>`（实力对比/交锋/近期战绩）、`/lotIntelligence`（冷门预警、欧亚水位、首发完整度与换人）；`/expert` 无网页版，跳下载页
- 懂球帝 4 模型预测（含赛后对照与平台自报命中率）：`https://m.dongqiudi.com/zhanbao/yuce/<matchId>`
- 分析页：`https://zq.titan007.com/analysis/{id}cn.htm`
- 亚盘：`https://vip.titan007.com/AsianOdds_n.aspx?id={id}&l=0`（盘口单元格 `goals` 属性即数值）
- 大小球：`https://vip.titan007.com/OverDown_n.aspx?id={id}&l=0`
- 百家欧赔（胜平负）：`https://1x2.titan007.com/oddslist/{id}.htm`（取初盘/即时平均行与归一化概率）
- 懂球帝情报（伤停 + 必发）：`https://m.dongqiudi.com/matchDetail/<dqd_id>/lotIntelligence`；全球赛程页 `https://m.dongqiudi.com/match/12`（比赛行 `li` 的 id 即懂球帝 match id）；在售方案付费墙不绕过，已完赛方案全文免费
- 说明：球探分析页 curl 直连失败，只能走浏览器；本机浏览器库名 `seed_browser_use`。

## 上游 GitHub 同步（差异化，不覆盖本地工具链）

云端上游 `laoyangnb666/jc-football-report` 已演进到竞彩官方 PDF 报告体系，与本地 titan007 双轨体系定位不同，故 SKILL.md 不直接覆盖，按文件差异化合并：

- **已采纳云端**：`scripts/analyze.js`（超短赔经验值随样本扩大由 0.917 主推更新为 0.739 小注）、`references/model-and-calibration.md`（四轮回测与教训）、`docs/` 的 data.js/index.html/skill.html（更新统计与入口）、新增 `docs/blackjack.html`（澳门 21 点模拟器）。
- **保留本地**：README.md（本地是云端超集，仅多 Windows 部署章节）、本 SKILL.md（准确描述本地实际在跑的 titan007/懂球帝工具链）、整个 `tools/` 目录（本地扩展，云端 main 不含）。
- 云端回测经验（伤停双源确认、新帅效应、超短赔降级等）以 `references/model-and-calibration.md` 为准，不在此重复；本地沿用「数字只来自工具输出、小样本不夸大」的同一纪律。

## 交付前检查

- [ ] check_fetch PASS，场次数 = 清单数
- [ ] check_line 已核对退盘/升盘，HDA 冲突场（exit 4）已按盘口修正，rq 退盘已标注；已传 matches 做基本面交叉，背离场（资金热/诱盘嫌疑）已降信心、不追
- [ ] 让球盘场次已用 check_handicap 看平局赔率/热度与五档结算，防下盘（小样本经验，不夸大、不直接套用）
- [ ] 结算逻辑改动后 test_settle 断言 PASS
- [ ] 每场让球/独立输入齐全，阻断场次已标注且未出方向
- [ ] team.overall 整体实力（排名/积分/净胜球）已纳入参考，用于核对让球合理性，不替代主客拆分模型输入
- [ ] 已跑 fetch_dqd：伤停（具体球员/位置/原因）、必发冷热与大注已留档；缺数据场已标注，未硬接 injury 死字段；rest_days 已注入 engine
- [ ] 大小球结论基于实际盘口水位，非模型 2.5 直接套用
- [ ] **同态实习**：run_batch 已自动 `record`；报告每场带「同态实习」行（盘口组/样本/上盘不输率/是否达门槛），未达门槛已标「仅记录，不参与决策」，未用它改写方向或大小球
- [ ] **factcheck 已跑且 0 条问题**：`python tools/factcheck.py <批次号>` 输出「清单完整」；逐项对齐，engine 按队名匹配到本批，未读到历史残留
- [ ] 无单一比分预测，数字与工具输出逐字一致
- [ ] 报告含工具参与度、源数据目录、风险提示
