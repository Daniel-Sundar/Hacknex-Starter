// Docs Q&A: upload PDF / text files, ask questions, get answers that cite the passages they come from.
// The shell renders the page h1 and description; this page starts at h2. It stays mounted when the user
// switches tabs, so uploads, answers and the question being typed survive a tab switch.
import { AskPanel, type DocsStatus } from "./docs/AskPanel";
import { DocumentsPanel } from "./docs/DocumentsPanel";
import { useDocuments } from "./docs/useDocuments";
import { Workbench } from "../components/ui";

export default function Docs() {
  const d = useDocuments();

  const status: DocsStatus =
    d.docs.length > 0 ? "ready"
      : d.list === "loading" ? "loading"
        : d.uploads.some((u) => u.status !== "failed") ? "uploading"
          : d.list === "error" ? "unknown"
            : "empty";

  return (
    // Same workbench as Handwriting: your documents on the left, the conversation with them on the right.
    <Workbench cols="lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
      <div className="min-w-0 border-b border-line bg-subtle/60 lg:border-e lg:border-b-0"><DocumentsPanel d={d} /></div>
      <AskPanel status={status} limitMb={d.limitMb} onNoDocs={() => void d.load(true)} />
    </Workbench>
  );
}
