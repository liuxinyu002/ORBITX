import { Component, type ReactNode } from "react";
import Header from "./Header";
import { log } from "@/lib/logger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    log("error", "react", `渲染异常: ${error.message} ${errorInfo.componentStack || ""}`);
  }

  render() {
    if (this.state.hasError) {
      return (
        <>
          <Header />
          <main className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
            <h1 className="text-lg font-medium text-brand-dark">
              应用遇到问题
            </h1>
            <p className="text-sm text-muted-foreground">
              请通过系统托盘退出并重启应用
            </p>
          </main>
        </>
      );
    }

    return this.props.children;
  }
}
