## 1. 前端递归格式化

- [x] 1.1 重写 `renderFieldValue`：移除 `<pre>` JSON block 分支，数组值逗号拼接，对象值 `key: val` 逗号分隔，原子值保持不变
- [ ] 1.2 验证：构造含嵌套对象 `{addr:{city:"NY"}}` 和嵌套数组 `{tags:["a","b"]}` 的测试数据，确认展开面板不再出现 `[object Object]`

## 2. 数组 result_json 前端渲染

- [x] 2.1 修改 `getFieldValue`：移除 `Array.isArray()` 时直接返回 `undefined` 的逻辑，改为对数组返回摘要标记
- [x] 2.2 表格单元格检测到数组 `result_json` 时渲染 `[包含 N 项数据]` 摘要（使用 `text-muted-foreground` token）
- [x] 2.3 展开面板增加数组分支：按序号渲染 `第 1 项` / `第 2 项` ...，每项内部复用 `<dl>` 键值对渲染
- [ ] 2.4 验证：准备数组 `result_json` 的测试任务，确认表格显示摘要标记，展开面板按序号列出所有项
- [x] 2.5 `getFieldValue` 检测到数组时添加 `log("debug", "data-browser", ...)` 记录数组长度，便于排查渲染异常

## 3. 动画机制清理

- [x] 3.1 移除 `newRowIdsRef` + `setNewRowTick`，改为 `useState<Set<string>>` 管理新行 ID
- [x] 3.2 移除 `deletingIdsRef` + `setDeletingTick` + `setTimeout(150ms)`，改为 `useState<Set<string>>` + `onAnimationEnd` 回调驱动删除
- [x] 3.3 `onAnimationEnd` 添加 200ms `setTimeout` fallback 兜底
- [ ] 3.4 验证：模拟新行到达和删除操作，确认动画正常播放且行正确移除

## 4. 颜色归一化

- [x] 4.1 DataBrowser.tsx：替换所有硬编码 Hex 和 `dark:` 前缀为对应 token（`bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`）
- [x] 4.1a index.tsx：`bg-[#F3F4F7]` → `bg-background`（task 4.3 grep 范围覆盖该文件）
- [x] 4.2 dashboard.tsx：`text-brand-dark` → `text-foreground`，确保复用项目 token
- [x] 4.3 验证：`grep -rn '#[0-9a-fA-F]\{6\}' src/routes/tools/structured-extractor/ src/routes/dashboard.tsx` 无匹配

## 5. Rust 导出层数组展平

- [x] 5.1 提取公共展平函数：`fn flatten_row(parsed: &Value, headers: &[String]) -> Vec<Vec<String>>`，对象返回 1 行，数组返回 N 行
- [x] 5.1a `flatten_row` 对单行数组元素数添加上限校验（`MAX_ELEMENTS_PER_ROW=1000`），超限截断并记录 `warn` 日志，防止 `MAX_EXPORT_ROWS × 数组元素数` 导致 OOM
- [x] 5.2 `write_csv` 集成 `flatten_row`，替代当前逐行 `parsed.get(header)` 逻辑
- [x] 5.3 `write_xlsx` 集成 `flatten_row`，替代当前逐行 `parsed.get(header)` 逻辑
- [x] 5.4 导出日志中记录实际写入行数（可能与 DB 行数不同）
- [x] 5.5 单元测试：数组展平、空数组、非对象元素、单对象（回归）
- [x] 5.6 `flatten_row` 中对 `result_json` 解析失败（`Value::Null` 分支）记录 `warn` 日志，避免静默产生空行
- [x] 5.7 `export_data` 完成时记录导出耗时（`elapsed_ms`），便于诊断大批量展平导致的性能问题

## 6. 验证

- [x] 6.1 `cargo test` 通过（extraction 模块单元测试）
- [x] 6.2 `tsc --noEmit` 通过（前端类型检查）
- [ ] 6.3 手动测试：创建提取任务，构造返回数组的 `result_json`，验证表格渲染、展开面板、CSV 导出、XLSX 导出
