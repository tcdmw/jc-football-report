// test_settle.mjs — 通用亚盘结算函数单元测试（断言，不输出文件）
function settleInt(margin, line) {
  if (margin > line) return 1;
  if (margin === line) return 0;
  return -1;
}
function settleHandicap(margin, line) {
  const q4 = Math.round(line * 4);
  if (q4 % 2 === 1) {
    const lo = line - 0.25, hi = line + 0.25;
    return (settleInt(margin, lo) + settleInt(margin, hi)) / 2;
  }
  return settleInt(margin, line);
}
// [盘口, 让球方净胜, 期望上盘结果]
const cases = [
  [0, 1, 1], [0, 0, 0], [0, -1, -1],
  [0.25, 1, 1], [0.25, 0, -0.5], [0.25, -1, -1],
  [0.5, 1, 1], [0.5, 0, -1], [0.5, -1, -1],
  [0.75, 2, 1], [0.75, 1, 0.5], [0.75, 0, -1], [0.75, -1, -1],
  [1, 2, 1], [1, 1, 0], [1, 0, -1],
  [1.25, 2, 1], [1.25, 1, -0.5], [1.25, 0, -1],
  [1.5, 2, 1], [1.5, 1, -1],
  [1.75, 3, 1], [1.75, 2, 0.5], [1.75, 1, -1],
  [2, 3, 1], [2, 2, 0], [2, 1, -1],
];
let fail = 0;
for (const [line, margin, expect] of cases) {
  const got = settleHandicap(margin, line);
  if (got !== expect) { console.log('FAIL', line, margin, '期望', expect, '实际', got); fail++; }
}
console.log(fail === 0 ? `全部 ${cases.length} 条断言 PASS` : `${fail} 条失败`);
process.exit(fail ? 1 : 0);
