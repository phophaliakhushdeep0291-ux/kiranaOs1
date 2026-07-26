import FindingsPage from "./FindingsPage";

// The review queue is the findings list scoped to work that still needs a human
// decision. Same surface, different default filter — no duplicated UI.
export default function ReviewQueuePage() {
  return (
    <FindingsPage
      title="Review Queue"
      description="Findings still waiting on a review decision or evidence. Work top-down: the list is ordered by risk score."
      presetOpenOnly
    />
  );
}
