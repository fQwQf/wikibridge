import {
  FileText, FolderOpen, Search, Network, ClipboardCheck, Settings, ArrowLeftRight,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import type { WikiState } from "@/stores/wiki-store"

const navItems: { view: WikiState["activeView"]; icon: typeof FileText; label: string }[] = [
  { view: "wiki", icon: FileText, label: "Wiki" },
  { view: "sources", icon: FolderOpen, label: "Sources" },
  { view: "search", icon: Search, label: "Search" },
  { view: "graph", icon: Network, label: "Graph" },
  { view: "lint", icon: ClipboardCheck, label: "Lint" },
  { view: "settings", icon: Settings, label: "Settings" },
]

interface IconSidebarProps {
  onSwitchProject: () => void
}

export function IconSidebar({ onSwitchProject }: IconSidebarProps) {
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-12 flex-col items-center border-r bg-muted/50 py-2">
        <div className="flex flex-1 flex-col items-center gap-1">
          {navItems.map(({ view, icon: Icon, label }) => (
            <Tooltip key={view}>
              <TooltipTrigger
                onClick={() => setActiveView(view)}
                className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                  activeView === view
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="flex flex-col items-center gap-1 pb-1">
          <Tooltip>
            <TooltipTrigger
              onClick={onSwitchProject}
              className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
            >
              <ArrowLeftRight className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">Switch Project</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
