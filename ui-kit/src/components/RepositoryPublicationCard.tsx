import { Button } from "./Button.js";
import { StatusBadge } from "./StatusBadge.js";

export type ReleaseChannel = "canary" | "next" | "stable";

export interface RepositoryPublicationCardProps {
  repository: string;
  branch: string;
  version: string;
  channel: ReleaseChannel;
  reviewState: "draft" | "review" | "approved" | "blocked";
  checksPassed: number;
  checksTotal: number;
  onOpenReview?: () => void;
}

export function RepositoryPublicationCard({
  repository,
  branch,
  version,
  channel,
  reviewState,
  checksPassed,
  checksTotal,
  onOpenReview,
}: RepositoryPublicationCardProps) {
  const approved = reviewState === "approved" && checksPassed === checksTotal;
  return (
    <section className="gc-card gc-publication" aria-label={`Publication ${version}`}>
      <StatusBadge tone={approved ? "success" : reviewState === "blocked" ? "danger" : "warning"}>
        {reviewState}
      </StatusBadge>
      <div className="gc-publication__meta">
        <div><small>Repository</small><strong>{repository}</strong></div>
        <div><small>Branch</small><strong>{branch}</strong></div>
        <div><small>Version / channel</small><strong>{version} · {channel}</strong></div>
        <div><small>Required checks</small><strong>{checksPassed} / {checksTotal}</strong></div>
      </div>
      <Button variant="secondary" icon="repository" onClick={onOpenReview}>Open release review</Button>
    </section>
  );
}
