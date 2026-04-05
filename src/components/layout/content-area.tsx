import { useEffect } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { ChatBar } from "./chat-bar"

export function ContentArea() {
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const fileContent = useWikiStore((s) => s.fileContent)
  const setFileContent = useWikiStore((s) => s.setFileContent)

  useEffect(() => {
    if (!selectedFile) {
      setFileContent("")
      return
    }
    readFile(selectedFile)
      .then(setFileContent)
      .catch((err) => setFileContent(`Error loading file: ${err}`))
  }, [selectedFile, setFileContent])

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        {selectedFile ? (
          <div className="p-6">
            <div className="mb-4 text-xs text-muted-foreground">
              {selectedFile}
            </div>
            <pre className="whitespace-pre-wrap font-mono text-sm">
              {fileContent}
            </pre>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select a file from the tree to view
          </div>
        )}
      </div>
      <ChatBar />
    </div>
  )
}
