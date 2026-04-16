import { lazy, Suspense } from "react";

import { LoadingSpinner } from "../../components/LoadingSpinner";

const SqlEditorImpl = lazy(() => import("./SqlEditorImpl"));

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function SqlEditor(props: Props) {
  return (
    <Suspense fallback={<LoadingSpinner label="Loading editor…" />}>
      <SqlEditorImpl {...props} />
    </Suspense>
  );
}
