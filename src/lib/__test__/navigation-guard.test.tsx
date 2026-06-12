/// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  NavigationGuardProvider,
  useNavigationGuard,
} from "../navigation-guard";

describe("NavigationGuardProvider", () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    return <NavigationGuardProvider>{children}</NavigationGuardProvider>;
  }

  // CP-19: 默认无守卫 → checkGuard 返回 true
  it("checkGuard returns true when no guard set", async () => {
    const { result } = renderHook(() => useNavigationGuard(), { wrapper });
    const ok = await act(() => result.current.checkGuard());
    expect(ok).toBe(true);
  });

  // CP-19: 注册守卫 → checkGuard 调用守卫函数
  it("checkGuard invokes registered guard", async () => {
    const { result } = renderHook(() => useNavigationGuard(), { wrapper });

    let called = false;
    act(() => {
      result.current.setGuard(async () => {
        called = true;
        return false;
      });
    });

    const ok = await act(() => result.current.checkGuard());
    expect(called).toBe(true);
    expect(ok).toBe(false);
  });

  // CP-19: 守卫返回 true → 导航放行
  it("checkGuard returns true when guard allows", async () => {
    const { result } = renderHook(() => useNavigationGuard(), { wrapper });

    act(() => {
      result.current.setGuard(async () => true);
    });

    const ok = await act(() => result.current.checkGuard());
    expect(ok).toBe(true);
  });

  // CP-19: 清除守卫 → checkGuard 恢复默认 true
  it("checkGuard returns true after guard cleared", async () => {
    const { result } = renderHook(() => useNavigationGuard(), { wrapper });

    act(() => {
      result.current.setGuard(async () => false);
    });
    act(() => {
      result.current.setGuard(null);
    });

    const ok = await act(() => result.current.checkGuard());
    expect(ok).toBe(true);
  });
});
