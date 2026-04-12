import { readFile, writeFile, listDirectory } from "@/commands/fs"
import type { LlmConfig, EmbeddingConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"

// ── Types ─────────────────────────────────────────────────────────────────

interface EmbeddingCache {
  model: string
  embeddings: Record<string, number[]> // pageId -> vector
}

// ── Module cache ──────────────────────────────────────────────────────────

let cache: EmbeddingCache | null = null
let cacheProjectPath = ""

// ── API ───────────────────────────────────────────────────────────────────

function getEmbeddingEndpoint(llmConfig: LlmConfig): string {
  switch (llmConfig.provider) {
    case "openai":
      return "https://api.openai.com/v1/embeddings"
    case "ollama":
      return `${llmConfig.ollamaUrl}/v1/embeddings`
    case "custom":
      // Assume custom endpoint supports /embeddings
      return llmConfig.customEndpoint.replace(/\/chat\/completions\/?$/, "/embeddings")
    default:
      // For providers without native embedding, use custom endpoint if set
      return llmConfig.customEndpoint
        ? llmConfig.customEndpoint.replace(/\/chat\/completions\/?$/, "/embeddings")
        : ""
  }
}

function getAuthHeaders(llmConfig: LlmConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (llmConfig.apiKey) {
    headers["Authorization"] = `Bearer ${llmConfig.apiKey}`
  }
  return headers
}

async function fetchEmbedding(
  text: string,
  llmConfig: LlmConfig,
  embeddingConfig: EmbeddingConfig,
): Promise<number[] | null> {
  const endpoint = getEmbeddingEndpoint(llmConfig)
  if (!endpoint) return null

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: getAuthHeaders(llmConfig),
      body: JSON.stringify({
        model: embeddingConfig.model,
        input: text.slice(0, 2000), // truncate to avoid token limits
      }),
    })

    if (!resp.ok) return null

    const data = await resp.json()
    return data?.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}

// ── Cache management ──────────────────────────────────────────────────────

function cachePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/embeddings.json`
}

async function loadCache(projectPath: string, model: string): Promise<EmbeddingCache> {
  const pp = normalizePath(projectPath)
  if (cache && cacheProjectPath === pp && cache.model === model) {
    return cache
  }

  try {
    const raw = await readFile(cachePath(pp))
    const loaded = JSON.parse(raw) as EmbeddingCache
    // Invalidate if model changed
    if (loaded.model !== model) {
      cache = { model, embeddings: {} }
    } else {
      cache = loaded
    }
  } catch {
    cache = { model, embeddings: {} }
  }

  cacheProjectPath = pp
  return cache
}

async function saveCache(projectPath: string): Promise<void> {
  if (!cache) return
  try {
    await writeFile(cachePath(projectPath), JSON.stringify(cache))
  } catch {
    // non-critical
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Embed a single page and cache the result.
 * Called after ingest to keep embeddings up to date.
 */
export async function embedPage(
  projectPath: string,
  pageId: string,
  title: string,
  content: string,
  llmConfig: LlmConfig,
  embeddingConfig: EmbeddingConfig,
): Promise<void> {
  if (!embeddingConfig.enabled || !embeddingConfig.model) return

  const c = await loadCache(projectPath, embeddingConfig.model)
  const text = `${title}\n${content.slice(0, 1500)}`
  const emb = await fetchEmbedding(text, llmConfig, embeddingConfig)

  if (emb) {
    c.embeddings[pageId] = emb
    await saveCache(projectPath)
  }
}

/**
 * Embed all wiki pages that are not yet cached.
 * Called on first enable or when model changes.
 */
export async function embedAllPages(
  projectPath: string,
  llmConfig: LlmConfig,
  embeddingConfig: EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (!embeddingConfig.enabled || !embeddingConfig.model) return 0

  const pp = normalizePath(projectPath)
  const c = await loadCache(pp, embeddingConfig.model)

  // Find all wiki .md files
  let tree: FileNode[]
  try {
    tree = await listDirectory(`${pp}/wiki`)
  } catch {
    return 0
  }

  const mdFiles: { id: string; path: string }[] = []
  function walk(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.is_dir && node.children) {
        walk(node.children)
      } else if (!node.is_dir && node.name.endsWith(".md")) {
        const id = node.name.replace(/\.md$/, "")
        if (!["index", "log", "overview", "purpose", "schema"].includes(id)) {
          mdFiles.push({ id, path: node.path })
        }
      }
    }
  }
  walk(tree)

  // Only embed pages not in cache
  const toEmbed = mdFiles.filter((f) => !(f.id in c.embeddings))
  let done = 0

  for (const file of toEmbed) {
    try {
      const content = await readFile(file.path)
      // Extract title from frontmatter
      const titleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
      const title = titleMatch ? titleMatch[1].trim() : file.id

      const text = `${title}\n${content.slice(0, 1500)}`
      const emb = await fetchEmbedding(text, llmConfig, embeddingConfig)
      if (emb) {
        c.embeddings[file.id] = emb
      }
    } catch {
      // skip
    }

    done++
    if (onProgress) onProgress(done, toEmbed.length)

    // Save periodically
    if (done % 20 === 0) {
      await saveCache(pp)
    }
  }

  await saveCache(pp)
  return done
}

/**
 * Search wiki pages by semantic similarity.
 * Returns page IDs sorted by cosine similarity.
 */
export async function searchByEmbedding(
  projectPath: string,
  query: string,
  llmConfig: LlmConfig,
  embeddingConfig: EmbeddingConfig,
  topK: number = 10,
): Promise<Array<{ id: string; score: number }>> {
  if (!embeddingConfig.enabled || !embeddingConfig.model) return []

  const c = await loadCache(projectPath, embeddingConfig.model)
  const queryEmb = await fetchEmbedding(query, llmConfig, embeddingConfig)
  if (!queryEmb) return []

  const scored: Array<{ id: string; score: number }> = []

  for (const [pageId, pageEmb] of Object.entries(c.embeddings)) {
    const sim = cosineSimilarity(queryEmb, pageEmb)
    if (sim > 0) {
      scored.push({ id: pageId, score: sim })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/**
 * Clear embedding cache (e.g., when model changes).
 */
export async function clearEmbeddingCache(projectPath: string): Promise<void> {
  cache = null
  cacheProjectPath = ""
  try {
    await writeFile(cachePath(projectPath), JSON.stringify({ model: "", embeddings: {} }))
  } catch {
    // non-critical
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
