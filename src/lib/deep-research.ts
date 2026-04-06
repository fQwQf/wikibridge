import { webSearch, type WebSearchResult } from "./web-search"
import { streamChat } from "./llm-client"
import { writeFile } from "@/commands/fs"
import { useWikiStore, type LlmConfig, type SearchApiConfig } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { listDirectory } from "@/commands/fs"

export interface ResearchResult {
  query: string
  webResults: WebSearchResult[]
  synthesis: string
  savedPath: string | null
}

/**
 * Deep Research: search the web for a topic, synthesize findings with LLM, save to wiki.
 */
export async function deepResearch(
  projectPath: string,
  topic: string,
  llmConfig: LlmConfig,
  searchConfig: SearchApiConfig,
): Promise<ResearchResult> {
  const activity = useActivityStore.getState()
  const activityId = activity.addItem({
    type: "query",
    title: `Research: ${topic.slice(0, 50)}`,
    status: "running",
    detail: "Searching the web...",
    filesWritten: [],
  })

  let webResults: WebSearchResult[] = []
  let synthesis = ""
  let savedPath: string | null = null

  try {
    // Step 1: Web search
    webResults = await webSearch(topic, searchConfig, 8)
    activity.updateItem(activityId, {
      detail: `Found ${webResults.length} results, synthesizing...`,
    })

    // Step 2: LLM synthesizes findings
    const searchContext = webResults
      .map((r, i) => `[${i + 1}] **${r.title}** (${r.source})\n${r.snippet}`)
      .join("\n\n")

    const systemPrompt = [
      "You are a research assistant. Synthesize the web search results below into a comprehensive wiki page.",
      "",
      "Rules:",
      "- Organize findings into clear sections with headings",
      "- Cite sources using [N] notation matching the search result numbers",
      "- Note any contradictions or gaps in the findings",
      "- Suggest what additional sources might be valuable",
      "- Write in a neutral, encyclopedic tone",
      "- Use [[wikilink]] syntax if referencing concepts that might exist in the wiki",
    ].join("\n")

    const userMessage = [
      `Research topic: **${topic}**`,
      "",
      "## Web Search Results",
      "",
      searchContext,
      "",
      "Please synthesize these findings into a comprehensive wiki page.",
    ].join("\n")

    let accumulated = ""

    await streamChat(
      llmConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        onToken: (token) => { accumulated += token },
        onDone: () => {},
        onError: (err) => {
          synthesis = `Research error: ${err.message}`
        },
      },
    )

    synthesis = accumulated || synthesis

    // Step 3: Save to wiki as a query/research page
    if (synthesis && !synthesis.startsWith("Research error")) {
      activity.updateItem(activityId, { detail: "Saving to wiki..." })

      const date = new Date().toISOString().slice(0, 10)
      const slug = topic
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 50)
      const fileName = `research-${slug}-${date}.md`
      const filePath = `${projectPath}/wiki/queries/${fileName}`

      const references = webResults
        .map((r, i) => `${i + 1}. [${r.title}](${r.url}) — ${r.source}`)
        .join("\n")

      const pageContent = [
        "---",
        `type: query`,
        `title: "Research: ${topic.replace(/"/g, '\\"')}"`,
        `created: ${date}`,
        `origin: deep-research`,
        `tags: [research]`,
        "---",
        "",
        `# Research: ${topic}`,
        "",
        synthesis,
        "",
        "## References",
        "",
        references,
        "",
      ].join("\n")

      await writeFile(filePath, pageContent)
      savedPath = `wiki/queries/${fileName}`

      // Refresh tree
      try {
        const tree = await listDirectory(projectPath)
        useWikiStore.getState().setFileTree(tree)
        useWikiStore.getState().bumpDataVersion()
      } catch {
        // ignore
      }
    }

    activity.updateItem(activityId, {
      status: "done",
      detail: `${webResults.length} sources found${savedPath ? ", saved to wiki" : ""}`,
      filesWritten: savedPath ? [savedPath] : [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    activity.updateItem(activityId, { status: "error", detail: message })
  }

  return { query: topic, webResults, synthesis, savedPath }
}
