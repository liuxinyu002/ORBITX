/// 系统 API 层单次抓取最大字符数（宽松上限，为 token 截断留余量）
pub const MAX_RAW_CHARS: usize = 10000;

/// token 估算上限，超出部分会被截断并通知前端
pub const MAX_GRAB_TOKENS: usize = 2000;

/// 快捷键 A — 静默提取
pub const SHORTCUT_SILENT_EXTRACT: &str = "CmdOrCtrl+Shift+E";

/// 快捷键 B — 唤出命令面板
pub const SHORTCUT_COMMAND_PALETTE: &str = "CmdOrCtrl+Shift+Space";
