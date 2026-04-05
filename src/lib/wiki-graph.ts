import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

export interface GraphNode {
  id: string
  label: string
  type: string
  path: string
  linkCount: number // inbound + outbound
}

export interface GraphEdge {
  source: string
  target: string
}

const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function extractTitle(content: string, fileName: string): string {
  const frontmatterTitleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterTitleMatch) return frontmatterTitleMatch[1].trim()

  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  return fileName.replace(/\.md$/, "").replace(/-/g, " ")
}

function extractType(content: string): string {
  const frontmatterTypeMatch = content.match(/^---\n[\s\S]*?^type:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterTypeMatch) return frontmatterTypeMatch[1].trim().toLowerCase()
  return "other"
}

function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = new RegExp(WIKILINK_REGEX.source, "g")
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim())
  }
  return links
}

function fileNameToId(fileName: string): string {
  return fileName.replace(/\.md$/, "")
}

export async function buildWikiGraph(
  projectPath: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const wikiRoot = `${projectPath}/wiki`

  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    return { nodes: [], edges: [] }
  }

  const mdFiles = flattenMdFiles(tree)
  if (mdFiles.length === 0) {
    return { nodes: [], edges: [] }
  }

  // Build a map of id -> node data
  const nodeMap = new Map<
    string,
    { id: string; label: string; type: string; path: string; links: string[] }
  >()

  for (const file of mdFiles) {
    const id = fileNameToId(file.name)
    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      // Skip unreadable files
      continue
    }

    nodeMap.set(id, {
      id,
      label: extractTitle(content, file.name),
      type: extractType(content),
      path: file.path,
      links: extractWikilinks(content),
    })
  }

  // Count link references
  const linkCounts = new Map<string, number>()
  for (const [id] of nodeMap) {
    linkCounts.set(id, 0)
  }

  const rawEdges: GraphEdge[] = []

  for (const [sourceId, nodeData] of nodeMap) {
    for (const targetRaw of nodeData.links) {
      // Normalize target: try matching by id (case-insensitive, hyphen/space)
      const targetId = resolveTarget(targetRaw, nodeMap)
      if (targetId === null) continue
      if (targetId === sourceId) continue

      rawEdges.push({ source: sourceId, target: targetId })

      linkCounts.set(sourceId, (linkCounts.get(sourceId) ?? 0) + 1)
      linkCounts.set(targetId, (linkCounts.get(targetId) ?? 0) + 1)
    }
  }

  // Deduplicate edges (keep only unique source->target pairs)
  const seenEdges = new Set<string>()
  const edges: GraphEdge[] = []
  for (const edge of rawEdges) {
    const key = `${edge.source}:::${edge.target}`
    if (!seenEdges.has(key)) {
      seenEdges.add(key)
      edges.push(edge)
    }
  }

  const nodes: GraphNode[] = Array.from(nodeMap.values()).map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    path: n.path,
    linkCount: linkCounts.get(n.id) ?? 0,
  }))

  return { nodes, edges }
}

function resolveTarget(
  raw: string,
  nodeMap: Map<string, { id: string }>,
): string | null {
  // Direct match
  if (nodeMap.has(raw)) return raw

  // Normalize: lowercase, replace spaces with hyphens and vice versa
  const normalized = raw.toLowerCase().replace(/\s+/g, "-")
  for (const id of nodeMap.keys()) {
    if (id.toLowerCase() === normalized) return id
    if (id.toLowerCase() === raw.toLowerCase()) return id
    if (id.toLowerCase().replace(/\s+/g, "-") === normalized) return id
  }

  return null
}
