## ADDED Requirements

本变更不引入新能力，不改动现有 spec 级别的行为约定。三个修复均在现有 spec 要求范围内的实现层纠正：

- **坐标修正**：符合 `floating-overlay` spec 中"overlay 定位在光标附近"的要求，仅修正 Windows 平台的坐标系转换
- **Focus 锁定**：符合 `floating-overlay` spec 中"overlay 弹出并获取焦点"的要求，确保 Windows 平台焦点稳定
- **防抖隐藏**：符合 `floating-overlay` spec 中"失焦自动隐藏"的要求，仅增加防抖延时防止瞬时误触发
