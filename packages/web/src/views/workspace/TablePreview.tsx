import { useMemo, useState } from "react";

import type { S3Object } from "@athena-shell/shared";

import { VirtualTable } from "../../components/VirtualTable";
import {
  ErrorPanel,
  LoadingPanel,
  ParseErrorChip,
  RawToggle,
} from "./FilePreview";
import { isFailure, parseDelimited, parseJsonLines } from "./previewParsers";
import { TextBody, useTextContent } from "./TextPreview";

interface Props {
  file: S3Object;
  /** csv: ",", tsv: "\t", jsonl: null */
  delimiter: string | null;
}

export function TablePreview({ file, delimiter }: Props) {
  const [raw, setRaw] = useState(false);
  const content = useTextContent(file.key);
  const parsed = useMemo(
    () => (content.state === "ready" ? parseFor(delimiter, content.value.text) : null),
    [content, delimiter]
  );

  if (content.state === "loading") return <LoadingPanel />;
  if (content.state === "error") return <ErrorPanel message={content.error} />;
  const parseError = parsed && isFailure(parsed) ? parsed.error : null;
  const showRaw = raw || !!parseError;
  const parsedLabel = delimiter === null ? "jsonl" : "table";

  return (
    <div className="fp-table">
      <div className="fp-table-head">
        <RawToggle raw={showRaw} onChange={setRaw} parsedLabel={parsedLabel} />
        {parseError && <ParseErrorChip message={parseError} />}
      </div>
      <TableBody showRaw={showRaw} parsed={parsed} rawText={content.value.text} />
    </div>
  );
}

function parseFor(delimiter: string | null, text: string) {
  return delimiter === null ? parseJsonLines(text) : parseDelimited(text, delimiter);
}

function TableBody({
  showRaw,
  parsed,
  rawText,
}: {
  showRaw: boolean;
  parsed: ReturnType<typeof parseFor> | null;
  rawText: string;
}) {
  if (showRaw || !parsed || isFailure(parsed)) return <TextBody text={rawText} />;
  return <VirtualTable columns={parsed.columns} rows={parsed.rows} />;
}
