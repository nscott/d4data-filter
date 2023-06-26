import { glob } from "glob";
import fs from 'fs/promises';
import DEBUG_FILES from "./debugFiles.js";

/**
 * Use the list of post-filtered files to build a graph data structure that holds all of the relationships between nodes.
 */
export class Node {
  public name: string

  // The key is the node itself for O(1) lookup, and the value is the label of the edge.
  // These should be *directed* edges.
  public children: Map<Node, string>
  public parents: Map<Node, string>

  // Tracking metadata that can help for i.e. traversal
  public meta: Map<string, any>

  /**
   * Create a new node.
   * @param name The name of this node, typically the sno ID
   */
  constructor(name: string) {
    if (typeof name === 'number') {
      // Runtime types :melt:
      this.name = (name as number).toString();
    } else {
      this.name = name;
    }
    this.parents = new Map();
    this.children = new Map();
    this.meta = new Map();
  }

  /**
   * Add a connection from this node to another.
   * @param node The node to connect to this one.
   * @param label The edge label
   */
  addChild(node: Node, label: string) {
    if (this.children.has(node)) {
      // Don't add the same node twice
      return;
    }

    node.parents.set(this, 'parent');
    this.children.set(node, label);
  }
}

export class Graph {
  // Key is the sno ID, value is the node itself
  nodes: Map<string, Node>;
  debug: boolean

  constructor(debug?: boolean) {
    this.nodes = new Map();
    this.debug = debug || false;
  }

  findIslands(): Node[] {
    const result: Node[] = [];
    for(const [_, node] of this.nodes) {
      if (node.children.size === 0 && node.parents.size === 0) {
        result.push(node);
      }
    }
    return result;
  }

  buildDot(snoId: string, depth: number): string {
    const snoIdNode = this.nodes.get(snoId.trim());
    if (!snoIdNode!) {
      throw new Error(`Found no node with ID '${snoId}'`);
    }

    const allNodes: Node[] = []
    
    let toVisit: Node[] = [snoIdNode];
    let nextDepth: Node[] = [];
    let curDepth = 0;
    while(curDepth < depth && toVisit.length !== 0) {
      const curNode = toVisit.shift();
      allNodes.push(curNode!);

      nextDepth.push(...curNode!.parents.keys());
      nextDepth.push(...curNode!.children.keys());
      if (toVisit.length === 0) {
        toVisit.push(...nextDepth);
        nextDepth = [];
        curDepth += 1;
      }
    }

    let result = "digraph G {\n";
    for(const node of allNodes) {
      if (node === snoIdNode) {
        result += `  ${node.name} [color=red];\n`;
      }

      for(const [childNode, edgeLabel] of node.children) {
        let props = `label="${edgeLabel}"`
        result += `  ${node.name} -> ${childNode.name} [${props}];\n`;
      }
    }
    result += "}";
    return result;
  }

  buildFullDot(): string {
    let result = "digraph G {\n";
    for(const [id, node] of this.nodes) {
      for(const [childNode, edgeLabel] of node.children) {
        result += `  ${id} -> ${childNode.name} [label="${edgeLabel}"];\n`;
      }
    }
    result += "}";
    return result;
  }

  async loadNodes(): Promise<void> {
    const files = await this.filesToLoad();
    for(const fileName of files) {
      let fileContent: string;
      try {
        fileContent = await fs.readFile(fileName, { encoding: 'utf8' })
      } catch(e: any) {
        continue;
      }

      const data = JSON.parse(fileContent);

      let curNode: Node;
      let snoId = (data.__snoID__ as number).toString();
      if (this.nodes.has(snoId)) {
        curNode = this.nodes.get(snoId)!;
      } else {
        curNode = new Node(snoId);
        this.nodes.set(snoId, curNode);
      }

      // Always set the name and type in case we've seen this already
      curNode.meta.set("fileName", fileName);
      curNode.meta.set("type", data.__type__);

      const snoRels = data.df_snoRels;
      for(const snoRel of snoRels) {
        for(const val of snoRel.snoValues) {
          const valStr = val.toString();
          let childNode: Node
          if (this.nodes.has(valStr)) {
            childNode = this.nodes.get(valStr)!;
          } else {
            childNode = new Node(valStr);
            this.nodes.set(valStr, childNode);
          }
          curNode.addChild(childNode, snoRel.rel);
        }
      }
    }
  }

  async filesToLoad(): Promise<string[]> {
    if (this.debug) {
      return DEBUG_FILES.map((f) => `./output/${f}`);
    }

    return await glob(`./output/**/*.json`);
  }
};

export default Graph;
