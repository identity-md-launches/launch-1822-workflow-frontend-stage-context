import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadDeployment } from "./config";
import { AppProvider } from "./context";
import App from "./App";
import "./styles.css";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="boot-error">
        <h1>页面暂时不可用</h1>
        <p>The app could not render. Reload to try again.</p>
        <button onClick={() => location.reload()}>重新加载 / Reload</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const root = createRoot(document.getElementById("root")!);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
});
loadDeployment()
  .then((runtime) =>
    root.render(
      <ErrorBoundary>
        <WagmiProvider config={runtime.walletConfig}>
          <QueryClientProvider client={queryClient}>
            <AppProvider runtime={runtime}>
              <App />
            </AppProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </ErrorBoundary>,
    ),
  )
  .catch((e) =>
    root.render(
      <div className="boot-error">
        <img src="./favicon.svg" width="48" height="48" alt="" />
        <h1>IMD 红包</h1>
        <p role="alert">
          {e instanceof Error
            ? e.message
            : "无法验证部署 / Unable to verify deployment"}
        </p>
        <p>
          未完成验证前，交易不可用。Transactions stay unavailable until
          verification succeeds.
        </p>
        <button onClick={() => location.reload()}>重新加载 / Retry</button>
      </div>,
    ),
  );
