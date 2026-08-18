#!/usr/bin/env node
// 把根目錄的 api-core.js 同步到 functions/api-core.js。
//
// Firebase Cloud Functions 部署時只會上傳 firebase.json 指定的 functions/ 目錄，
// 無法 import 目錄外的模組，所以 functions/api-core.js 必須是一份實體副本。
// 這支腳本讓「副本」變成自動產生的結果，而不是靠人記得手動複製。
//
//   node scripts/sync-api-core.mjs           複製（有變動才寫入）
//   node scripts/sync-api-core.mjs --check   只檢查，不一致就以 exit code 1 結束

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "api-core.js");
const target = path.join(root, "functions", "api-core.js");
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

const checkOnly = process.argv.includes("--check");

const sourceText = await readFile(source, "utf8");
let targetText = null;
try {
  targetText = await readFile(target, "utf8");
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

if (targetText === sourceText) {
  console.log(`[sync-api-core] ${rel(target)} 已與 ${rel(source)} 一致。`);
  process.exit(0);
}

if (checkOnly) {
  const reason = targetText === null ? "檔案不存在" : "內容與來源不同";
  console.error(`[sync-api-core] ${rel(target)} ${reason}。`);
  console.error(`[sync-api-core] 請執行 \`npm run sync:functions\` 後再部署或提交。`);
  process.exit(1);
}

await writeFile(target, sourceText);
console.log(`[sync-api-core] 已將 ${rel(source)} 複製到 ${rel(target)}。`);
