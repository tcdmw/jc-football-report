<p align="center">
  <img src="docs/assets/logo.png" width="96" alt="jc-football-report logo">
</p>

<h1 align="center">竞彩足球机构级分析报告</h1>

> 一个把中国体育彩票「竞彩足球」盘口还原成概率、并与公众资金流对比、找出结构性定价偏离的分析 Skill。
> 产出可复算的 PDF 报告，**每一场在售比赛都给出明确判断**。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/Node.js-%3E%3D14-brightgreen)
![Skill](https://img.shields.io/badge/type-Agent%20Skill-blue)
[![官网](https://img.shields.io/badge/%E5%AE%98%E7%BD%91-live-2F7A4F)](https://laoyangnb666.github.io/jc-football-report/)

**项目官网：[laoyangnb666.github.io/jc-football-report](https://laoyangnb666.github.io/jc-football-report/)**　（源码见 [docs/](docs/)）

---

## 这是什么

这不是「预测谁会赢」的工具，而是一套**定价与风险视角**的分析流程：

- 把赔率去水（de-vig）还原成市场隐含概率
- 用泊松 + Dixon-Coles 拟合出比分矩阵，一次性导出胜平负、让球、总进球、双方进球等市场的概率
- 把「模型概率」「盘口去水概率」「公众支持率」三者对比，找出**结构性偏离**
- 对每一场比赛写出可复算的判断，带具体选项、赔率和数字理由

核心立场：**目标是校准，不是预测。** 预测对错不重要，长期概率估准、看清抽水在哪里，才有意义。

## 核心特征

| 特征 | 说明 |
|---|---|
| **逐场综合预测** | 每场按可靠度从高到低给出：胜平负 → 总进球（区间 + 8 桶）→ 比分 top-5 分布 |
| **独立强度模型** | 用主客分离的得失球（比率法 + 样本量收缩）建立与盘口无关的概率，不再复述盘口 |
| **市场映像融合** | 市场 λ 与独立 λ 按 k=0.35 融合，λ 三个来源全部披露 |
| **回测驱动** | 每轮先用已完赛场次跑 `backtest()`，把「实际命中率 vs 盘口隐含概率」写进报告，再据此改阈值 |
| **去水定价** | 把 13%+ 的抽水还原，得到可比的市场真实概率 |
| **锐利盘口基准** | 做 value 判断时以低 margin 的锐利庄去水价为基准，不用竞彩价当基准 |
| **数据可溯源** | 每个进入模型的数字都要能追到源；追不到的不进模型，只进文字并标「待验证」 |
| **多源交叉校验** | 赔率三源对齐、伤停双源确认、xG 单一口径 |
| **只沉淀方法** | Skill 本身不含任何具体赔率、场次或结论，那些属于当次报告产出，用完即弃 |

## 快速开始

### 1. 安装 Skill

把本仓库复制到你的 agent skills 目录：

```bash
# Trae / Claude Code 全局 skill 目录
git clone https://github.com/laoyangnb666/jc-football-report.git \
  ~/.trae-cn/skills/jc-football-report
```

目录名必须是 `jc-football-report`，与 `SKILL.md` 的 frontmatter `name` 一致。

### 2. 运行核心脚本

脚本零依赖，只要有 Node.js：

```bash
node scripts/analyze.js
```

输出内置自检样例（虚构对阵，仅验证函数可运行）：

```
示例A｜关注｜主胜 2.10｜缺口 -16pp，需基本面无反向佐证
  λ= 2.73 w= 0.570 model= 45.0/27.5/27.5 bias= 0.73pp
  top5= 1-1 13.1% 2-1 9.3% 1-0 9.0% 2-0 7.9% 0-0 7.7%
  rqEV= -1.6/-18.2/-11.9
示例B｜回避｜客胜 5.50｜人气溢价 +28pp，价格不含补偿
```

### 3. 作为库调用

```js
const { predictMatch, backtest } = require('./scripts/analyze.js');

const row = {
  no: '周一004', lg: '意甲', home: '亚特兰大', away: '帕尔马',
  kickoff: '2026-11-03 03:45', hc: -1,
  spf: [1.30, 4.65, 6.45], rq: [2.07, 3.40, 2.76],
  supSPF: [78, 13, 9], zjq: [17, 7, 4.25, 3.10, 4.20, 7.20, 15, 20],
  team: {
    home: { home: {gf: 15, ga: 6, p: 5}, away: {gf: 8, ga: 9, p: 5} },
    away: { home: {gf: 7, ga: 10, p: 5}, away: {gf: 5, ga: 13, p: 5} },
    form: { home: {gf: 9, ga: 6, p: 5}, away: {gf: 4, ga: 12, p: 5} },
  },
};

const p = predictMatch(row);
console.log(p.lambdaTotal, p.w);          // 融合 λ 与主队份额
console.log(p.forecast.spf, p.forecast.goals, p.forecast.scores);
console.log(p.verdict.level, p.verdict.reason);

// 回测：把预测与实际比分对照
const bt = backtest([p], { '周一004': [3, 1] });
console.log(bt.hit);                       // 逐市场命中率
```

## 目录结构

```
jc-football-report/
├── SKILL.md                        # Skill 主入口：铁律、流程、判定规则
├── references/
│   ├── model-and-calibration.md    # 模型数学定义 + 33 场回测校准结果（改阈值看这里）
│   ├── analysis-framework.md       # 完整分析逻辑清单（八节检查表）
│   ├── data-collection.md          # 数据源清单与采集口径
│   └── report-template.md          # 报告七层结构与排版 token
├── scripts/
│   └── analyze.js                  # 去水 / Dixon-Coles / 独立强度 / 融合 / 综合预测 / 回测
├── LICENSE
└── README.md
```

## 分析方法论（七层）

| 层 | 内容 |
|---|---|
| 1 回测校准 | 上一轮逐市场命中率、实际 vs 盘口隐含、待验证项状态 |
| 2 核心定价引擎 | margin、去水、λ 三来源（市场/独立/融合）、比分矩阵、总进球逐桶 EV |
| 3 基本面情报 | 官方伤停、历史交锋、盘路、天气场地 |
| 4 市场情报 | 初盘到现价（欧赔+亚盘+大小球）、竞彩 vs 国际定价偏离、人气税 |
| 5 细分市场 | 让球盘 EV、大小球、比分与半全场原则 |
| 6 逐场综合预测 | 每场：比分 top-5 → 总进球区间与桶 → 胜平负 → 让球 → 判定 |
| 7 数据卫生 | 八条检查项逐条给状态、源清单、缺失字段、模型变更说明 |

完整字段清单见 [references/analysis-framework.md](references/analysis-framework.md)，每条都标注了 `[源]`（去哪取）与 `[用]`（进模型 / 进报告 / 仅作背景）。模型的数学定义与校准阈值见 [references/model-and-calibration.md](references/model-and-calibration.md)。

## 回测校准（33 场实测）

上一轮 42 场中已完赛的 33 场，用来量化模型有多不准：

| 口径 | 命中 | 命中率 |
|---|---|---|
| 去水概率第一方向 | 20 / 32 | **62.5%** |
| 支持率第一方向 | 17 / 32 | **53.1%** |
| 模型第一方向（焦点 7 场） | 5 / 7 | 71.4% |
| 大/小 2.5 方向 | 6 / 7 | 85.7% |
| 正确比分 top1 / top3 / top5 | 0 / 3 / 5 (共 7) | 0% / 42.9% / **71.4%** |

三条直接改变了模型设计的结论：

1. **跟随定价优于跟随人气**，相差 9.4pp；定价与资金方向相反的分歧场次中，定价方 3/3、资金方 0/3。
2. **「冷端价值小注」被证伪。** 冷端选项（Δ ≤ −8pp）实际兑现 30.0%、盘口隐含 26.3%，只高 3.7pp；30 样本标准误约 8pp。热端同样落在噪声内。Δ 不是定价信号。
3. **单一比分预测完全失效。** top1 命中 0/7。因此本 Skill 只输出带概率的 top-5 排名分布。

## 逐场判定规则

对每一场先算四个量：去水概率 `dev[i]`、缺口 `Δ[i] = 支持率 − 去水`、模型偏差 `md[i] = 模型概率 − 去水`、`ev[i] = p × odds − 1`。

| 条件 | 级别 | 输出示例 |
|---|---|---|
| SPF 未开售，仅让球盘，模型最高侧 EV > 2% | 关注 | `让球盘 客胜 3.05｜模型 29.4% vs 隐含 27.2%，EV +7.1%` |
| 支持率第一方向 ≠ 去水第一方向 | 关注 | `主胜 2.10｜资金在客胜（Δ+38pp）与定价相反，回测中此类场次定价方 3/3 命中，采信定价` |
| Δ ≥ +15pp 且模型不支持该侧 | 回避 | `主胜 1.44｜人气 +10pp，模型仅 66.8% 低于去水 67.5%，价格不含补偿` |
| Δ ≤ −8pp **且** 模型同向 **且** max\|md\| ≥ 2pp | 关注 | `客胜 3.61｜缺口 −20pp 且模型同向，EV +5.1%` |
| max\|md\| ≤ 3pp | 观望 | `观望｜模型与去水偏差 1.5pp，定价有效` |
| 其余 | 中性 | `中性｜模型偏差 3.1pp，人气 Δ 5pp，无结构性错价` |

与上一版的三处关键差异：**取消「Δ ≤ −8pp 即小注」**、**热端不是卖出理由**（只标价格不含补偿）、**新增分歧规则**。

**串关的结构性事实**：每腿 `p × odds` 恒等于 `1/(1+margin)`，margin 为 13.9% 时单腿 0.878、两串 0.771、三串 0.677。串关 EV 必然为负，倍率越高越负。报告结论固定为**单关优先**。

## 数据源

核心四层（默认必抓）：

| 层 | 源 | 用途 |
|---|---|---|
| A | 中国竞彩网 `www.lottery.gov.cn/jc/jsq/zqspf/` | 在售场次、全部玩法赔率、支持率、官方去水概率（唯一法定价基准） |
| A | 中国竞彩网 `www.sporttery.cn/jc/zqdz/` | **官方伤停与停赛一览、历史交锋近 5 次**（官方数据接口） |
| B | 捷报 `cp.nowscore.com` + `live.nowscore.com` | **主客分离得失球、联赛盘路、18 家博彩公司初盘与即时亚盘/水位/大小球、天气场地** |
| C | 直播吧 `www.zhibo8.com` | 伤停、首发、赛程、动机线索 |
| D | 联网搜索 | 官方公告、xG/xGA、天气、裁判、联赛形势 |

扩展源（按缺口启用）：球探 `zq.titan007.com`（盘路）、500 彩票网、OddsPortal / Oddspedia（跨庄变价方向）、Betfair / Smarkets（真实成交）、FBref / Understat（xG）、Sofascore / FotMob（首发）、Transfermarkt（伤停与身价）、中国天气网。

**B 层是独立模型的命脉。** 没有主客分离得失球，模型退化为盘口复述——此时必须在数据卫生层写明「独立模型缺失，本报告仅为盘口分析」。完整口径与关键词模板见 [references/data-collection.md](references/data-collection.md)。

## 核心 API

`scripts/analyze.js` 导出的函数：

| 函数 | 作用 |
|---|---|
| `devig(odds)` | 去水，返回 `{p, m, overround}` |
| `grid(lambdaTotal, w, rho)` | 12×12 泊松 + Dixon-Coles 比分网格 |
| `summarize(g)` / `topScores(g, n)` | 从网格汇总胜平负/大小球/双方进球；最高概率比分 |
| `goalBuckets(g)` / `goalIntervals(g)` | 总进球 8 桶与 4 区间 |
| `rqProb(g, hc)` | 让球盘三项概率 |
| `hafu(g)` | 半全场 9 项分布 |
| `fitFromZJQ(zjq, spf)` / `fit2D(spf)` | 市场映像：由盘口反解 λ 与 w |
| `teamStrength(home, away, form)` | **独立强度模型**：比率法 + 样本量收缩（K=8）+ 近 6 场状态（权重 0.15） |
| `blendModels(market, team, k)` | 融合，默认 k=0.35 |
| `predictMatch(row)` | **一次产出全部**：λ 三来源、比分分布、总进球桶与区间、胜平负、让球、双方进球、半全场、综合预测、判定 |
| `backtest(preds, results)` | 回测校准：逐市场命中率与盘口隐含对比 |
| `ev(p, odds)` / `combo(legs)` | 期望值 / 串关联乘 |

## 免责声明

- 本项目是**统计与定价方法论**的开源实现，仅供研究与学习使用。
- **不构成任何投注建议，不承诺任何收益。** 报告中的所有概率均为盘口与模型的推算值。
- 博彩具有极高风险，参与即可能损失全部本金。请遵守所在地区的法律法规，未满 18 周岁禁止参与。
- 数据来源为公开网站的实时快照，可能有时点误差、缺失或错误；使用者需自行复核。
- 作者不对因使用本项目产生的任何后果承担责任。

## 贡献

欢迎提交 Issue / PR：新增数据源、修正模型、补充联赛样本清洗规则、改进报告版式。

## 许可

[MIT](LICENSE)

---

## English

**jc-football-report** is an open-source Agent Skill that turns China Sports Lottery football odds into comparable probabilities, then compares model output against market-implied prices and public money flow to surface structural mispricing.

Key ideas:

- **De-vig everything.** Strip the 13%+ overround before comparing anything.
- **Price against sharp books.** Use low-margin sharp lines as the probability benchmark, not the high-margin local book.
- **Build an independent model.** Re-deriving probabilities from the odds is just restating the book. v2 fits a Dixon-Coles strength model from home/away split goal data, then blends it with the market at k=0.35.
- **Forecast in reliability order.** Every match gets 1X2 → total-goals band → top-5 correct-score distribution. **Never a single score** — top1 hit 0/7 in backtest, top5 hit 71.4%.
- **Backtest first.** Every round starts by scoring the previous round and comparing hit rates against the book's implied probabilities before any new analysis.
- **Δ is not a signal.** "Back the cold side" was falsified: cold options landed 30.0% vs 26.3% implied — inside an 8pp standard error.
- **Traceable data.** Every number in the model must trace back to a source. Untraceable numbers stay in prose, marked "unverified".
- **Skill stores method only.** No specific odds, fixtures or conclusions are committed to this repo — those belong to a single report run.

Zero runtime dependencies; requires Node.js only.

```bash
git clone https://github.com/laoyangnb666/jc-football-report.git
node jc-football-report/scripts/analyze.js
```

See [SKILL.md](SKILL.md) for the workflow, [references/model-and-calibration.md](references/model-and-calibration.md) for the model math and the 33-match backtest, and [references/data-collection.md](references/data-collection.md) for the source list.

**Disclaimer:** For research and educational purposes only. Not betting advice. No guaranteed returns. Gambling carries a high risk of losing all capital. Comply with local laws; 18+ only.

---

## 本地部署（v4.1 / Windows）

本机一套 = v4 工具链 + 两轨 Python 模型，一条命令跑完，产物全在 `data/out/`。

### 环境

| 组件 | 要求 | 本机实测 |
| --- | --- | --- |
| Node.js | ≥ 20 | v22.23.2 ✅（唯一必需，v4 工具链全靠它） |
| Python | 3.10+，可选 | 项目内 `.runtime/python/python.exe`（3.12.7 embeddable，免安装、无管理员权限），已装 numpy 2.5.4 / scipy 1.18.1 / requests |

Python 缺失时 `run.ps1` 会自动跳过两个 Python 轨并说明，v4 工具链不受影响。

### 运行

```powershell
# 方式 1：双击 run.bat（内部优先 pwsh 7，回退 Windows PowerShell）
# 方式 2：
.\run.ps1
# 方式 3：
npm run all
# 单独跑某一步
npm run collect / analyze / backtest / verify / engine / lottery
```

`run.ps1` 逐步收集退出码，任何一步非 0 都记为 exit 3 并继续后续步骤，最后汇总——不会因为 `set -e` 之类写法把中间步骤的失败吞掉。

### 五步流水线

1. `tools/collect.mjs` — 解析 `data/raw/{id}.txt`（球探分析页原文），产出 `data/out/matches.json`。竞彩 `000` 判未开；胜平负 margin 合规区间 12.5%–15.5%；进球数串按标签行定位；`近6` 行跳过行首标签再取数；亚盘初盘取自「相同盘路 初盘:」。
2. `tools/analyze.mjs` — 市场 λ 与独立输入 λ 融合，输出胜平负/让球/总进球/比分；模型不可用或 `team=null` 记 BLOCKED 并 `exit 3`。
3. `tools/backtest.mjs` — 自主结算（不复用上游 `backtest()`，它在 `devig=null` 时抛 TypeError）。
4. `tools/verify.mjs` — 五项检查：数据完整性、页面比分 vs 赛果基线、让球分档、模型 vs 市场 Brier 与方向命中、阻断条款；有 fail 则 `exit 3`。
5. `tools/bridge_engine.py` / `tools/bridge_lottery.py` — 两轨 Python 模型。

### 三轨各自的真实状态（不要混为一谈）

| 轨 | 入口 | 状态 | 有效范围 |
| --- | --- | --- | --- |
| 主模型（Node） | `analyze.mjs` | ✅ 11/11 出结果，阻断 0 | 直接面向竞彩盘口，方向与 Brier 均来自工具输出 |
| football-engine | `bridge_engine.py` | ✅ 11/11 跑通，逐场 xG 互不相同（注入生效） | 只做**同联赛内**相对强度；跨联赛时绝对得失球不可比，需降权 |
| football_lottery_prediction | `bridge_lottery.py` | ⚠️ 引擎可加载、11 场无异常，但有效维度为空 | 输入要求「多公司欧赔 + 亚盘水位」，球探页不提供 → 不可当结论用 |

### 两个已查清的桥接口径（改了会静默失效）

- **engine 的 TeamRating 不能留默认值**：`attack≈场均进球/base_goals`、`defense≈场均失球/base_goals`（`defense<1` 表示防守好），主队取主场样本、客队取客场样本。全留 1.0 会让 xG 恒等于模板值——那是静默空转，退出码仍是 0。验证信号是**逐场 xG 不同**，`bridge_engine.py` 内置这条检测，全部相同即 `exit 3`。
- **让球符号**：engine 内 `adjusted_diff = (i-j) + handicap`（主让为负），本项目对外口径主让为正，故桥接时 `handicap = -hc`。
- **lottery 的两个校验会拒绝竞彩官方赔率**：欧赔要求隐含概率和 85–110（竞彩实测 114–124）、平赔上限 6.0；亚盘要求盘口为数字（中文盘口名会被拒）且水位平衡校验需要真实双边水位。故该轨的欧赔/亚盘维度恒空——**这是输入维度缺口，不是解析错误**，不要用占位水位伪造结果。

### 已知局限（必须随结论一起给出）

1. **跨联赛强度不可比**：engine 只看各队在本联赛的主/客场得失球，欧战里「捷甲主场 16 得 6 失」与「英超客场 7 得 9 失」不在同一尺度。实测会出现模型看好主队而盘口大热客队的情况（如布拉格斯巴达），此处分歧应采信定价方。
2. **让球统计有两种口径**：`verify.mjs` 的「分档赢/走/输」按**主队净胜球**统计，`backtest.mjs` 的「让球盘命中率」按**推荐方向**统计。同批 11 场前者主队赢盘 1 / 输盘 9，后者命中 7/11，两个数字都对，但不可互相替代。
3. **λ 融合权重 `K_BLEND=0.35` 与 `fitFromZJQ/fit2D` 两条拟合路径尚未定版**，新旧基线不可直接对比。