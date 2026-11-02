"use client";

import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSession } from "../session-provider";
import { ADD_FILES_EVENT } from "../session-toolbar";

const ACCEPT = ".xlsx,.xls,.csv";

export function Dropzone({ compact = false }: { compact?: boolean }) {
  const { upload, busy, uploadProgress, meta } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const maxMb = meta?.limits.maxFileSizeMb ?? 15;

  useEffect(() => {
    const open = () => input.current?.click();
    window.addEventListener(ADD_FILES_EVENT, open);
    return () => window.removeEventListener(ADD_FILES_EVENT, open);
  }, []);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      const files = Array.from(list);
      const bad = files.filter((f) => !/\.(xlsx|xls|csv)$/i.test(f.name));
      const big = files.filter((f) => f.size > maxMb * 1024 * 1024);
      if (bad.length) toast.error(`Unsupported file type: ${bad.map((f) => f.name).join(", ")}. Use .xlsx, .xls or .csv.`);
      if (big.length) toast.error(`Larger than ${maxMb} MB: ${big.map((f) => f.name).join(", ")}. Split the export into smaller files.`);
      const ok = files.filter((f) => !bad.includes(f) && !big.includes(f));
      if (ok.length) void upload(ok);
    },
    [upload, maxMb],
  );

  const uploading = uploadProgress !== null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) handle(e.dataTransfer.files);
      }}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed text-center transition-colors",
        compact ? "px-4 py-6" : "px-6 py-12",
        over ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50",
      )}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        aria-label="Choose Excel or CSV files"
        data-testid="file-input"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        {uploading ? <FileSpreadsheet className="size-5" aria-hidden /> : <UploadCloud className="size-5" aria-hidden />}
      </span>
      {uploading ? (
        <div className="w-full max-w-sm space-y-2" role="status" aria-live="polite">
          <p className="text-sm font-medium">{uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : "Reading and validating files…"}</p>
          <Progress value={uploadProgress} aria-label="Upload progress" />
        </div>
      ) : (
        <>
          <div>
            <p className="font-medium">Drag & drop your lead exports here</p>
            <p className="text-sm text-muted-foreground">
              SalesMax CRM or lead-provider files · .xlsx, .xls, .csv · up to {maxMb} MB each · several files at once
            </p>
          </div>
          <Button onClick={() => input.current?.click()} disabled={Boolean(busy)}>
            Choose files
          </Button>
        </>
      )}
    </div>
  );
}
