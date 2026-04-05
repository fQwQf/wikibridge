import { MessageSquare, ChevronUp, ChevronDown } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"

export function ChatBar() {
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)

  if (!chatExpanded) {
    return (
      <button
        onClick={() => setChatExpanded(true)}
        className="flex w-full items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground hover:bg-accent/50"
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          CHAT
        </span>
        <ChevronUp className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <button
        onClick={() => setChatExpanded(false)}
        className="flex w-full items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground hover:bg-accent/50"
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          CHAT
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>
      <div className="flex-1 overflow-auto p-4">
        <p className="text-sm text-muted-foreground">
          Chat will be available in Phase 2 (LLM Integration).
        </p>
      </div>
      <div className="border-t p-3">
        <input
          type="text"
          placeholder="Type a message..."
          disabled
          className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm"
        />
      </div>
    </div>
  )
}
