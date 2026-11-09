# 本地足球预测 · 部署与验证报告

生成时间：2026-11-07　|　机器：本机 Windows　|　批次：11-06 欧联/欧协联（11 场）

> 本文所有数字均来自工具输出（`collect` / `analyze` / `backtest` / `verify` / `bridge_engine` / `bridge_lottery`），无手算。
> 未跑通或无效的部分在文中如实标注，不宣称"验证通过"。

---

## 一、这套东西现在是什么

一条命令跑完的本地流水线：**页面原文解析 → 双输入建模 → 自主结算回测 → 五项自检 → engine 独立模型轨**，产物全部落在 `data/out/`。

```
double-click run.bat        (或 .\run.ps1 / npm run all)
  ├─ tools/collect.mjs        data/raw/*.txt → data/out/matches.json
  ├─ tools/analyze.mjs        matches.json → preds.json（市场 λ + 独立 λ 融合）
  ├─ tools/backtest.mjs       preds.json + results → 逐场结算与命中率
  ├─ tools/verify.mjs         五项校验，fail 即 exit 3
  ├─ tools/bridge_engine.py   注入独立强度 → engine_preds.json（football-engine 轨）
  └─ tools/bridge_lottery.py  → lottery_preds.json（第三轨，见 §五 的有效性说明）
```

## 二、环境：本机原有 / 本轮自建

| 组件 | 来源 | 状态 |
| --- | --- | --- |
| Node.js v22.23.2 | 本机已有 | ✅ 唯一硬依赖 |
| Python 3.12.7（embeddable） | 本轮从华为云镜像自建 `https://mirrors.huaweicloud.com/python/3.12.7/python-3.12.7-embed-amd64.zip`（11,062,583 B，21124619 B/s） | ✅ `.runtime/python/python.exe`，免安装、无管理员权限 |
| pip 26.3 | `get-pip.py`（2,397,294 B） | ✅ 改 `python312._pth` 启用 site-packages |
| numpy 2.5.4 / scipy 1.18.1 / requests | 清华镜像 pip | ✅ |
| football-engine | `wlrwx/football-engine` 按需拉取 raw 文件（仓库真实 4094 文件 / 94,418,447 B，整包 codeload 必超时） | ✅ 31 文件 / 184,086 B，`ok=31 fail=0` |
| football_lottery_prediction | `bigdatatoai/football_lottery_prediction` | ✅ 12 文件，引擎可加载 |

## 三、六步执行结果（本轮实跑）

| 步骤 | 结果 | 退出码 |
| --- | --- | --- |
| collect | 11 场；胜平负 10 + 竞彩未开 1；总进球 10；让球 11；独立输入 11；页面比分 11 | 0 |
| analyze | 11 场；阻断 0；问题 1（本菲卡 `000` 无竞彩胜平负） | 0 |
| backtest | 见 §四 | 0 |
| verify | `PASS — 全部检查通过`（数据完整性 / 页面比分 vs 赛果 11/11 一致 / 让球分档 / 精度 / 阻断条款 0） | 0 |
| bridge_engine | 11 场，跳过 0，逐场 xG 互不相同（注入生效） | 0 |
| bridge_lottery | 11 场，失败 0，但欧赔/亚盘维度为空（见 §五） | 0 |

整链 `run.ps1` 汇总：**全部步骤 exit 0**。

## 四、回测成绩（11 场，自主结算）

```
[backtest] n=11（有赛果）| 有欧赔 10
  方向命中 模型 4/11 = 36.4%
  方向命中 市场 3/10 = 30.0%
  让球盘    7/11 = 63.6%
  大小 2.5  5/11 = 45.5%
  总进球档位 2/11 | 区间 6/11 = 54.5%
  比分 top1 2/11 | top3 4/11 | top5 5/11
  Brier 模型 0.7752 | Brier 市场 0.8171
```

逐场（比分 / 模型方向 / 市场方向 / 让球结算 net / Brier）：

| # | 主队 | 客队 | 比分 | 模型 | 市场 | 让球(net) | Brier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 布拉格斯巴达 | 伯恩茅斯 | 1-3 | 客 | 客 | 赢 -1（押客） | 0.201 |
| 2 | 水晶宫 | 霍芬海姆 | 1-1 | 主 | 主 | 输 -0.5（押主） | 0.914 |
| 3 | 奈梅亨 | 奥莫尼亚 | 3-1 | 主 | 主 | 赢 1.25（押主） | 0.357 |
| 4 | 皇家社会 | 里昂 | 1-1 | 主 | 主 | 输 -0.5（押主） | 0.960 |
| 5 | AC米兰 | 费伦茨瓦罗斯 | 0-2 | 主 | 主 | 赢 -3.5（押客） | 1.311 |
| 6 | 特拉布宗体育 | 弗赖堡 | 0-1 | 主 | 主 | 输 -1（押主） | 0.759 |
| 7 | 塞尔塔 | 圣吉罗斯联合 | 1-2 | 主 | 主 | 赢 -1.5（押客） | 0.611 |
| 8 | 桑德兰 | 萨格勒布迪纳摩 | 0-2 | 主 | 主 | 赢 -3.25（押客） | 1.188 |
| 9 | 勒沃库森 | 马赛 | 0-1 | 主 | 主 | 赢 -2.25（押客） | 1.301 |
| 10 | 阿尔克马尔 | 尤文图斯 | 1-2 | 客 | 客 | 赢 -0.5（押客） | 0.375 |
| 11 | 本菲卡 | 波兹南莱赫 | 3-1 | 主 | --（未开） | 输 0（押客） | 0.550 |

**口径提醒**：`verify` 的"让球分档"按主队净胜球统计（本轮主队赢盘 1 / 走 1 / 输 9），`backtest` 的"让球盘 7/11"按推荐方向统计。两个数字都对，不可互相替代。

## 五、三轨有效性（这是本报告最重要的一节）

| 轨 | 状态 | 能用来做什么 / 不能用来做什么 |
| --- | --- | --- |
| **主模型（Node）** | ✅ 11/11 出结果，阻断 0 | 唯一可直接面向竞彩盘口给方向的轨；方向 4/11、Brier 0.7752 均优于市场（3/10、0.8171） |
| **football-engine** | ✅ 11/11 跑通，xG 逐场不同 | 只能做**同联赛内**相对强度；跨联赛绝对得失球不可比（见下） |
| **football_lottery_prediction** | ⚠️ 引擎可加载、11 场无异常，但**有效维度为空** | 不能当结论用。它的欧赔/亚盘维度被自身校验全部拒收 |

### engine 轨的实测形态

```
no 主队             xG(主:客)     H-D-A%
 1 布拉格斯巴达      3.38:1.88   66.4/15.2/18.4
 2 水晶宫          1.41:2.91   15.6/16.6/67.8
 5 AC米兰          1.82:1.79   39.1/23.3/37.6
11 本菲卡          2.23:1.42   55.3/21.4/23.2
```

**跨联赛强度不可比的实证**：第 1 场主队斯巴达（捷甲主场 6 场 16 得 6 失）被 engine 判为强于伯恩茅斯（英超客场 4 场 7 得 9 失），xG 3.38:1.88；而盘口 7.45/5.40/1.22 明确指向客队大热。原因是两套联赛的得失球不在同一尺度——engine 不知道"捷甲 vs 英超"的联赛水平差。此类分歧应按既定规则**采信定价方**。

### lottery 轨为什么空（根因已定位，不是解析 bug）

自己读源码后实测出三条硬约束：

1. `_validate_european_odds_values` 要求隐含概率和 `sum(1/odds)*100 ∈ [85, 110]`；竞彩官方实测 **114–124**（如 7.45/5.40/1.22 → 123.9），全部被拒。
2. 同一函数要求平局赔率 `2.5 ≤ draw ≤ 6.0`；竞彩高平赔场次（5.40、5.75）即使按比例重标定也会越界（缩放到能通过"和≤110"的尺度后，平赔会变成 6.3）。
3. 亚盘要求盘口为**数字**（`_validate_asian_handicap_value` 对中文盘口名直接 `float()` 失败），且 `_validate_asian_odds_balance(1.90, 1.90)` 不通过——它需要真实的双边水位，而球探分析页只给"初盘:受让一球"这类文字，没有水位。

结论：该轨的设计前提是"多公司欧赔 + 亚盘双边水位"，本地可得数据是"竞彩官方单一赔率 + 球探初盘文字"，**输入维度结构性不足**。按"缺独立输入即阻断"的既定口径，该轨输出只能标注为无效，不得用 1.90 占位水位伪造成"跑通"。

## 六、本轮修掉的问题（都是真缺陷）

1. **`package.json` 的 `"type": "module"` 导致整链崩**：上游 `scripts/analyze.js` 是 CommonJS（`module.exports`），被当成 ESM 加载后 `ReferenceError: module is not defined`。→ 删掉该字段（`.mjs` 本身即 ESM，不需要它）。
2. **`run.ps1` 里 backtest 参数顺序错**：该脚本签名是 `<preds> <results>`，原写法传了 matches → `TypeError: preds is not iterable`。→ 改为 `preds.json` 在前。
3. **`run.ps1` 中文被旧版 PowerShell 按 ANSI 解码**：UTF-8 无 BOM + `powershell` 5.1 → 引号/括号解析错乱。→ 写入 UTF-8 **BOM**，并让 `run.bat` 优先 `pwsh`、回退 `powershell`。
4. **`run.bat` 的 ASCII 写入把中文注释变成 `?`**：→ 注释改英文，文件保持纯 ASCII。
5. **Python 依赖缺失**：`requests` 未装导致 lottery 模块加载告警 → 已装；核心计算只需 numpy/scipy。
6. **engine 整包下载必超时**（18MB / 25KB·s⁻¹，四次尝试只到 4.7MB，ZIP 尾缺中央目录）→ 用 GitHub tree API（4094 文件清单）+ raw CDN 逐文件拉取，`ok=31 fail=0`。

## 七、尚未定版、需要拍板的三件事

1. **`analyze.mjs` 的 λ 拟合路径**：`fit2D(spf)` 得 λTotal=**3.84**，`fitFromZJQ(zjq, spf)` 得 **3.22**，两条路径并存且都能复现。旧 Linux 基线用的是哪条尚未确认，因此新旧 Brier 不可直接对比。建议定版一条作为回归口径。
2. **融合权重 `K_BLEND=0.35`** 是否需要按本轮 11 场重新校准。
3. **`spf=null`（竞彩未开）是否硬性禁止出方向**：当前本菲卡仍输出了模型方向"主"（3-1 命中），但按最严口径应标为不可用。现在只记为"问题"，未强制阻断。

## 八、复现方式

```powershell
cd jc-football-report-main
.\run.ps1                       # 全链
node tools/verify.mjs           # 只看自检
tools\py.cmd tools\bridge_engine.py data/out/matches.json data/out/engine_preds.json
```

数据位置：`data/raw/{id}.txt`（球探分析页原文，11 场）｜`data/test/meta_1146_11.json`（场次元数据）｜`data/test/results_1146_11.json`（赛果基线）。

## 九、免责

仅供研究与统计方法验证，不构成投注建议，不承诺任何收益。
