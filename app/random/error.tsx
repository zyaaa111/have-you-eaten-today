"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/error-monitor";

export default function RandomError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError({ type: "error", message: error.message, stack: error.stack, context: { digest: error.digest, page: "random" } });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-xl font-semibold text-gray-800">抽选页面出错了</h2>
      <p className="text-sm text-gray-500">无法加载抽选功能，请稍后再试</p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
        >
          重试
        </button>
        <a
          href="/"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          返回首页
        </a>
      </div>
    </div>
  );
}
