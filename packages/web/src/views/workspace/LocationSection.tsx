import type { LocationPlan, S3Object } from "@athena-shell/shared";

interface Props {
  file: S3Object;
  location: LocationPlan;
}

export function LocationSection({ file, location }: Props) {
  return (
    <div className="ct-loc">
      <MetaRow label="source" value={file.key} />
      <MetaRow label="strategy" value={strategyLabel(location)} />
      {location.finalLocation && (
        <MetaRow label="final" value={location.finalLocation} />
      )}
      <div className="ct-loc-summary text-muted">{location.summary}</div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ct-meta-row">
      <span className="tracked">{label}</span>
      <span className="mono truncate">{value}</span>
    </div>
  );
}

function strategyLabel(plan: LocationPlan): string {
  switch (plan.strategy) {
    case "move":
      return "move into /datasets/";
    case "in-place":
      return "in-place";
    case "blocked":
      return "blocked";
  }
}
