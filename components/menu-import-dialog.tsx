"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { db } from "@/lib/db";
import { Modal } from "@/components/ui/modal";
import { generateImportTemplate } from "@/lib/menu-import-template";
import { parseImportFile, type ImportPreview } from "@/lib/menu-import-parser";
import { executeImport, type ImportResult } from "@/lib/menu-import-writer";
import { hasSpace } from "@/lib/space-ops";
import {
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Tag,
  Info,
} from "lucide-react";

type Phase = "idle" | "parsing" | "preview" | "writing" | "done";

interface MenuImportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MenuImportDialog({ open, onClose }: MenuImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [errorListOpen, setErrorListOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Block browser navigation during writing
  useEffect(() => {
    if (phase !== "writing") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const blob = await generateImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "菜单导入模板.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Generate import template failed", err);
      setErrorMsg("生成模板失败，请重试");
    }
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";

      setPhase("parsing");
      setErrorMsg("");

      try {
        // Query fresh data at parse time for accurate dedup
        const [currentItems, currentTags] = await Promise.all([
          db.menuItems.toArray(),
          db.tags.toArray(),
        ]);
        const parsed = await parseImportFile(file, currentItems, currentTags);
        setPreview(parsed);
        setErrorListOpen(parsed.toImport.length === 0 && parsed.errors.length > 0);
        setPhase("preview");
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : "文件解析失败，请检查文件格式"
        );
        setPhase("idle");
      }
    },
    []
  );

  const handleConfirmImport = useCallback(async () => {
    if (!preview) return;
    setPhase("writing");
    setErrorMsg("");

    try {
      const importResult = await executeImport(preview);
      setResult(importResult);
      setPhase("done");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "导入写入失败，请重试"
      );
      setPhase("done");
    }
  }, [preview]);

  const handleClose = useCallback(() => {
    if (phase === "writing") return; // Block close during writing
    setPhase("idle");
    setPreview(null);
    setResult(null);
    setErrorMsg("");
    setErrorListOpen(false);
    onClose();
  }, [phase, onClose]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="批量导入菜单"
      fullScreen
      footer={
        phase === "idle" ? (
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={handleClose}
              className="flex-1 sm:flex-none rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition"
            >
              关闭
            </button>
          </div>
        ) : phase === "preview" && preview ? (
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={handleClose}
              className="flex-1 sm:flex-none rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition"
            >
              取消
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={preview.toImport.length === 0}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              确认导入（{preview.toImport.length} 项）
            </button>
          </div>
        ) : phase === "done" ? (
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={handleClose}
              className="flex-1 sm:flex-none rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition"
            >
              关闭
            </button>
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        {/* IDLE state */}
        {phase === "idle" && (
          <>
            {errorMsg && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errorMsg}
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleDownloadTemplate}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm font-medium hover:bg-muted/50 transition"
              >
                <Download className="w-5 h-5" />
                下载导入模板
              </button>

              <div className="text-center text-xs text-muted-foreground">
                或
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
              >
                <Upload className="w-5 h-5" />
                选择 Excel 文件上传
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1.5 text-xs text-muted-foreground">
              <div className="font-medium text-foreground text-sm">格式说明</div>
              <div>支持 .xlsx 格式</div>
              <div>类型列填写「菜谱」或「外卖」</div>
              <div>标签用中英文逗号分隔</div>
              <div>材料格式：名称|数量|单位（每行一种）</div>
              <div>文件大小限制 5MB，最多 500 行</div>
              {hasSpace() && (
                <div className="text-amber-600 pt-1">
                  当前已加入共享空间，导入数据会自动同步到其他设备
                </div>
              )}
            </div>
          </>
        )}

        {/* PARSING state */}
        {phase === "parsing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground">正在解析文件…</div>
          </div>
        )}

        {/* PREVIEW state */}
        {phase === "preview" && preview && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-emerald-50 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-emerald-700">
                  {preview.toImport.length}
                </div>
                <div className="text-xs text-emerald-600">可导入</div>
              </div>
              <div className="rounded-lg border bg-amber-50 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-amber-700">
                  {preview.skipped.length}
                </div>
                <div className="text-xs text-amber-600">将跳过</div>
              </div>
              <div className="rounded-lg border bg-red-50 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-red-700">
                  {preview.errors.length}
                </div>
                <div className="text-xs text-red-600">错误</div>
              </div>
              <div className="rounded-lg border bg-blue-50 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-blue-700">
                  {preview.newTags.length}
                </div>
                <div className="text-xs text-blue-600">新标签</div>
              </div>
            </div>

            {/* Importable items */}
            {preview.toImport.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">待导入项</div>
                <div className="rounded-lg border bg-background max-h-40 overflow-y-auto">
                  {preview.toImport.map((row) => (
                    <div
                      key={`${row.kind}-${row.name}-${row.rowIndex}`}
                      className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 text-sm"
                    >
                      <span
                        className={
                          row.kind === "recipe"
                            ? "text-orange-600"
                            : "text-blue-600"
                        }
                      >
                        {row.kind === "recipe" ? "菜谱" : "外卖"}
                      </span>
                      <span className="font-medium">{row.name}</span>
                      {row.weight !== 1 && (
                        <span className="text-xs text-muted-foreground">
                          w{row.weight}
                        </span>
                      )}
                      {row.shop && (
                        <span className="text-xs text-muted-foreground truncate">
                          {row.shop}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skipped */}
            {preview.skipped.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1 text-sm font-semibold text-amber-700">
                  <Info className="w-4 h-4" />
                  {preview.skipped.length} 项将跳过
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 max-h-40 overflow-y-auto">
                  {preview.skipped.map((item, i) => (
                    <div
                      key={`${item.row.kind}-${item.row.name}-${item.row.rowIndex}-${i}`}
                      className="px-3 py-2 border-b border-amber-100 last:border-b-0 text-xs text-amber-700"
                    >
                      <span className="font-medium">第 {item.row.rowIndex} 行：</span>
                      {item.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors */}
            {preview.errors.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setErrorListOpen(!errorListOpen)}
                  className="flex items-center gap-1 text-sm font-semibold text-destructive"
                >
                  <AlertCircle className="w-4 h-4" />
                  {preview.errors.length} 项错误
                  {errorListOpen ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                {errorListOpen && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 max-h-40 overflow-y-auto">
                    {preview.errors.map((err, i) => (
                      <div
                        key={i}
                        className="px-3 py-2 border-b last:border-b-0 last:rounded-b-lg text-xs text-destructive"
                      >
                        {err.rowIndex > 0 && (
                          <span className="font-medium">第 {err.rowIndex} 行：</span>
                        )}
                        {err.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* New tags */}
            {preview.newTags.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1 text-sm font-semibold">
                  <Tag className="w-4 h-4" />
                  将创建的新标签
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.newTags.map((tag, i) => (
                    <span
                      key={`${tag.name}-${tag.type}-${i}`}
                      className="rounded-full border px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border-blue-200"
                    >
                      {tag.name}
                      <span className="text-blue-400 ml-1">
                        ({tag.type === "cuisine"
                          ? "菜系"
                          : tag.type === "category"
                          ? "类别"
                          : "自定义"})
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* WRITING state */}
        {phase === "writing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground">
              正在写入…请勿关闭此窗口
            </div>
          </div>
        )}

        {/* DONE state */}
        {phase === "done" && (
          <>
            {errorMsg ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {errorMsg}
                </div>
                <button
                  onClick={handleClose}
                  className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition"
                >
                  关闭
                </button>
              </div>
            ) : result ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle className="w-6 h-6" />
                  <span className="text-lg font-semibold">导入完成</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-background p-3 text-center">
                    <div className="text-2xl font-bold tabular-nums">
                      {result.importedCount}
                    </div>
                    <div className="text-xs text-muted-foreground">成功导入</div>
                  </div>
                  <div className="rounded-lg border bg-background p-3 text-center">
                    <div className="text-2xl font-bold tabular-nums">
                      {result.tagCreatedCount}
                    </div>
                    <div className="text-xs text-muted-foreground">新标签</div>
                  </div>
                </div>

                {(result.skippedCount > 0 || result.errorCount > 0) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border bg-background p-3 text-center">
                      <div className="text-2xl font-bold tabular-nums">
                        {result.skippedCount}
                      </div>
                      <div className="text-xs text-muted-foreground">已跳过</div>
                    </div>
                    <div className="rounded-lg border bg-background p-3 text-center">
                      <div className="text-2xl font-bold tabular-nums">
                        {result.errorCount}
                      </div>
                      <div className="text-xs text-muted-foreground">未导入</div>
                    </div>
                  </div>
                )}

                {result.errorCount > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    {result.errorCount} 项未能导入（已在预览中显示原因）
                  </div>
                )}

                {hasSpace() && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    数据已加入同步队列，将自动同步到其他设备
                  </div>
                )}

                <button
                  onClick={handleClose}
                  className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
                >
                  完成
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
