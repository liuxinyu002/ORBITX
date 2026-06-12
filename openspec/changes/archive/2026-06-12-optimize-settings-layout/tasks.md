## 1. Root Layout Fix

- [x] 1.1 Add `min-h-0` to `<main>` element in `src/routes/__root.tsx` to enable correct overflow scrolling in flex children

## 2. Settings Page Layout Refactor

- [x] 2.1 Remove Card/CardHeader/CardContent/CardFooter imports from `src/routes/settings.tsx`
- [x] 2.2 Replace outer wrapper (`flex flex-col items-center px-4 py-8`) with `h-full flex` horizontal flex container
- [x] 2.3 Add left sidebar (`<aside>`) with `w-64 shrink-0 border-r border-slate-200 p-4 overflow-y-auto`, containing single "AI 模型连接" nav item with active state styling (`bg-slate-100` + bold)
- [x] 2.4 Add right content area (`flex-1 overflow-y-auto p-8 md:p-12`) with inner `max-w-4xl` wrapper
- [x] 2.5 Move page title "AI 模型连接设置" to right content area header with `text-2xl font-semibold`
- [x] 2.6 Replace CardFooter with `<div className="mt-12 pt-6 border-t border-slate-200 flex justify-between items-center">` for action buttons
- [x] 2.7 Verify all existing functionality: tab switching, form editing, model chip selection, connection test, save/reset/cancel

## 3. Verification

- [x] 3.1 Run `npm run build` (or equivalent) to verify no TypeScript/import errors
- [x] 3.2 Visually inspect the page to confirm: sidebar renders, content scrolls independently, no Card visual artifacts remain
