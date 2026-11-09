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
4. **不只看即时盘，必须看亚盘初盘→即时的退盘/升盘实时变化**：用 `{id}.line.json` 统计多家退盘/升盘家数。模型押让球方、但多数公司（≥2/3）一边倒退盘、几乎无反向升盘、且让球已下移到半球并有公司退到平/半时，判定 HDA 冲突，采信盘口、下调/取消该方向；若只退一档、仍让半球以上，则仅作让球(rq)深盘风险，不翻转胜负。
5. **大小球按实际盘口下结论**：模型 o25 是固定 2.5 累积概率，实际盘常升到 3–4 或降盘，须以实际盘口水位（低水方被看好）和盘口升降为准，不能直接套用模型 2.5。让球退盘与大小球盘口是两个独立口径，分开判断。
6. **比分不给单值**，只给带概率的 top 分布；单点最高比分与大小球累积概率口径不同，不矛盾。
7. **回测先于下一轮结论**：先复盘上一轮已完赛场次，再做新批次。
8. **伤停/必发按证据接入，不硬接无证据字段**：engine 的 `injury` 标量是无实测证据的死字段（engine 注释明确警告"缺阵人数→单一injury"不可凭空接线），伤停只采集具体球员/位置/原因作参考，不写 injury；`rest_days` 是 engine 已生效字段，按近期战绩日期计算后注入；必发数据（成交价/成交量/比例/冷热指数/大注买卖）是真实资金参考，用来和欧赔归一化概率交叉，注意区分散户资金与大注倾向，不把它当稳赚信号。
9. 报告只做定价与情报分析，不承诺收益；本 skill 只沉淀方法，不保存具体赔率结论。

## 工具（tools/）

| 文件 | 职责 |
| --- | --- |
| `fetch_batch.py` | 浏览器全自动采集：给清单与输出目录，逐场写 `{id}.txt`、`{id}.handicap.json`、`{id}.line.json`（多家亚盘初盘/即时）、`{id}.1x2.json`（百家欧赔初盘/即时平均胜平负），在 computer_use 环境跑，`import seed_browser_use`；欧赔为增强项，失败不阻断 |
| `fetch_dqd.py` | **懂球帝情报采集**：滚动「全球」赛程页，按 `dqd_aliases.json` 处理同队异译，自动匹配 titan007 id→懂球帝 match id，逐场写 `{id}.dqd.json`（状态伤停、必发冷热分布、必发大注倾向）；computer_use 环境跑，缺数据如实留空不阻断 |
| `dqd_aliases.json` | titan007→懂球帝队名异译对照（如费德列斯达=腓特烈斯塔、白兰恩=布兰、PAOK=塞萨洛尼基） |
| `check_fetch.mjs` | 赛前采集完整性校验：txt/handicap 齐全且字段非空，PASS/FAIL，失败 exit 3 |
| `check_line.mjs` | 亚盘退盘/升盘实时变化核对：统计各场退/升/平家数与让球强弱，与双轨模型方向比对，HDA 冲突 exit 4、rq 退盘仅提示，对无 line.json 的旧批次向后兼容 |
| `check_025.mjs` | 0.25（平/半）盘专用下盘/平局统计（check_handicap 的 0.25 特例，保留兼容） |
| `check_handicap.mjs` | **通用让球结算**：支持任意盘口（0/0.25/0.5/0.75/1/1.25…），quarter 盘按五档（全赢/赢半/走盘/输半/全输）精确结算；赛前列平局赔率热度，复盘对比市场让球方概率 vs 实际全赢率；第4参数可指定目标盘口 |
| `test_settle.mjs` | 结算函数单元回归测试（27 条断言覆盖常见盘口），改动结算逻辑后先跑它 |
| `collect.mjs` | 解析 txt + 读 handicap，识别竞彩"暂无数据/未开盘"；积分段同时输出主客拆分得失球（模型输入）与 `team.overall` 整体实力（排名/积分/胜率/整体进失球/净胜球，参考数据）；另输出 `restDays`（近期战绩日期算的赛程间隔）与 `dqdIntel`（懂球帝伤停/必发，参考），输出 matches |
| `analyze.mjs` | 主模型轨（Node，调 scripts/analyze.js），含低样本自检 2b，输出 preds |
| `bridge_engine.py` | 第二轨 football-engine DixonColes，独立强度注入 + 低样本拒跑，把 `restDays` 注入 TeamRating.rest_days（engine 已生效字段）；经 `py.cmd` 运行 |
| `backtest.mjs` / `backtest_all.mjs` | 自主结算（让球 net=(主-客)-hc，主让为正）/ 多批聚合 |
| `build_results.mjs` | 按真实比分生成 backtest 所需 results |
| `run_batch.ps1` | 参数化编排：check_fetch→collect→analyze→engine→check_line 一条命令 |
| `py.cmd` | 优先用项目内嵌 Python（`.runtime/python`） |

## 赛前流程

1. **定位 ID**：在即时比分页 `live.titan007.com/oldIndexall.aspx`，用 `a[onclick*="analysis"]` 所在行文本匹配队名，取 ID。
2. **写清单**：JSON 格式 `{matches:[{no,id,lg,kickoff,home,away}]}`，home 用页面 `主队(主)` 标签能匹配的名称。此清单即 meta，贯穿采集与 collect。
3. **全自动采集**（computer_use 环境）：
   `python tools/fetch_batch.py <清单> <data/rawN>` → 每场 txt + handicap.json + `_fetch_report.json`。
   3b. **懂球帝情报采集**（可选但建议，computer_use 环境）：
   `python tools/fetch_dqd.py <清单> <data/rawN>` → 每场 `{id}.dqd.json`（伤停 + 必发），未匹配/无数据的场如实记录。
4. **一条命令建模**：
   `.\tools\run_batch.ps1 -RawDir data/rawN -Meta <清单> -Index N`
   自动跑 check_fetch→collect→analyze→engine→check_line，产出 `matchesN/predsN/engineN`；退出码 0 干净，3 含阻断/问题，4 含 HDA 退盘冲突（告警不阻断，写报告前先处理）。
5. **写 Markdown 报告**：逐场给方向（一致/分歧采信依据、退盘冲突是否修正）、让球、大小球（实际盘口）、参考比分分布，如实标注每场工具参与度与阻断；让球盘场次可跑 `check_handicap.mjs`（赛前模式）看平局赔率/热度，复合盘提示防下盘。

## 赛后复盘流程

1. 即时比分页取完场全场比分（状态单元格="完"）。
2. `build_results.mjs` 生成 `resultsN.json`（key=no，value=[gh,ga]）。
3. `node tools/backtest.mjs data/out/predsN.json data/test/resultsN.json` 逐批；`backtest_all.mjs` 聚合命中率、Brier。
4. 让球结算复核：`node tools/check_handicap.mjs data/rawN <meta> data/test/resultsN.json [盘口]`，按五档精确结算，对比市场让球方概率 vs 实际全赢率，验证 0.25/0.75 等盘口的下盘经验是否成立，不凭经验直接套用。
5. 把命中率与盘口隐含对照，识别系统性偏差（如平局漏判、深盘两极、冷门），更新经验与阈值。

## 数据源（球探，浏览器通道）

- 即时比分：`https://live.titan007.com/oldIndexall.aspx`
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
- [ ] check_line 已核对退盘/升盘，HDA 冲突场（exit 4）已按盘口修正，rq 退盘已标注
- [ ] 让球盘场次已用 check_handicap 看平局赔率/热度与五档结算，防下盘（小样本经验，不夸大、不直接套用）
- [ ] 结算逻辑改动后 test_settle 断言 PASS
- [ ] 每场让球/独立输入齐全，阻断场次已标注且未出方向
- [ ] team.overall 整体实力（排名/积分/净胜球）已纳入参考，用于核对让球合理性，不替代主客拆分模型输入
- [ ] 已跑 fetch_dqd：伤停（具体球员/位置/原因）、必发冷热与大注已留档；缺数据场已标注，未硬接 injury 死字段；rest_days 已注入 engine
- [ ] 大小球结论基于实际盘口水位，非模型 2.5 直接套用
- [ ] 无单一比分预测，数字与工具输出逐字一致
- [ ] 报告含工具参与度、源数据目录、风险提示
