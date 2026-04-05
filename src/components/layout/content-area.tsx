import { useWikiStore } from "@/stores/wiki-store"
import { ChatPanel } from "@/components/chat/chat-panel"
import { SettingsView } from "@/components/settings/settings-view"
import { SourcesView } from "@/components/sources/sources-view"
import { ReviewView } from "@/components/review/review-view"
import { LintView } from "@/components/lint/lint-view"
import { SearchView } from "@/components/search/search-view"
import { GraphView } from "@/components/graph/graph-view"

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  return (
    <div className="relative h-full">
      {/* Graph stays mounted, shown/hidden via CSS so it updates in real-time */}
      <div className={`absolute inset-0 ${activeView === "graph" ? "" : "invisible pointer-events-none"}`}>
        <GraphView />
      </div>

      {/* Other views mount/unmount normally */}
      {activeView === "settings" && <SettingsView />}
      {activeView === "sources" && <SourcesView />}
      {activeView === "review" && <ReviewView />}
      {activeView === "lint" && <LintView />}
      {activeView === "search" && <SearchView />}
      {activeView === "wiki" && <ChatPanel />}
    </div>
  )
}
